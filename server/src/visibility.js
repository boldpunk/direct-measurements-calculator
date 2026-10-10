// What each employee is allowed to receive from /api/state.
//
// Until now the RBAC lived only in the UI: the screen masked figures with
// "••••", but /api/state shipped every order, payment, purchase price and
// per-order salary to anyone who could log in — visible in the browser's
// network tab. This module is the server-side gate. It is a pure function
// (no database access) so it can be unit-tested with plain fixtures.
//
// The rules mirror what the screens already show, and never strip data a
// user is allowed to edit (an editor saving a row it received with a blanked
// price would overwrite the real price):
//
//   orders at all       any of orders/production/carpentry/rework/tasks/finance .view
//   only own orders     scope "ownOrdersOnly" without "allCompanyData": orders
//                       the employee manages, or has a stage/task assigned in
//   order sum, payments orders.view or finance.view (and "К оплате" history)
//   costs               material/service prices, other expenses, rework cost:
//                       any cost-related financial flag, or finance edit rights
//   outsourcing sums    outsourcePayments.view or a cost flag
//   per-order salaries  salaryPayments.view or seesSalaries
//   clients             clients/orders/proposals view; "ownRequestsOnly" keeps
//                       only clients of the employee's own orders
//   partner contacts    seesSupplierData or outsource.edit

const ORDER_MODULES = ['orders', 'production', 'carpentry', 'rework', 'tasks', 'finance'];

export function accessFor(employee) {
  const p = employee?.permissions || {};
  const f = employee?.financialFlags || {};
  const s = employee?.scopeFlags || {};
  const can = (mod, action) => !!p[mod]?.[action];
  const seesCosts = !!(f.seesPurchasePrices || f.seesCostPrice || f.seesProfit || f.seesMargin
    || can('finance', 'editPayment') || can('finance', 'addPayment'));
  return {
    id: employee?.id || null,
    seesOrders: ORDER_MODULES.some((m) => can(m, 'view')),
    ownOrdersOnly: !s.allCompanyData && !!s.ownOrdersOnly,
    ownClientsOnly: !s.allCompanyData && !!s.ownRequestsOnly,
    seesRevenue: can('orders', 'view') || can('finance', 'view'),
    seesActivity: can('orders', 'view'),
    seesCosts,
    seesOutsourcing: can('outsourcePayments', 'view') || seesCosts,
    seesSalaries: can('salaryPayments', 'view') || !!f.seesSalaries,
    seesClients: can('clients', 'view') || can('orders', 'view') || can('proposals', 'view'),
    seesPartnerContacts: !!f.seesSupplierData || can('outsource', 'edit'),
  };
}

// raw: { orders, stages, tasks, rework, partners, clients, finance, activityByOrder }
// finance: { [orderId]: { payments, materials, services, outsourcing, salaries, otherExpenses, manufacturing } }
export function scopeState(raw, employee) {
  const a = accessFor(employee);

  // ---- Which orders
  let orders = a.seesOrders ? raw.orders : [];
  if (a.ownOrdersOnly) {
    const mine = new Set();
    raw.orders.forEach((o) => { if (o.managerId === a.id) mine.add(o.id); });
    raw.stages.forEach((st) => { if (st.assigneeId === a.id) mine.add(st.orderId); });
    raw.tasks.forEach((t) => { if (t.assigneeId === a.id && t.orderId) mine.add(t.orderId); });
    orders = orders.filter((o) => mine.has(o.id));
  }
  const visible = new Set(orders.map((o) => o.id));

  // ---- Order fields
  const shapedOrders = orders.map((o) => ({
    ...o,
    amount: a.seesRevenue ? o.amount : 0,
    activity: a.seesActivity ? (raw.activityByOrder.get(o.id) || []) : [],
  }));

  // ---- Per-order finance
  const blankPrice = (row) => ({ ...row, unitPrice: 0, purchasePrice: 0 });
  const finance = {};
  for (const [orderId, fin] of Object.entries(raw.finance)) {
    if (!visible.has(orderId)) continue;
    finance[orderId] = {
      payments: a.seesRevenue ? fin.payments : [],
      materials: a.seesCosts ? fin.materials : fin.materials.map(blankPrice),
      services: a.seesCosts ? fin.services : fin.services.map(blankPrice),
      outsourcing: a.seesOutsourcing ? fin.outsourcing : [],
      salaries: a.seesSalaries ? fin.salaries : [],
      otherExpenses: a.seesCosts ? fin.otherExpenses : [],
      manufacturing: fin.manufacturing,
    };
  }

  // ---- Things hanging off orders
  const stages = raw.stages.filter((st) => visible.has(st.orderId));
  // General tasks (no order) stay visible to everyone with the Задачи module.
  const tasks = raw.tasks.filter((t) => (t.orderId ? visible.has(t.orderId) : true));
  const rework = raw.rework
    .filter((r) => visible.has(r.orderId))
    .map((r) => (a.seesCosts ? r : { ...r, costImpact: 0 }));

  // ---- Clients
  let clients = a.seesClients ? raw.clients : [];
  // Someone limited to their own orders shouldn't get the whole client book.
  if (a.ownOrdersOnly) {
    const orderClients = new Set(orders.map((o) => o.clientId));
    clients = clients.filter((c) => orderClients.has(c.id));
  }
  if (a.ownClientsOnly) {
    const mineClients = new Set(raw.orders.filter((o) => o.managerId === a.id).map((o) => o.clientId));
    clients = clients.filter((c) => mineClients.has(c.id));
  }

  // ---- Partners: names are needed for stage assignment; contacts are supplier data.
  const partners = a.seesPartnerContacts ? raw.partners : raw.partners.map((pt) => ({ ...pt, contacts: '' }));

  return { orders: shapedOrders, stages, tasks, rework, finance, clients, partners };
}
