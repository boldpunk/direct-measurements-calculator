// Standalone company payroll ledger — accrual (what's owed) separated from
// payout (what's actually been paid), not tied to any Order. This is
// distinct from the per-order SalaryExpense entries in orders.js, which
// feed an individual order's cost price; this ledger answers "how much do
// we owe/have we paid each employee overall". Backend is the source of
// truth for every money check — the frontend never decides whether a payout
// is allowed.
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid, todayISO } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';
import { renderSalaryAccrualReportPdf } from '../pdf.js';

const router = Router();

function totalsFor(accrual) {
  const paid = (accrual.payouts || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remaining = Math.max(0, (Number(accrual.amount) || 0) - paid);
  const status = paid <= 0 ? 'Не выплачено' : remaining <= 0 ? 'Выплачено' : 'Частично выплачено';
  return { paid, remaining, status };
}

router.post('/accruals', requirePermission('salaryPayments', 'create'), ah(async (req, res) => {
  const body = req.body || {};
  if (!body.employeeId) return res.status(400).json({ error: 'Выберите сотрудника' });
  const amount = Number(body.amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'Сумма должна быть больше 0' });

  const employee = await prisma.employee.findUnique({ where: { id: body.employeeId } });
  if (!employee) return res.status(404).json({ error: 'Сотрудник не найден' });

  const accrual = await prisma.salaryAccrual.create({
    data: {
      id: body.id || uid('acr'), employeeId: employee.id, period: body.period || '',
      type: body.type || 'Другое', amount, comment: body.comment || '',
      createdById: req.employee?.id || null, createdAt: Date.now(), updatedAt: Date.now(),
    },
  });
  await logAudit(req, { action: 'salaryAccrual.create', entityType: 'salaryAccrual', entityId: accrual.id, newValue: accrual });
  res.status(201).json({ ...accrual, payouts: [], paid: 0, remaining: amount, status: 'Не выплачено' });
}));

router.patch('/accruals/:id', requirePermission('salaryPayments', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.salaryAccrual.findUnique({ where: { id: req.params.id }, include: { payouts: true } });
  if (!before) return res.status(404).json({ error: 'Начисление не найдено' });
  const { paid } = totalsFor(before);

  const data = { updatedAt: Date.now() };
  if (body.employeeId !== undefined) data.employeeId = body.employeeId;
  if (body.period !== undefined) data.period = body.period;
  if (body.type !== undefined) data.type = body.type;
  if (body.comment !== undefined) data.comment = body.comment;
  if (body.amount !== undefined) {
    const amount = Number(body.amount) || 0;
    // Can't shrink an accrual below what's already been paid out — that
    // would make a payout retroactively exceed its own accrual.
    if (amount < paid) {
      return res.status(400).json({ error: `Нельзя уменьшить начисление ниже уже выплаченной суммы (${paid})` });
    }
    data.amount = amount;
  }

  const accrual = await prisma.salaryAccrual.update({ where: { id: before.id }, data, include: { payouts: true } });
  await logAudit(req, { action: 'salaryAccrual.update', entityType: 'salaryAccrual', entityId: accrual.id, oldValue: before, newValue: accrual });
  res.json({ ...accrual, ...totalsFor(accrual) });
}));

router.delete('/accruals/:id', requirePermission('salaryPayments', 'delete'), ah(async (req, res) => {
  const before = await prisma.salaryAccrual.findUnique({ where: { id: req.params.id }, include: { payouts: true } });
  if (!before) return res.status(204).end();
  if (before.payouts.length) {
    return res.status(400).json({ error: 'Нельзя удалить начисление с выплатами — сначала удалите выплаты' });
  }
  await prisma.salaryAccrual.delete({ where: { id: before.id } });
  await logAudit(req, { action: 'salaryAccrual.delete', entityType: 'salaryAccrual', entityId: before.id, oldValue: before });
  res.status(204).end();
}));

// ---- Payouts ----

router.post('/accruals/:id/payouts', requirePermission('salaryPayments', 'create'), ah(async (req, res) => {
  const body = req.body || {};
  const amount = Number(body.amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'Сумма выплаты должна быть больше 0' });

  const result = await prisma.$transaction(async (tx) => {
    const accrual = await tx.salaryAccrual.findUnique({ where: { id: req.params.id }, include: { payouts: true } });
    if (!accrual) return { error: 404 };
    const { remaining } = totalsFor(accrual);
    if (amount > remaining) {
      return { error: 400, message: `Сумма выплаты превышает задолженность по зарплате (остаток: ${remaining})` };
    }
    const payout = await tx.salaryPayout.create({
      data: {
        id: body.id || uid('pyt'), accrualId: accrual.id, employeeId: accrual.employeeId, amount,
        paymentDate: body.paymentDate || todayISO(), paymentMethod: body.paymentMethod || '',
        comment: body.comment || '', createdById: req.employee?.id || null, createdAt: Date.now(),
      },
    });
    await tx.salaryAccrual.update({ where: { id: accrual.id }, data: { updatedAt: Date.now() } });
    return { payout, accrual };
  });

  if (result.error === 404) return res.status(404).json({ error: 'Начисление не найдено' });
  if (result.error === 400) return res.status(400).json({ error: result.message });
  await logAudit(req, { action: 'salaryPayout.create', entityType: 'salaryPayout', entityId: result.payout.id, newValue: result.payout });
  res.status(201).json(result.payout);
}));

router.delete('/payouts/:id', requirePermission('salaryPayments', 'delete'), ah(async (req, res) => {
  const before = await prisma.salaryPayout.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(204).end();
  await prisma.salaryPayout.delete({ where: { id: before.id } });
  await prisma.salaryAccrual.update({ where: { id: before.accrualId }, data: { updatedAt: Date.now() } }).catch(() => null);
  await logAudit(req, { action: 'salaryPayout.delete', entityType: 'salaryPayout', entityId: before.id, oldValue: before });
  res.status(204).end();
}));

// ---- PDF report ----

router.get('/report/pdf', requirePermission('salaryPayments', 'view'), ah(async (req, res) => {
  const [accruals, employees, settings] = await Promise.all([
    prisma.salaryAccrual.findMany({ include: { payouts: true }, orderBy: { createdAt: 'desc' } }),
    prisma.employee.findMany(),
    prisma.settings.findUnique({ where: { id: 'default' } }),
  ]);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const rows = accruals.map((a) => {
    const t = totalsFor(a);
    return { employeeName: employeeById.get(a.employeeId)?.name || '—', amount: a.amount, paid: t.paid, remaining: t.remaining, status: t.status };
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="salary-report.pdf"');
  renderSalaryAccrualReportPdf(res, { rows, settings });
}));

export default router;
