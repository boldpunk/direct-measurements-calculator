import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { DEFAULT_SETTINGS } from '../constants.js';

const router = Router();

const basicEmployee = (e) => ({ id: e.id, name: e.name, role: e.role, phone: e.phone, email: e.email });
const fullEmployee = (e) => ({
  ...basicEmployee(e),
  accessRole: e.accessRole, permissions: e.permissions, financialFlags: e.financialFlags,
  scopeFlags: e.scopeFlags, isBlocked: e.isBlocked,
});

// Returns the full app state in the same shape src/store.js keeps in memory,
// so the frontend can hydrate its local cache in one round trip.
router.get('/', ah(async (req, res) => {
  const [orders, activity, stages, tasks, rework, partners, employees, clients, payments, materials, outsourcing, salaries, otherExpenses, settingsRow] =
    await Promise.all([
      prisma.order.findMany(),
      prisma.activity.findMany({ orderBy: { timestamp: 'desc' } }),
      prisma.stage.findMany({ orderBy: { position: 'asc' } }),
      prisma.task.findMany(),
      prisma.rework.findMany(),
      prisma.partner.findMany(),
      prisma.employee.findMany(),
      prisma.client.findMany(),
      prisma.payment.findMany(),
      prisma.material.findMany(),
      prisma.outsourceExpense.findMany(),
      prisma.salaryExpense.findMany(),
      prisma.otherExpense.findMany(),
      prisma.settings.findUnique({ where: { id: 'default' } }),
    ]);

  const activityByOrder = new Map();
  activity.forEach((a) => {
    if (!activityByOrder.has(a.orderId)) activityByOrder.set(a.orderId, []);
    activityByOrder.get(a.orderId).push({ id: a.id, timestamp: a.timestamp, text: a.text });
  });

  const financeByOrder = {};
  const ensure = (orderId) => {
    if (!financeByOrder[orderId]) financeByOrder[orderId] = { payments: [], materials: [], outsourcing: [], salaries: [], otherExpenses: [] };
    return financeByOrder[orderId];
  };
  payments.forEach((p) => ensure(p.orderId).payments.push(p));
  materials.forEach((m) => ensure(m.orderId).materials.push(m));
  outsourcing.forEach((o) => ensure(o.orderId).outsourcing.push(o));
  salaries.forEach((s) => ensure(s.orderId).salaries.push(s));
  otherExpenses.forEach((e) => ensure(e.orderId).otherExpenses.push(e));

  const shapedOrders = orders.map((o) => ({
    ...o,
    activity: activityByOrder.get(o.id) || [],
  }));

  const shapedStages = stages.map((s) => ({
    id: s.id,
    orderId: s.orderId,
    defKey: s.defKey,
    name: s.name,
    type: s.type,
    service: s.service,
    order: s.position,
    assigneeId: s.assigneeId,
    partnerId: s.partnerId,
    deadline: s.deadline,
    status: s.status,
    skipped: s.skipped,
  }));

  const settings = settingsRow
    ? { companyName: settingsRow.companyName, currency: settingsRow.currency, stageBufferDays: settingsRow.stageBufferDays }
    : { ...DEFAULT_SETTINGS };

  res.json({
    orders: shapedOrders,
    stages: shapedStages,
    tasks,
    rework,
    partners,
    employees: req.employee?.permissions?.employees?.edit
      ? employees.map(fullEmployee)
      : employees.map((e) => (e.id === req.employee?.id ? fullEmployee(e) : basicEmployee(e))),
    clients,
    finance: financeByOrder,
    orderSeq: settingsRow ? settingsRow.orderSeq : 100,
    settings,
  });
}));

export default router;
