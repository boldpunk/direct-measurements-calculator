import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { renderPurchaseListPdf } from '../pdf.js';
import { CUSTOM_ORDER_STATUSES } from '../constants.js';

const router = Router();

// Orders past these statuses no longer need anything purchased for them —
// mirrors CLOSED_STATUSES/CUSTOM_CLOSED_STATUSES in src/store.js.
const CLOSED_STATUSES = ['Завершён', 'Отменён'];
const CUSTOM_CLOSED_STATUSES = [CUSTOM_ORDER_STATUSES[CUSTOM_ORDER_STATUSES.length - 1]];

// "Заявки на закупку" — a daily shopping list: every manually-entered
// material (source: 'manual', i.e. not already pulled from Склад stock) on
// an active order, aggregated by supplier + name + unit and totaled.
router.get('/purchase-list/pdf', requirePermission('finance', 'view'), ah(async (req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  const closedStatuses = settings?.enableCustomOrderStatuses ? CUSTOM_CLOSED_STATUSES : CLOSED_STATUSES;
  const orders = await prisma.order.findMany({ where: { status: { notIn: closedStatuses }, archivedAt: null } });
  const orderIds = orders.map((o) => o.id);
  const materials = orderIds.length
    ? await prisma.material.findMany({ where: { orderId: { in: orderIds }, source: 'manual' } })
    : [];

  const grouped = new Map();
  for (const m of materials) {
    const supplier = m.supplier || 'Без поставщика';
    const key = `${supplier} :: ${m.name} :: ${m.unit}`;
    const row = grouped.get(key) || { supplier, name: m.name, unit: m.unit, qty: 0 };
    row.qty += m.qty;
    grouped.set(key, row);
  }
  const rows = [...grouped.values()].sort((a, b) => a.supplier.localeCompare(b.supplier) || a.name.localeCompare(b.name));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="purchase-list.pdf"');
  await renderPurchaseListPdf(res, { rows, settings });
}));

// Отчёты (Финансы → «Отчёты»): orders created in [from, to] grouped by
// manager and by product type, the КП funnel, and lead times (start → the
// moment the order was closed, from its history). Profit only for those who
// may see it.
const DONE_RE = /→ (Завершён|Готово)$/;

router.get('/summary', requirePermission('finance', 'view'), ah(async (req, res) => {
  const from = Number(req.query.from) || 0;
  const to = Number(req.query.to) || Date.now() + 86400000;
  const flags = req.employee.financialFlags || {};
  const seesProfit = !!(flags.seesProfit || flags.seesCostPrice);

  const orders = await prisma.order.findMany({
    where: { archivedAt: null, createdAt: { gte: from, lte: to }, status: { not: 'Отменён' } },
    select: { id: true, managerId: true, productType: true, amount: true, startDate: true, deadline: true, createdAt: true, status: true },
  });
  const ids = orders.map((o) => o.id);
  const sumBy = async (model, fields) => {
    const rows = await prisma[model].findMany({ where: { orderId: { in: ids } }, select: { orderId: true, ...Object.fromEntries(fields.map((f) => [f, true])) } });
    const m = new Map();
    rows.forEach((r) => m.set(r.orderId, (m.get(r.orderId) || 0) + (fields.length === 2 ? (Number(r[fields[0]]) || 0) * (Number(r[fields[1]]) || 0) : Number(r[fields[0]]) || 0)));
    return m;
  };
  const [paid, materials, services, outsourcing, salaries, other, employees, proposals, doneActivity] = await Promise.all([
    sumBy('payment', ['amount']),
    seesProfit ? sumBy('material', ['qty', 'unitPrice']) : new Map(),
    seesProfit ? sumBy('orderService', ['qty', 'unitPrice']) : new Map(),
    seesProfit ? sumBy('outsourceExpense', ['amount']) : new Map(),
    seesProfit ? sumBy('salaryExpense', ['amount']) : new Map(),
    seesProfit ? sumBy('otherExpense', ['amount']) : new Map(),
    prisma.employee.findMany({ select: { id: true, name: true } }),
    prisma.commercialProposal.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { status: true, total: true, orderId: true } }),
    prisma.activity.findMany({ where: { orderId: { in: ids }, text: { contains: '→' } }, select: { orderId: true, text: true, timestamp: true } }),
  ]);
  const names = new Map(employees.map((e) => [e.id, e.name]));
  const cost = (id) => [materials, services, outsourcing, salaries, other].reduce((s, m) => s + (m.get(id) || 0), 0);

  const group = (keyOf, labelOf) => {
    const g = new Map();
    for (const o of orders) {
      const k = keyOf(o) || '';
      const row = g.get(k) || { key: k, label: labelOf(k), orders: 0, revenue: 0, paid: 0, profit: 0 };
      row.orders += 1;
      row.revenue += Number(o.amount) || 0;
      row.paid += paid.get(o.id) || 0;
      row.profit += (Number(o.amount) || 0) - cost(o.id);
      g.set(k, row);
    }
    return [...g.values()]
      .map((r) => ({ ...r, avgCheck: r.orders ? r.revenue / r.orders : 0, profit: seesProfit ? r.profit : null }))
      .sort((a, b) => b.revenue - a.revenue);
  };

  // Lead time: start date → when the order was closed (its history entry).
  const closedAt = new Map();
  doneActivity.forEach((a) => { if (DONE_RE.test(a.text) && (!closedAt.has(a.orderId) || a.timestamp > closedAt.get(a.orderId))) closedAt.set(a.orderId, a.timestamp); });
  const day = 86400000;
  const lead = orders.filter((o) => closedAt.has(o.id)).map((o) => {
    const start = o.startDate ? new Date(`${o.startDate}T00:00:00`).getTime() : o.createdAt;
    const end = closedAt.get(o.id);
    const deadlineEnd = o.deadline ? new Date(`${o.deadline}T23:59:59`).getTime() : Infinity;
    return { days: Math.max(0, (end - start) / day), onTime: end <= deadlineEnd };
  });

  const funnel = {};
  proposals.forEach((p) => { funnel[p.status] = (funnel[p.status] || 0) + 1; });
  const decided = (funnel['Принято'] || 0) + (funnel['Отклонено'] || 0);

  res.json({
    totals: { orders: orders.length, revenue: orders.reduce((s, o) => s + (Number(o.amount) || 0), 0) },
    byManager: group((o) => o.managerId, (k) => names.get(k) || 'Без ответственного'),
    byType: group((o) => o.productType, (k) => k || 'Без типа'),
    proposals: { total: proposals.length, byStatus: funnel, acceptedRate: decided ? (funnel['Принято'] || 0) / decided : null, withOrder: proposals.filter((p) => p.orderId).length },
    leadTime: {
      closed: lead.length,
      avgDays: lead.length ? lead.reduce((s, l) => s + l.days, 0) / lead.length : null,
      onTimeRate: lead.length ? lead.filter((l) => l.onTime).length / lead.length : null,
    },
    seesProfit,
  });
}));

export default router;
