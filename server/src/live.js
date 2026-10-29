// Live updates: every open app keeps one Server-Sent Events stream. After any
// successful change (non-GET /api request) the others get
//   { by, name, path, at }
// and re-read /api/state — which applies each viewer's own permissions, so
// the event itself carries no data, just "something changed".
//
// One process per company instance, so a broadcast reaches only that
// company's users. No nginx change needed: X-Accel-Buffering turns off
// proxy buffering for this response, and a heartbeat every 25 s keeps it
// under nginx's 60 s read timeout.
import jwt from 'jsonwebtoken';
import { prisma } from './prisma.js';

const clients = new Set();
const HEARTBEAT_MS = 25000;

export function liveClientCount() {
  return clients.size;
}

export function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    try { c.res.write(line); } catch { clients.delete(c); }
  }
}

// GET /api/events?token=… (EventSource can't send an Authorization header).
export async function eventsHandler(req, res) {
  let employee = null;
  try {
    const payload = jwt.verify(String(req.query.token || ''), process.env.JWT_SECRET);
    employee = await prisma.employee.findUnique({ where: { id: payload.sub } });
    if (!employee || employee.isBlocked) employee = null;
    if (employee?.passwordChangedAt && payload.iat * 1000 < employee.passwordChangedAt) employee = null;
  } catch { employee = null; }
  if (!employee) return res.status(401).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  const client = { res, employeeId: employee.id };
  clients.add(client);
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
  req.on('close', () => { clearInterval(beat); clients.delete(client); });
}

// Middleware: announce successful writes once the response has gone out.
export function announceChanges(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.employee) return;
    if (/^\/api\/(auth|files|events)\b/.test(req.originalUrl)) return;
    broadcast({
      by: req.employee.id, name: req.employee.name, path: req.originalUrl.split('?')[0], at: Date.now(),
      // The tab that made the change already has it; it skips its own echo.
      client: String(req.get('x-client-id') || '').slice(0, 64),
    });
  });
  next();
}
