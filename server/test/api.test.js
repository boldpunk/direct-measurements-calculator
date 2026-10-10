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
