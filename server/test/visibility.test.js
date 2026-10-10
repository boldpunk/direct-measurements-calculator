// The server-side data gate. If one of these fails, some role is about to
// receive (or lose) data it shouldn't — check the rule before the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessFor, scopeState, orderVisibleTo } from '../src/visibility.js';

const perms = (mods) => Object.fromEntries(Object.entries(mods).map(([m, acts]) => [m, Object.fromEntries(acts.map((a) => [a, true]))]));

const admin = {
  id: 'e_admin',
  permissions: perms({ orders: ['view'], finance: ['view', 'addPayment', 'editPayment'], clients: ['view'], salaryPayments: ['view'], outsourcePayments: ['view'], outsource: ['edit'] }),
  financialFlags: { seesPurchasePrices: true, seesSalaries: true, seesSupplierData: true },
  scopeFlags: { allCompanyData: true },
};
const worker = { id: 'e_work', permissions: perms({ production: ['view'] }), financialFlags: {}, scopeFlags: {} };
const installer = { id: 'e_inst', permissions: perms({ tasks: ['view'] }), financialFlags: {}, scopeFlags: { ownOrdersOnly: true } };
const nobody = { id: 'e_none', permissions: {}, financialFlags: {}, scopeFlags: {} };

function fixture() {
  return {
    orders: [
      { id: 'o1', managerId: 'e_admin', clientId: 'c1', amount: 1000 },
      { id: 'o2', managerId: 'e_admin', clientId: 'c2', amount: 2000 },
    ],
    stages: [{ id: 's1', orderId: 'o1', assigneeId: 'e_work' }, { id: 's2', orderId: 'o2', assigneeId: null }],
    tasks: [{ id: 't1', orderId: 'o2', assigneeId: 'e_inst' }, { id: 't2', orderId: null, assigneeId: null }],
    rework: [{ id: 'r1', orderId: 'o1', costImpact: 50 }],
    partners: [{ id: 'p1', name: 'Распил', contacts: '+998 90 000' }],
    clients: [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }],
    finance: {
      o1: {
        payments: [{ amount: 500 }],
        materials: [{ name: 'ЛДСП', unitPrice: 10, purchasePrice: 7 }],
        services: [{ name: 'Доставка', unitPrice: 5, purchasePrice: 3 }],
        outsourcing: [{ amount: 40 }], salaries: [{ amount: 30 }], otherExpenses: [{ amount: 20 }],
        manufacturing: [{ date: '2026-01-01' }],
      },
      o2: { payments: [], materials: [], services: [], outsourcing: [], salaries: [], otherExpenses: [], manufacturing: [] },
    },
    activityByOrder: new Map([['o1', [{ text: 'создан' }]]]),
  };
}

test('admin gets everything untouched', () => {
  const out = scopeState(fixture(), admin);
  assert.equal(out.orders.length, 2);
  assert.equal(out.orders[0].amount, 1000);
  assert.equal(out.finance.o1.materials[0].purchasePrice, 7);
  assert.equal(out.finance.o1.salaries.length, 1);
  assert.equal(out.finance.o1.payments.length, 1);
  assert.equal(out.rework[0].costImpact, 50);
  assert.equal(out.clients.length, 2);
  assert.equal(out.partners[0].contacts, '+998 90 000');
});

test('production worker sees orders but no money', () => {
  const out = scopeState(fixture(), worker);
  assert.equal(out.orders.length, 2);
  assert.ok(out.orders.every((o) => o.amount === 0));
  assert.deepEqual(out.orders[0].activity, []);
  const fin = out.finance.o1;
  assert.deepEqual(fin.payments, []);
  assert.equal(fin.materials[0].unitPrice, 0);
  assert.equal(fin.materials[0].purchasePrice, 0);
  assert.equal(fin.materials[0].name, 'ЛДСП', 'names stay — the worker needs the cutting list');
  assert.deepEqual(fin.outsourcing, []);
  assert.deepEqual(fin.salaries, []);
  assert.deepEqual(fin.otherExpenses, []);
  assert.equal(fin.manufacturing.length, 1);
  assert.equal(out.rework[0].costImpact, 0);
  assert.deepEqual(out.clients, []);
  assert.equal(out.partners[0].contacts, '');
  assert.equal(out.partners[0].name, 'Распил');
});

test('own-orders-only staff get just the orders they are assigned in', () => {
  const out = scopeState(fixture(), installer);
  assert.deepEqual(out.orders.map((o) => o.id), ['o2']);
  assert.deepEqual(Object.keys(out.finance), ['o2']);
  assert.deepEqual(out.stages.map((s) => s.id), ['s2']);
  assert.deepEqual(out.tasks.map((t) => t.id).sort(), ['t1', 't2'], 'general tasks stay visible');
  assert.deepEqual(out.rework, []);
});

test('no order modules → no orders, no finance', () => {
  const out = scopeState(fixture(), nobody);
  assert.deepEqual(out.orders, []);
  assert.deepEqual(out.finance, {});
  assert.deepEqual(out.stages, []);
});

test('finance editors keep real prices (saving a blanked row would overwrite them)', () => {
  const editor = { id: 'e_fin', permissions: perms({ finance: ['view', 'editPayment'] }), financialFlags: {}, scopeFlags: {} };
  assert.equal(accessFor(editor).seesCosts, true);
  const out = scopeState(fixture(), editor);
  assert.equal(out.finance.o1.materials[0].purchasePrice, 7);
});

test('orderVisibleTo matches the list rule', () => {
  const o2 = { id: 'o2', managerId: 'e_admin' };
  assert.equal(orderVisibleTo(admin, o2), true);
  assert.equal(orderVisibleTo(installer, o2, ['e_inst']), true);
  assert.equal(orderVisibleTo(installer, o2, ['e_work']), false);
  assert.equal(orderVisibleTo(nobody, o2), false);
});
