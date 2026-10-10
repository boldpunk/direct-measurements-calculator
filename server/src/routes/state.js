import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { DEFAULT_SETTINGS } from '../constants.js';
import { scopeState } from '../visibility.js';
import { brandingAssetUrl } from '../branding-assets.js';

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
  const seesPayroll = !!req.employee?.permissions?.salaryPayments?.view;
  const [orders, stages, tasks, rework, partners, employees, clients, payments, materials, orderServices, outsourcing, salaries, otherExpenses, manufacturingEntries, settingsRow, salaryAccruals, salaryPayouts] =
    await Promise.all([
      prisma.order.findMany({ where: { archivedAt: null } }), // archived orders are listed separately
      prisma.stage.findMany({ orderBy: { position: 'asc' } }),
      prisma.task.findMany(),
      prisma.rework.findMany(),
      prisma.partner.findMany(),
      prisma.employee.findMany(),
      prisma.client.findMany(),
      prisma.payment.findMany(),
      prisma.material.findMany(),
      prisma.orderService.findMany(),
      prisma.outsourceExpense.findMany(),
      prisma.salaryExpense.findMany(),
      prisma.otherExpense.findMany(),
      prisma.manufacturingEntry.findMany(),
      prisma.settings.findUnique({ where: { id: 'default' } }),
      // Payroll ledger is sensitive — only fetched for viewers who actually
      // hold the permission, same reasoning as the employees list below.
      seesPayroll ? prisma.salaryAccrual.findMany({ orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
      seesPayroll ? prisma.salaryPayout.findMany({ orderBy: { paymentDate: 'desc' } }) : Promise.resolve([]),
    ]);


  const financeByOrder = {};
  const ensure = (orderId) => {
    if (!financeByOrder[orderId]) financeByOrder[orderId] = { payments: [], materials: [], services: [], outsourcing: [], salaries: [], otherExpenses: [], manufacturing: [] };
    return financeByOrder[orderId];
  };
  payments.forEach((p) => ensure(p.orderId).payments.push(p));
  materials.forEach((m) => ensure(m.orderId).materials.push(m));
  orderServices.forEach((s) => ensure(s.orderId).services.push(s));
  outsourcing.forEach((o) => ensure(o.orderId).outsourcing.push(o));
  salaries.forEach((s) => ensure(s.orderId).salaries.push(s));
  otherExpenses.forEach((e) => ensure(e.orderId).otherExpenses.push(e));
  manufacturingEntries.forEach((m) => ensure(m.orderId).manufacturing.push(m));


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
    ? {
      companyName: settingsRow.companyName, currency: settingsRow.currency, stageBufferDays: settingsRow.stageBufferDays,
      orderStatusColors: settingsRow.orderStatusColors, logoUrl: brandingAssetUrl('logo', settingsRow.logoUrl), faviconUrl: brandingAssetUrl('favicon', settingsRow.faviconUrl),
      enableProductType: settingsRow.enableProductType, enableWeight: settingsRow.enableWeight, enableStages: settingsRow.enableStages,
      enableExpenses: settingsRow.enableExpenses, enableManufacturingDates: settingsRow.enableManufacturingDates,
      enableServicesFinanceReport: settingsRow.enableServicesFinanceReport, enablePurchaseSaleSplit: settingsRow.enablePurchaseSaleSplit,
      enablePdfExtras: settingsRow.enablePdfExtras, enablePurchaseList: settingsRow.enablePurchaseList,
      enableCustomOrderStatuses: settingsRow.enableCustomOrderStatuses,
      companySlogan: settingsRow.companySlogan, companyAddress: settingsRow.companyAddress,
      companyPhone: settingsRow.companyPhone, companyInstagram: settingsRow.companyInstagram,
      companyWebsite: settingsRow.companyWebsite, brandColor: settingsRow.brandColor,
    }
    : { ...DEFAULT_SETTINGS };

  // Cut the data down to what this employee may see — see visibility.js.
  const scoped = scopeState({
    orders, stages: shapedStages, tasks, rework, partners, clients,
    finance: financeByOrder,
  }, req.employee);

  res.json({
    orders: scoped.orders,
    stages: scoped.stages,
    tasks: scoped.tasks,
    rework: scoped.rework,
    partners: scoped.partners,
    employees: req.employee?.permissions?.employees?.edit
      ? employees.map(fullEmployee)
      : employees.map((e) => (e.id === req.employee?.id ? fullEmployee(e) : basicEmployee(e))),
    clients: scoped.clients,
    finance: scoped.finance,
    orderSeq: settingsRow ? settingsRow.orderSeq : 100,
    settings,
    salaryAccruals,
    salaryPayouts,
  });
}));

export default router;
