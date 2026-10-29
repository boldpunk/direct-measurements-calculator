// End-to-end checks against a running API on a seeded database
// (`npx prisma migrate deploy && npm run seed`). Starts its own server on a
// spare port. Every change it makes is undone before it finishes.
//
// Skipped when there is no DATABASE_URL (plain `npm test` on a laptop
// without Postgres still runs the unit tests).
import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skip = !process.env.DATABASE_URL && 'DATABASE_URL not set';
const PORT = Number(process.env.TEST_PORT) || 4099;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'mebelflow123'; // prisma/seed.js
let server;
const tokens = {};

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers, text };
}

before(async () => {
  if (skip) return;
  server = spawn(process.execPath, ['src/index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(PORT), ENABLE_MIGRATION_ROUTES: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const who of ['nasiba', 'alexey', 'aimad']) {
    const r = await call('/api/auth/login', { method: 'POST', body: { email: `${who}@mebelflow.uz`, password: PASSWORD } });
    assert.equal(r.status, 200, `login ${who}: ${r.text}`);
    tokens[who] = r.json.token;
  }
});

after(() => server?.kill());

test('health checks the database', { skip }, async () => {
  const r = await call('/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('state needs a login', { skip }, async () => {
  assert.equal((await call('/api/state')).status, 401);
});

test('migration endpoints are off by default', { skip }, async () => {
  assert.equal((await call('/api/migration/export')).status, 404);
});

test('admin state is complete', { skip }, async () => {
  const { json } = await call('/api/state', { token: tokens.nasiba });
  assert.ok(json.orders.length > 0);
  assert.ok(json.orders.some((o) => o.amount > 0));
  assert.ok(json.clients.length > 0);
  assert.ok(Object.values(json.finance).some((f) => f.payments.length > 0));
});

test('production worker gets no money and no clients', { skip }, async () => {
  const { json } = await call('/api/state', { token: tokens.alexey });
  assert.ok(json.orders.length > 0);
  assert.ok(json.orders.every((o) => o.amount === 0));
  assert.deepEqual(json.clients, []);
  for (const f of Object.values(json.finance)) {
    assert.deepEqual(f.payments, []);
    assert.deepEqual(f.salaries, []);
    assert.ok(f.materials.every((m) => !m.unitPrice && !m.purchasePrice));
  }
});

test('own-orders-only installer sees only assigned orders', { skip }, async () => {
  const all = (await call('/api/state', { token: tokens.nasiba })).json;
  const { json } = await call('/api/state', { token: tokens.aimad });
  const me = all.employees.find((e) => e.email === 'aimad@mebelflow.uz');
  const mine = new Set([
    ...all.orders.filter((o) => o.managerId === me.id).map((o) => o.id),
    ...all.stages.filter((s) => s.assigneeId === me.id).map((s) => s.orderId),
    ...all.tasks.filter((t) => t.assigneeId === me.id && t.orderId).map((t) => t.orderId),
  ]);
  assert.ok(json.orders.length < all.orders.length);
  assert.ok(json.orders.every((o) => mine.has(o.id)));
});

test('order history is loaded on demand and permission-checked', { skip }, async () => {
  const { json: st } = await call('/api/state', { token: tokens.nasiba });
  assert.ok(st.orders.every((o) => o.activity.length === 0), 'not in the login payload');
  const id = st.orders[0].id;
  const r = await call(`/api/orders/${id}/activity`, { token: tokens.nasiba });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json));
  assert.equal((await call(`/api/orders/${id}/activity`, { token: tokens.alexey })).status, 403);
});

test('branding: echoed asset URL never replaces the logo', { skip }, async () => {
  const before = (await call('/api/branding')).json;
  await call('/api/settings', { token: tokens.nasiba, method: 'PATCH', body: { logoUrl: '/api/branding/logo?v=deadbeef' } });
  assert.deepEqual((await call('/api/branding')).json, before);
});

test('archiving keeps payments and restore brings the order back', { skip }, async () => {
  const { json: st } = await call('/api/state', { token: tokens.nasiba });
  const order = st.orders.find((o) => st.finance[o.id]?.payments.length > 0);
  assert.ok(order, 'seed has an order with payments');
  const paid = st.finance[order.id].payments.length;

  assert.equal((await call(`/api/orders/${order.id}`, { token: tokens.nasiba, method: 'DELETE' })).status, 204);
  try {
    const afterArchive = (await call('/api/state', { token: tokens.nasiba })).json;
    assert.ok(!afterArchive.orders.some((o) => o.id === order.id), 'gone from lists');
    const archived = (await call('/api/orders/archived', { token: tokens.nasiba })).json;
    assert.ok(archived.some((o) => o.id === order.id), 'listed in the archive');
  } finally {
    const r = await call(`/api/orders/${order.id}/restore`, { token: tokens.nasiba, method: 'POST' });
    assert.equal(r.status, 204, r.text);
  }
  const restored = (await call('/api/state', { token: tokens.nasiba })).json;
  assert.ok(restored.orders.some((o) => o.id === order.id));
  assert.equal(restored.finance[order.id].payments.length, paid);
});

