// Collects errors from users' browsers (POST /api/client-errors) and from
// the API's own error handler into AppError, grouped by fingerprint, and
// pings Telegram the first time a new kind of error shows up (if the
// instance has DIGEST_TELEGRAM_BOT_TOKEN / DIGEST_TELEGRAM_CHAT_ID set).
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma.js';
import { uid } from './util.js';

const cut = (s, n) => String(s ?? '').slice(0, n);

// Same message at the same place = same error, whatever the line/column
// numbers of a rebuilt bundle or the ids inside the message.
export function fingerprintOf(source, message, stack) {
  const firstFrame = String(stack || '').split('\n').find((l) => /at |@/.test(l)) || '';
  const normalize = (s) => String(s).replace(/[a-z]{3}_[a-z0-9]+_[a-z0-9]+/gi, '<id>').replace(/\d+/g, 'N').replace(/\.[a-f0-9]{8}\.js/g, '.js');
  return crypto.createHash('sha1').update(`${source}|${normalize(message)}|${normalize(firstFrame)}`).digest('hex');
}

async function notifyTelegram(text) {
  const token = process.env.DIGEST_TELEGRAM_BOT_TOKEN;
  const chat = process.env.DIGEST_TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: cut(text, 3500), disable_web_page_preview: true }),
    });
  } catch { /* best effort */ }
}

export async function recordError({ source, message, stack = '', url = '', userAgent = '', employee = null }) {
  const now = Date.now();
  const fp = fingerprintOf(source, message, stack);
  try {
    const existing = await prisma.appError.findUnique({ where: { fingerprint: fp }, select: { id: true } });
    if (existing) {
      await prisma.appError.update({
        where: { id: existing.id },
        data: { count: { increment: 1 }, lastAt: now, url: cut(url, 500), userAgent: cut(userAgent, 300), employeeId: employee?.id || null, employeeName: cut(employee?.name, 100) },
      });
      return { isNew: false };
    }
    await prisma.appError.create({
      data: {
        id: uid('err'), fingerprint: fp, source, message: cut(message, 1000), stack: cut(stack, 4000),
        url: cut(url, 500), userAgent: cut(userAgent, 300), employeeId: employee?.id || null,
        employeeName: cut(employee?.name, 100), firstAt: now, lastAt: now,
      },
    });
    const company = (await prisma.settings.findUnique({ where: { id: 'default' }, select: { companyName: true } }))?.companyName || 'MebelFlow';
    notifyTelegram(`⚠️ ${company}: новая ошибка (${source === 'server' ? 'сервер' : 'приложение'})\n${cut(message, 300)}${employee ? `\nСотрудник: ${employee.name}` : ''}${url ? `\nСтраница: ${cut(url, 200)}` : ''}`);
    return { isNew: true };
  } catch (e) {
    console.error('Failed to record app error', e);
    return { isNew: false };
  }
}

// In-memory brake: a broken page in a loop shouldn't flood the table.
const perIp = new Map();
function allowed(ip) {
  const now = Date.now();
  const list = (perIp.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 30) return false;
  list.push(now);
  perIp.set(ip, list);
  if (perIp.size > 5000) perIp.delete(perIp.keys().next().value);
  return true;
}

// POST /api/client-errors — works before login too (errors on the login
// screen matter); a token, if present, attributes it to the employee.
export async function clientErrorsHandler(req, res) {
  if (!allowed(req.ip)) return res.status(429).end();
  const b = req.body || {};
  if (!b.message) return res.status(400).end();
  let employee = null;
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (token) {
    try {
      const { sub } = jwt.verify(token, process.env.JWT_SECRET);
      employee = await prisma.employee.findUnique({ where: { id: sub }, select: { id: true, name: true } });
    } catch { /* anonymous */ }
  }
  await recordError({ source: 'client', message: b.message, stack: b.stack, url: b.url, userAgent: req.headers['user-agent'], employee });
  res.status(204).end();
}
