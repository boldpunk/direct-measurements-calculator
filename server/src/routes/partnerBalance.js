// Взаиморасчёты с партнёрами — долг / кредит.
//
// The journal (PartnerBalanceTransaction) is the single source of truth: no
// mutable "partner.balance" column exists anywhere, so every figure shown in
// Финансы is derived from the operations that produced it and can always be
// traced back. Balance = SUM(DEBIT) - SUM(CREDIT), computed separately per
// currency.
//
//   DEBIT  → партнёр должен нам  (balance up)
//   CREDIT → мы должны партнёру  (balance down)
//
// The client never sends a balance: it sends "add 3 000 000 CREDIT" and the
// backend reads the current balance, computes the new one, and stores both
// on the row — inside one database transaction, so two people adding an
// operation at the same time can't produce two rows claiming the same
// previousBalance.
//
// These rows are NOT money movement. Recording "партнёр должен нам 10 000 000"
// creates no income and no expense anywhere in Финансы; when a line does
// correspond to money that actually moved, it links to the OutsourceExpense
// that recorded it instead of duplicating the amount.
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid, todayISO } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';
import { renderPartnerBalanceReportPdf } from '../pdf.js';
import { DEFAULT_SETTINGS } from '../constants.js';

const router = Router();

const TYPES = ['DEBIT', 'CREDIT'];

// Money is stored as Float (matching the rest of the app), so every computed
// figure is rounded to 2 decimals right where it's produced — otherwise
// 0.1 + 0.2 drift accumulates down a long ledger.
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// yyyy-mm-dd → dd.mm.yyyy, for the auto-generated сторно comment (dates are
// shown Russian-style everywhere else in the app).
function fmtDate(iso) {
  const [y, m, d] = String(iso || '').split('-');
  return y && m && d ? `${d}.${m}.${y}` : String(iso || '');
}

function signedAmount(tx) {
  return tx.type === 'CREDIT' ? -round2(tx.amount) : round2(tx.amount);
}

export function statusFor(balance) {
  if (round2(balance) > 0) return 'Нам должны';
  if (round2(balance) < 0) return 'Мы должны';
  return 'Закрыт';
}

// Current balance for one (partner, currency) pair, straight from the journal.
// Runs inside the caller's transaction so the read and the insert that
// follows it see the same rows.
async function currentBalance(tx, partnerId, currency) {
  const rows = await tx.partnerBalanceTransaction.findMany({
    where: { partnerId, currency },
    select: { type: true, amount: true },
  });
  return round2(rows.reduce((sum, r) => sum + signedAmount(r), 0));
}