test('exchange rate: valid saved, invalid rejected, cleared', { skip }, async () => {
  const patch = (fxRate) => call('/api/settings', { token: tokens.nasiba, method: 'PATCH', body: { fxRate } });
  try {
    assert.deepEqual((await patch({ from: '$', to: "so'm", rate: 12700 })).json.fxRate, { from: '$', to: "so'm", rate: 12700 });
    assert.equal((await patch({ from: '$', to: '$', rate: 1 })).json.fxRate, null, 'same currency');
    assert.equal((await patch({ from: '$', to: 'BTC', rate: 1 })).json.fxRate, null, 'unknown currency');
    assert.equal((await patch({ from: '$', to: "so'm", rate: -5 })).json.fxRate, null, 'negative rate');
    const st = (await call('/api/state', { token: tokens.alexey })).json;
    assert.ok('fxRate' in st.settings);
  } finally {
    await patch(null);
  }
});

test('morning digest lists overdue orders and debts', { skip }, async () => {
  const { buildDigest } = await import('../scripts/daily-digest.js');
  const text = await buildDigest(new Date());
  assert.match(text, /сводка на/);
  assert.match(text, /В работе: \d+/);
});

test('too many failed logins from one IP are throttled (429), other IPs unaffected', { skip }, async () => {
  const from = (ip) => ({ 'X-Forwarded-For': ip });
  const attempt = (ip, email) => fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...from(ip) },
    body: JSON.stringify({ email, password: 'wrong-password' }),
  });
  for (let i = 0; i < 20; i += 1) await attempt('203.0.113.7', `nobody${i}@example.com`);
  const blocked = await attempt('203.0.113.7', 'nobody@example.com');
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  assert.equal((await attempt('203.0.113.8', 'nobody@example.com')).status, 401);
});

test('changing the password signs out other sessions', { skip }, async () => {
  const login = async (password) => (await call('/api/auth/login', { method: 'POST', body: { email: 'anna@mebelflow.uz', password } })).json?.token;
  const oldToken = await login(PASSWORD);
  assert.ok(oldToken);
  await new Promise((r) => setTimeout(r, 1100)); // tokens carry whole-second timestamps
  const short = await call('/api/auth/change-password', { token: oldToken, method: 'POST', body: { currentPassword: PASSWORD, newPassword: '123' } });
  assert.equal(short.status, 400);
  const wrong = await call('/api/auth/change-password', { token: oldToken, method: 'POST', body: { currentPassword: 'nope', newPassword: 'new-password-1' } });
  assert.equal(wrong.status, 400);
  const changed = await call('/api/auth/change-password', { token: oldToken, method: 'POST', body: { currentPassword: PASSWORD, newPassword: 'new-password-1' } });
  assert.equal(changed.status, 200);
  try {
    assert.equal((await call('/api/state', { token: oldToken })).status, 401, 'old session is out');
    assert.equal((await call('/api/state', { token: changed.json.token })).status, 200, 'this device stays in');
    assert.ok(await login('new-password-1'));
  } finally {
    await new Promise((r) => setTimeout(r, 1100));
    const token = await login('new-password-1');
    await call('/api/auth/change-password', { token, method: 'POST', body: { currentPassword: 'new-password-1', newPassword: PASSWORD } });
  }
  const log = await call('/api/audit-log?entityType=auth&limit=50', { token: tokens.nasiba });
  assert.ok(log.json.some((e) => e.action === 'auth.password_change'), 'logged');
  assert.ok(log.json.some((e) => e.action === 'auth.login_failed'), 'failed logins logged');
});

