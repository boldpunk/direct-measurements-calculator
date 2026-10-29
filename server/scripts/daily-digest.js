// Morning summary for one MebelFlow instance, sent to Telegram: overdue
// orders, orders due today/tomorrow, and the biggest unpaid balances.
//
// Runs from cron (installed by deploy/deploy.sh, hourly with --scheduled) with the
// instance's env file loaded. Does nothing unless these are set in it:
//   DIGEST_TELEGRAM_BOT_TOKEN="123456:ABC..."   # bot from @BotFather
//   DIGEST_TELEGRAM_CHAT_ID="-100123..."        # a person or a group chat
//
// Optional: DIGEST_HOUR (default 8) and DIGEST_TZ (default Asia/Tashkent).
//
//   node scripts/daily-digest.js               # send now
//   node scripts/daily-digest.js --scheduled   # send only at DIGEST_HOUR (cron runs it hourly)
//   node scripts/daily-digest.js --print       # just print the text
import 'dotenv/config';
import { prisma } from '../src/prisma.js';
import { reorderList } from '../src/low-stock.js';

const CLOSED = new Set(['Завершён', 'Отменён', 'Готово']);
const fmt = (n, cur) => `${Math.round(Number(n) || 0).toLocaleString('ru-RU')} ${cur}`;
const iso = (d) => d.toISOString().slice(0, 10);

export async function buildDigest(now = new Date()) {
  const today = iso(now);
  const tomorrow = iso(new Date(now.getTime() + 86400000));
  const [settings, orders, payments] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 'default' } }),
    prisma.order.findMany({ where: { archivedAt: null } }),
    prisma.payment.groupBy({ by: ['orderId'], _sum: { amount: true } }),
  ]);
  const cur = settings?.currency || '$';
  const paid = new Map(payments.map((p) => [p.orderId, p._sum.amount || 0]));
  const active = orders.filter((o) => !CLOSED.has(o.status));
  const label = (o) => `#${o.number}${o.productType ? ` ${o.productType}` : ''} — ${o.clientName || 'без имени'}`;

  const overdue = active.filter((o) => o.deadline && o.deadline < today).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const dueSoon = active.filter((o) => o.deadline === today || o.deadline === tomorrow);
  const debts = orders
    .filter((o) => o.status !== 'Отменён')
    .map((o) => ({ o, left: (Number(o.amount) || 0) - (paid.get(o.id) || 0) }))
    .filter((x) => x.left > 0)
    .sort((a, b) => b.left - a.left);
  const debtTotal = debts.reduce((s, x) => s + x.left, 0);

  const lines = [`☀️ ${settings?.companyName || 'MebelFlow'} — сводка на ${now.toLocaleDateString('ru-RU')}`, ''];
  lines.push(`В работе: ${active.length} заказ(ов)`);
  if (overdue.length) {
    lines.push('', `🔥 Просрочено (${overdue.length}):`);
    overdue.slice(0, 10).forEach((o) => lines.push(`• ${label(o)} · срок ${o.deadline.split('-').reverse().join('.')}`));
  }
  if (dueSoon.length) {
    lines.push('', `⏰ Сдать сегодня/завтра (${dueSoon.length}):`);
    dueSoon.forEach((o) => lines.push(`• ${label(o)} · ${o.deadline === today ? 'сегодня' : 'завтра'}`));
  }
  if (debts.length) {
    lines.push('', `💰 Не оплачено: ${fmt(debtTotal, cur)}`);
    debts.slice(0, 5).forEach(({ o, left }) => lines.push(`• ${label(o)} · ${fmt(left, cur)}`));
  }
  const reorder = (await reorderList()).flatMap((g) => g.items);
  if (reorder.length) {
    lines.push('', `📦 Склад: заказать ${reorder.length} поз.`);
    reorder.slice(0, 5).forEach((r) => lines.push(`• ${r.name} — осталось ${r.qty} ${r.unit}`));
  }
  if (!overdue.length && !dueSoon.length && !debts.length) lines.push('', 'Просрочек и долгов нет 👍');
  return lines.join('\n');
}

function localHour(tz) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
}

async function main() {
  if (process.argv.includes('--scheduled')) {
    const hour = Number(process.env.DIGEST_HOUR ?? 8);
    if (localHour(process.env.DIGEST_TZ || 'Asia/Tashkent') !== hour) return;
  }
  const text = await buildDigest();
  if (process.argv.includes('--print')) { console.log(text); return; }
  const token = process.env.DIGEST_TELEGRAM_BOT_TOKEN;
  const chat = process.env.DIGEST_TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.log('digest: DIGEST_TELEGRAM_* not set, skipping'); return; }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  console.log(`digest: sent to ${chat}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