function shapeTx(row) {
  return {
    id: row.id,
    partnerId: row.partnerId,
    type: row.type,
    amount: round2(row.amount),
    currency: row.currency,
    date: row.date,
    comment: row.comment,
    previousBalance: round2(row.previousBalance),
    balanceAfter: round2(row.balanceAfter),
    isInitial: row.isInitial,
    reversalOfId: row.reversalOfId,
    isReversed: !!row.reversedBy,
    reversedById: row.reversedBy?.id || null,
    outsourceExpenseId: row.outsourceExpenseId,
    outsourceExpenseLabel: row.outsourceExpense
      ? `${row.outsourceExpense.name} · заказ #${row.outsourceExpense.order?.number ?? '—'}`
      : '',
    createdById: row.createdById,
    createdByName: row.createdBy?.name || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const txInclude = {
  createdBy: { select: { name: true } },
  reversedBy: { select: { id: true } },
  outsourceExpense: { select: { name: true, order: { select: { number: true } } } },
};

// Group a partner's rows into one summary per currency. A partner trading in
// both $ and so'm gets two independent balances — they are never added up.
function summarise(rows) {
  const byCurrency = new Map();
  for (const r of rows) {
    const cur = byCurrency.get(r.currency) || { currency: r.currency, debit: 0, credit: 0, count: 0 };
    if (r.type === 'CREDIT') cur.credit = round2(cur.credit + round2(r.amount));
    else cur.debit = round2(cur.debit + round2(r.amount));
    cur.count += 1;
    byCurrency.set(r.currency, cur);
  }
  return [...byCurrency.values()].map((c) => {
    const balance = round2(c.debit - c.credit);
    return { ...c, balance, status: statusFor(balance) };
  }).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

// ---- Summary across all partners (Финансы → Партнёры: долг / кредит) ----
//
// `from`/`to` narrow which operations are counted. With no period, the
// figures are the partner's current standing; with a period, they are the
// turnover inside it — the UI labels the columns accordingly.
router.get('/summary', requirePermission('partnerBalance', 'view'), ah(async (req, res) => {
  const { from, to, q, status, currency } = req.query;
  const where = {};
  if (from) where.date = { ...(where.date || {}), gte: String(from) };
  if (to) where.date = { ...(where.date || {}), lte: String(to) };

  const [partners, rows, settings] = await Promise.all([
    prisma.partner.findMany({ orderBy: { name: 'asc' } }),
    prisma.partnerBalanceTransaction.findMany({
      where,
      select: { partnerId: true, type: true, amount: true, currency: true },
    }),
    prisma.settings.findUnique({ where: { id: 'default' } }),
  ]);

  const byPartner = new Map();
  rows.forEach((r) => {
    const list = byPartner.get(r.partnerId) || [];
    list.push(r);
    byPartner.set(r.partnerId, list);
  });

  const instanceCurrency = settings?.currency || DEFAULT_SETTINGS.currency;
  // Currencies actually present in the ledger, so the filter only ever offers
  // real options — plus the instance currency, which is the sensible default
  // even before anyone has entered an operation in it.
  const currencies = [...new Set([instanceCurrency, ...rows.map((r) => r.currency)])];
  // Partners with no operations still need a currency to be listed under.
  // When the user is filtering by one, that's the currency they're looking
  // at — otherwise such a partner would vanish from every view except the
  // instance's own currency.
  const defaultCurrency = currency || instanceCurrency;

  let result = [];
  for (const p of partners) {
    const summaries = summarise(byPartner.get(p.id) || []);
    for (const s of summaries) {
      result.push({ partnerId: p.id, partnerName: p.name, contacts: p.contacts, ...s });
    }
    // A partner with no operations at all still belongs in the list (balance
    // 0, «Закрыт») so the section doesn't look like the directory is empty.
    if (!summaries.length) {
      result.push({
        partnerId: p.id, partnerName: p.name, contacts: p.contacts,
        currency: defaultCurrency, debit: 0, credit: 0, count: 0, balance: 0, status: 'Закрыт',
      });
    }
  }

  if (currency) result = result.filter((r) => r.currency === currency);
  if (status) result = result.filter((r) => r.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    result = result.filter((r) => r.partnerName.toLowerCase().includes(needle));
  }

  // Totals only make sense inside one currency, so they're reported per
  // currency and the UI shows the set the current filter selects.
  const totalsByCurrency = {};
  for (const r of result) {
    const t = totalsByCurrency[r.currency] || { currency: r.currency, owedToUs: 0, owedByUs: 0, closed: 0, active: 0, net: 0, debit: 0, credit: 0 };
    t.debit = round2(t.debit + r.debit);
    t.credit = round2(t.credit + r.credit);
    if (r.balance > 0) { t.owedToUs = round2(t.owedToUs + r.balance); t.active += 1; }
    else if (r.balance < 0) { t.owedByUs = round2(t.owedByUs + Math.abs(r.balance)); t.active += 1; }
    else t.closed += 1;
    t.net = round2(t.owedToUs - t.owedByUs);
    totalsByCurrency[r.currency] = t;
  }

  res.json({
    rows: result.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || a.partnerName.localeCompare(b.partnerName)),
    totals: Object.values(totalsByCurrency),
    currencies,
    defaultCurrency: instanceCurrency,
  });
}));

// ---- One partner: balances per currency + full operation history ----
router.get('/partners/:id', requirePermission('partnerBalance', 'view'), ah(async (req, res) => {
  const partner = await prisma.partner.findUnique({ where: { id: req.params.id } });
  if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });

  const [rows, settings] = await Promise.all([
    prisma.partnerBalanceTransaction.findMany({
      where: { partnerId: partner.id },
      include: txInclude,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.settings.findUnique({ where: { id: 'default' } }),
  ]);

  res.json({
    partner: { id: partner.id, name: partner.name, contacts: partner.contacts },
    balances: summarise(rows),
    transactions: rows.map(shapeTx),
    defaultCurrency: settings?.currency || DEFAULT_SETTINGS.currency,
  });
}));

// Outsourcing payments already recorded for this partner, offered as the
// optional "фактическая оплата" link when adding an operation. Listing them
// does not import them: linking never changes a balance by itself.
router.get('/partners/:id/outsource-expenses', requirePermission('partnerBalance', 'view'), ah(async (req, res) => {
  const expenses = await prisma.outsourceExpense.findMany({
    where: { partnerId: req.params.id },
    include: { order: { select: { number: true, clientName: true } } },
  });
  res.json(expenses.map((e) => ({
    id: e.id,
    name: e.name,
    amount: round2(e.amount),
    orderNumber: e.order?.number ?? null,
    clientName: e.order?.clientName || '',
  })));
}));

// ---- Add an operation ----
router.post('/partners/:id/transactions', requirePermission('partnerBalance', 'create'), ah(async (req, res) => {
  const body = req.body || {};
  const type = String(body.type || '').toUpperCase();
  if (!TYPES.includes(type)) return res.status(400).json({ error: 'Тип операции должен быть DEBIT или CREDIT' });
  const amount = round2(body.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Сумма должна быть больше 0' });

  const partner = await prisma.partner.findUnique({ where: { id: req.params.id } });
  if (!partner) return res.status(404).json({ error: 'Партнёр не найден' });

  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  const currency = body.currency || settings?.currency || DEFAULT_SETTINGS.currency;

  if (body.outsourceExpenseId) {
    const expense = await prisma.outsourceExpense.findUnique({ where: { id: body.outsourceExpenseId } });
    if (!expense) return res.status(400).json({ error: 'Аутсорс-платёж не найден' });
    if (expense.partnerId !== partner.id) return res.status(400).json({ error: 'Этот платёж относится к другому партнёру' });
  }

  // One transaction around read-balance → insert: the row's previousBalance
  // is guaranteed to be the balance that existed the moment it was written.
  const created = await prisma.$transaction(async (tx) => {
    const previousBalance = await currentBalance(tx, partner.id, currency);
    // Deliberately allowed to cross zero in both directions — a credit larger
    // than the balance simply flips it negative ("мы должны"), it is not an error.
    const balanceAfter = round2(previousBalance + (type === 'CREDIT' ? -amount : amount));
    return tx.partnerBalanceTransaction.create({
      data: {
        id: uid('pbt'),
        partnerId: partner.id,
        type,
        amount,
        currency,
        date: body.date || todayISO(),
        comment: body.comment || '',
        previousBalance,
        balanceAfter,
        isInitial: !!body.isInitial,
        outsourceExpenseId: body.outsourceExpenseId || null,
        createdById: req.employee?.id || null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      include: txInclude,
    });
  });

  await logAudit(req, {
    action: 'partnerBalance.create',
    entityType: 'partnerBalanceTransaction',
    entityId: created.id,
    newValue: { partnerName: partner.name, ...shapeTx(created) },
  });
  res.status(201).json(shapeTx(created));
}));

// ---- Сторно ----
//
// Financial history is never deleted or rewritten. Cancelling a mistake adds
// an opposite operation linked to the original, so both the error and its
// correction stay visible and the balance moves by the right amount.
router.post('/transactions/:id/reverse', requirePermission('partnerBalance', 'cancel'), ah(async (req, res) => {
  const original = await prisma.partnerBalanceTransaction.findUnique({
    where: { id: req.params.id },
    include: { reversedBy: { select: { id: true } }, partner: { select: { name: true } } },
  });
  if (!original) return res.status(404).json({ error: 'Операция не найдена' });
  if (original.reversedBy) return res.status(400).json({ error: 'Операция уже сторнирована' });
  if (original.reversalOfId) return res.status(400).json({ error: 'Нельзя сторнировать сторно-операцию' });

  const type = original.type === 'CREDIT' ? 'DEBIT' : 'CREDIT';
  const amount = round2(original.amount);

  const created = await prisma.$transaction(async (tx) => {
    const previousBalance = await currentBalance(tx, original.partnerId, original.currency);
    const balanceAfter = round2(previousBalance + (type === 'CREDIT' ? -amount : amount));
    return tx.partnerBalanceTransaction.create({
      data: {
        id: uid('pbt'),
        partnerId: original.partnerId,
        type,
        amount,
        currency: original.currency,
        date: req.body?.date || todayISO(),
        comment: req.body?.comment || `Сторно операции от ${fmtDate(original.date)}`,
        previousBalance,
        balanceAfter,
        reversalOfId: original.id,
        createdById: req.employee?.id || null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      include: txInclude,
    });
  });

  await logAudit(req, {
    action: 'partnerBalance.reverse',
    entityType: 'partnerBalanceTransaction',
    entityId: created.id,
    oldValue: { partnerName: original.partner?.name, ...shapeTx({ ...original, reversedBy: null }) },
    newValue: shapeTx(created),
  });
  res.status(201).json(shapeTx(created));
}));

// ---- Edit ----
//
// Only the descriptive fields. Amount, type and currency are what the whole
// balance chain was computed from — changing them after the fact would make
// every previousBalance/balanceAfter below this row a lie, so the answer to
// "I typed the wrong amount" is сторно plus a new, correct operation.
router.patch('/transactions/:id', requirePermission('partnerBalance', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.partnerBalanceTransaction.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Операция не найдена' });

  for (const field of ['amount', 'type', 'currency']) {
    if (body[field] !== undefined && String(body[field]) !== String(before[field])) {
      return res.status(400).json({
        error: 'Сумму, тип и валюту операции менять нельзя — используйте «Сторнировать» и создайте правильную операцию',
      });
    }
  }

  const data = { updatedAt: Date.now() };
  if (body.comment !== undefined) data.comment = body.comment;
  if (body.date !== undefined) data.date = body.date;
  if (body.outsourceExpenseId !== undefined) {
    if (body.outsourceExpenseId) {
      const expense = await prisma.outsourceExpense.findUnique({ where: { id: body.outsourceExpenseId } });
      if (!expense) return res.status(400).json({ error: 'Аутсорс-платёж не найден' });
      if (expense.partnerId !== before.partnerId) return res.status(400).json({ error: 'Этот платёж относится к другому партнёру' });
    }
    data.outsourceExpenseId = body.outsourceExpenseId || null;
  }

  const updated = await prisma.partnerBalanceTransaction.update({
    where: { id: before.id }, data, include: txInclude,
  });
  await logAudit(req, {
    action: 'partnerBalance.update',
    entityType: 'partnerBalanceTransaction',
    entityId: updated.id,
    oldValue: before,
    newValue: shapeTx(updated),
  });
  res.json(shapeTx(updated));
}));

// ---- Отчёт ----
router.get('/report/pdf', requirePermission('partnerBalance', 'report'), ah(async (req, res) => {
  const { from, to, currency, status } = req.query;
  const where = {};
  if (from) where.date = { ...(where.date || {}), gte: String(from) };
  if (to) where.date = { ...(where.date || {}), lte: String(to) };

  const [partners, rows, settings] = await Promise.all([
    prisma.partner.findMany({ orderBy: { name: 'asc' } }),
    prisma.partnerBalanceTransaction.findMany({
      where, select: { partnerId: true, type: true, amount: true, currency: true },
    }),
    prisma.settings.findUnique({ where: { id: 'default' } }),
  ]);

  const reportCurrency = currency || settings?.currency || DEFAULT_SETTINGS.currency;
  const byPartner = new Map();
  rows.filter((r) => r.currency === reportCurrency).forEach((r) => {
    const list = byPartner.get(r.partnerId) || [];
    list.push(r);
    byPartner.set(r.partnerId, list);
  });

  let reportRows = partners.map((p) => {
    const [summary] = summarise(byPartner.get(p.id) || []);
    return summary
      ? { name: p.name, ...summary }
      : { name: p.name, currency: reportCurrency, debit: 0, credit: 0, balance: 0, status: 'Закрыт' };
  });
  if (status) reportRows = reportRows.filter((r) => r.status === status);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="partner-balance.pdf"');
  renderPartnerBalanceReportPdf(res, {
    rows: reportRows,
    currency: reportCurrency,
    settings: settings || DEFAULT_SETTINGS,
    period: from || to ? `${from || '…'} — ${to || '…'}` : '',
  });
}));

export default router;