test('images are stored as files, not base64 in rows', { skip }, async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await call('/api/files', { token: tokens.nasiba, method: 'POST', body: { dataUri: PNG } });
  assert.equal(up.status, 201);
  assert.match(up.json.url, /^\/api\/files\/[\w-]{20,}$/);
  const res = await fetch(`${BASE}${up.json.url}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await fetch(`${BASE}${up.json.url}?thumb=1`)).status, 200, 'no thumb → original');
  assert.equal((await call('/api/files', { method: 'POST', body: { dataUri: PNG } })).status, 401, 'upload needs login');
  const svg = await call('/api/files', { token: tokens.nasiba, method: 'POST', body: { dataUri: 'data:image/svg+xml,%3Csvg%2F%3E' } });
  assert.equal(svg.status, 400, 'no SVG');
  assert.equal((await fetch(`${BASE}/api/files/doesnotexist123456`)).status, 404);
});

test('live events reach other users; same-field edits conflict (409)', { skip }, async () => {
  const { json: st } = await call('/api/state', { token: tokens.nasiba });
  const order = st.orders[0];
  // Listen as alexey.
  const ctrl = new AbortController();
  const stream = await fetch(`${BASE}/api/events?token=${tokens.alexey}`, { signal: ctrl.signal });
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  const reader = stream.body.getReader();
  const got = (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      buf += new TextDecoder().decode(value);
      const m = buf.match(/data: (\{.*\})\n/);
      if (m) return JSON.parse(m[1]);
    }
  })();
  assert.equal((await fetch(`${BASE}/api/events?token=bad`)).status, 401);

  const notes = `live-test-${Date.now()}`;
  const ok = await call(`/api/orders/${order.id}`, { token: tokens.nasiba, method: 'PATCH', body: { notes, expected: { notes: order.notes } } });
  assert.equal(ok.status, 200);
  const ev = await Promise.race([got, new Promise((r) => setTimeout(() => r('timeout'), 3000))]);
  ctrl.abort();
  assert.equal(ev.path, `/api/orders/${order.id}`);
  assert.equal(ev.name, 'Насиба');

  const stale = await call(`/api/orders/${order.id}`, { token: tokens.nasiba, method: 'PATCH', body: { notes: 'other', expected: { notes: order.notes } } });
  assert.equal(stale.status, 409, 'someone changed notes since the form opened');
  assert.deepEqual(stale.json.conflicts, ['notes']);
  await call(`/api/orders/${order.id}`, { token: tokens.nasiba, method: 'PATCH', body: { notes: order.notes } });
});

test('client errors are collected and grouped', { skip }, async () => {
  const msg = `TypeError: test-${Date.now()}`;
  const send = () => call('/api/client-errors', { method: 'POST', body: { message: msg, stack: `${msg}\n    at render (index.123abc45.js:1:200)`, url: '/#/orders' } });
  assert.equal((await send()).status, 204);
  assert.equal((await send()).status, 204);
  const list = (await call('/api/audit-log/errors', { token: tokens.nasiba })).json;
  const row = list.find((e) => e.message === msg);
  assert.equal(row.count, 2);
  assert.equal(row.source, 'client');
  assert.equal((await call('/api/audit-log/errors', { token: tokens.alexey })).status, 403);
  await call(`/api/audit-log/errors/${row.id}`, { token: tokens.nasiba, method: 'DELETE' });
});

test('push: key, subscription validation, login required', { skip }, async () => {
  const key = await call('/api/push/key', { token: tokens.nasiba });
  assert.match(key.json.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal((await call('/api/push/key')).status, 401);
  const bad = await call('/api/push/subscribe', { token: tokens.nasiba, method: 'POST', body: { subscription: { endpoint: 'x' } } });
  assert.equal(bad.status, 400);
});

test('client link: safe public view, renew revokes, workshop never gets the token', { skip }, async () => {
  const { json: st } = await call('/api/state', { token: tokens.nasiba });
  const order = st.orders[0];
  const { token } = (await call(`/api/orders/${order.id}/share`, { token: tokens.nasiba, method: 'POST' })).json;
  const pub = await call(`/api/public/orders/${token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.order.number, order.number);
  const text = JSON.stringify(pub.json);
  for (const secret of ['costPrice', 'purchasePrice', 'managerId', 'salar', 'passwordHash']) assert.ok(!text.includes(secret), secret);
  assert.equal((await call(`/api/orders/${order.id}/share`, { token: tokens.alexey, method: 'POST' })).status, 403);
  const workshop = (await call('/api/state', { token: tokens.alexey })).json;
  assert.ok(workshop.orders.every((o) => !o.shareToken), 'no token for those who do not see sums');
  const renewed = (await call(`/api/orders/${order.id}/share?renew=1`, { token: tokens.nasiba, method: 'POST' })).json.token;
  assert.notEqual(renewed, token);
  assert.equal((await call(`/api/public/orders/${token}`)).status, 404, 'old link dead');
  await call(`/api/orders/${order.id}/share`, { token: tokens.nasiba, method: 'DELETE' });
  assert.equal((await call(`/api/public/orders/${renewed}`)).status, 404, 'switched off');
});
