// Коммерческие предложения (commercial proposals).
//
// Unlike most entities, proposals are NOT hydrated through /api/state: their
// items carry base64 images, which would bloat every page load. They follow
// the same pattern as Склад/Услуги instead — a light list endpoint plus a
// detail endpoint that includes items.
//
// Totals are always recomputed here from the stored items; the number the
// frontend shows is a convenience, never the source of truth.
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid, todayISO } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';
import { renderProposalPdf } from '../pdf-proposal.js';
import { DEFAULT_SETTINGS } from '../constants.js';

const router = Router();

const PROPOSAL_STATUSES = ['Черновик', 'Готово', 'Отправлено', 'Принято', 'Отклонено', 'Архив'];

// Money is stored as Float (matching the rest of the app), so every computed
// figure is rounded to 2 decimals right where it's produced — that keeps
// 0.1 + 0.2 style drift from accumulating across dozens of line items.
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function recalcTotals(tx, proposalId) {
  const items = await tx.commercialProposalItem.findMany({ where: { proposalId } });
  const subtotal = round2(items.reduce((s, i) => s + round2((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0)), 0));
  return tx.commercialProposal.update({
    where: { id: proposalId },
    data: { subtotal, total: subtotal, updatedAt: Date.now() },
  });
}

async function nextNumber(tx) {
  const settings = await tx.settings.upsert({
    where: { id: 'default' }, create: { id: 'default', ...DEFAULT_SETTINGS }, update: {},
  });
  const updated = await tx.settings.update({
    where: { id: 'default' }, data: { proposalSeq: { increment: 1 } },
  });
  // MF = MebelFlow. Earlier documents were numbered MH-… and keep the number
  // they were issued with — the prefix only applies to new proposals.
  return { number: `MF-${updated.proposalSeq}`, settings };
}

// ---- Text templates (must precede /:id so "templates" isn't read as an id) ----

router.get('/templates', requirePermission('proposals', 'view'), ah(async (req, res) => {
  const templates = await prisma.proposalTextTemplate.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(templates);
}));

router.post('/templates', requirePermission('proposals', 'templates'), ah(async (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.text) return res.status(400).json({ error: 'Укажите название и текст' });
  const template = await prisma.proposalTextTemplate.create({
    data: {
      id: uid('ptt'), name: body.name, language: body.language === 'uz' ? 'uz' : 'ru',
      text: body.text, active: body.active !== false, createdById: req.employee?.id || null,
      createdAt: Date.now(), updatedAt: Date.now(),
    },
  });
  await logAudit(req, { action: 'proposalTemplate.create', entityType: 'proposalTemplate', entityId: template.id, newValue: template });
  res.status(201).json(template);
}));

router.patch('/templates/:id', requirePermission('proposals', 'templates'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.proposalTextTemplate.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Шаблон не найден' });
  const data = { updatedAt: Date.now() };
  if (body.name !== undefined) data.name = body.name;
  if (body.language !== undefined) data.language = body.language === 'uz' ? 'uz' : 'ru';
  if (body.text !== undefined) data.text = body.text;
  if (body.active !== undefined) data.active = !!body.active;
  const template = await prisma.proposalTextTemplate.update({ where: { id: before.id }, data });
  await logAudit(req, { action: 'proposalTemplate.update', entityType: 'proposalTemplate', entityId: template.id, oldValue: before, newValue: template });
  res.json(template);
}));

router.delete('/templates/:id', requirePermission('proposals', 'templates'), ah(async (req, res) => {
  const before = await prisma.proposalTextTemplate.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(204).end();
  await prisma.proposalTextTemplate.delete({ where: { id: before.id } });
  await logAudit(req, { action: 'proposalTemplate.delete', entityType: 'proposalTemplate', entityId: before.id, oldValue: before });
  res.status(204).end();
}));

// ---- Proposals ----

// Deliberately omits items (and therefore images) — the list view only needs
// the header fields, and pulling base64 renders here would make it crawl.
router.get('/', requirePermission('proposals', 'view'), ah(async (req, res) => {
  const where = {};
  if (req.query.status) where.status = String(req.query.status);
  const proposals = await prisma.commercialProposal.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { items: true } } },
  });
  res.json(proposals.map((p) => ({ ...p, itemCount: p._count.items, _count: undefined })));
}));

router.get('/:id', requirePermission('proposals', 'view'), ah(async (req, res) => {
  const proposal = await prisma.commercialProposal.findUnique({
    where: { id: req.params.id },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!proposal) return res.status(404).json({ error: 'КП не найдено' });
  res.json(proposal);
}));

router.post('/', requirePermission('proposals', 'create'), ah(async (req, res) => {
  const body = req.body || {};
  const proposal = await prisma.$transaction(async (tx) => {
    const { number } = await nextNumber(tx);
    const client = body.clientId ? await tx.client.findUnique({ where: { id: body.clientId } }) : null;
    return tx.commercialProposal.create({
      data: {
        id: uid('prp'),
        number: body.number || number,
        date: body.date || todayISO(),
        clientId: client?.id || null,
        clientName: body.clientName || client?.name || '',
        clientPhone: body.clientPhone || client?.phone || '',
        clientAddress: body.clientAddress || client?.address || '',
        projectName: body.projectName || '',
        language: body.language === 'uz' ? 'uz' : 'ru',
        currency: body.currency || undefined,
        themeColor: body.themeColor || undefined,
        responsibleId: body.responsibleId || req.employee?.id || null,
        deadline: body.deadline || '',
        brandIds: Array.isArray(body.brandIds) ? body.brandIds : [],
        finalText: body.finalText || '',
        status: PROPOSAL_STATUSES.includes(body.status) ? body.status : 'Черновик',
        createdById: req.employee?.id || null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      include: { items: true },
    });
  });
  await logAudit(req, { action: 'proposal.create', entityType: 'proposal', entityId: proposal.id, newValue: { number: proposal.number } });
  res.status(201).json(proposal);
}));

router.patch('/:id', requirePermission('proposals', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.commercialProposal.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'КП не найдено' });

  const data = { updatedAt: Date.now() };
  if (body.date !== undefined) data.date = body.date;
  if (body.projectName !== undefined) data.projectName = body.projectName;
  if (body.language !== undefined) data.language = body.language === 'uz' ? 'uz' : 'ru';
  if (body.currency !== undefined) data.currency = body.currency;
  if (body.themeColor !== undefined) data.themeColor = body.themeColor;
  if (body.responsibleId !== undefined) data.responsibleId = body.responsibleId || null;
  if (body.deadline !== undefined) data.deadline = body.deadline;
  if (body.brandIds !== undefined) data.brandIds = Array.isArray(body.brandIds) ? body.brandIds : [];
  if (body.finalText !== undefined) data.finalText = body.finalText;
  if (body.status !== undefined && PROPOSAL_STATUSES.includes(body.status)) data.status = body.status;
  if (body.clientId !== undefined) {
    const client = body.clientId ? await prisma.client.findUnique({ where: { id: body.clientId } }) : null;
    if (body.clientId && !client) return res.status(400).json({ error: 'Клиент не найден' });
    data.clientId = client?.id || null;
    // Re-snapshot the contact block when the client changes, unless the user
    // explicitly overrode those fields in the same request.
    if (client) {
      if (body.clientName === undefined) data.clientName = client.name;
      if (body.clientPhone === undefined) data.clientPhone = client.phone;
      if (body.clientAddress === undefined) data.clientAddress = client.address;
    }
  }
  if (body.clientName !== undefined) data.clientName = body.clientName;
  if (body.clientPhone !== undefined) data.clientPhone = body.clientPhone;
  if (body.clientAddress !== undefined) data.clientAddress = body.clientAddress;

  await prisma.commercialProposal.update({ where: { id: before.id }, data });
  const proposal = await prisma.$transaction((tx) => recalcTotals(tx, before.id));
  await logAudit(req, { action: 'proposal.update', entityType: 'proposal', entityId: proposal.id, oldValue: { status: before.status, total: before.total }, newValue: { status: proposal.status, total: proposal.total } });
  const full = await prisma.commercialProposal.findUnique({ where: { id: proposal.id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  res.json(full);
}));

router.delete('/:id', requirePermission('proposals', 'delete'), ah(async (req, res) => {
  const before = await prisma.commercialProposal.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(204).end();
  await prisma.commercialProposal.delete({ where: { id: before.id } });
  await logAudit(req, { action: 'proposal.delete', entityType: 'proposal', entityId: before.id, oldValue: { number: before.number } });
  res.status(204).end();
}));

router.post('/:id/duplicate', requirePermission('proposals', 'create'), ah(async (req, res) => {
  const copy = await prisma.$transaction(async (tx) => {
    const source = await tx.commercialProposal.findUnique({
      where: { id: req.params.id }, include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!source) return null;
    const { number } = await nextNumber(tx);
    const created = await tx.commercialProposal.create({
      data: {
        id: uid('prp'), number, date: todayISO(),
        clientId: source.clientId, clientName: source.clientName, clientPhone: source.clientPhone,
        clientAddress: source.clientAddress, projectName: source.projectName, language: source.language,
        currency: source.currency, themeColor: source.themeColor, responsibleId: source.responsibleId,
        deadline: source.deadline, brandIds: source.brandIds, finalText: source.finalText,
        subtotal: source.subtotal, total: source.total, status: 'Черновик',
        createdById: req.employee?.id || null, createdAt: Date.now(), updatedAt: Date.now(),
      },
    });
    for (const item of source.items) {
      await tx.commercialProposalItem.create({
        data: {
          id: uid('pri'), proposalId: created.id, sortOrder: item.sortOrder, name: item.name,
          description: item.description, imageUrl: item.imageUrl, quantity: item.quantity,
          unit: item.unit, dimensions: item.dimensions, unitPrice: item.unitPrice, total: item.total,
          createdAt: Date.now(), updatedAt: Date.now(),
        },
      });
    }
    return tx.commercialProposal.findUnique({ where: { id: created.id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  });
  if (!copy) return res.status(404).json({ error: 'КП не найдено' });
  await logAudit(req, { action: 'proposal.duplicate', entityType: 'proposal', entityId: copy.id, newValue: { number: copy.number } });
  res.status(201).json(copy);
}));

// "Создать КП из заказа" — copies the order's materials and services in as
// proposal items. The copy is a snapshot: editing either document afterwards
// leaves the other untouched.
router.post('/from-order/:orderId', requirePermission('proposals', 'create'), ah(async (req, res) => {
  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: req.params.orderId },
      include: { materials: true, services: true },
    });
    if (!order) return null;
    const { number, settings } = await nextNumber(tx);
    const proposal = await tx.commercialProposal.create({
      data: {
        id: uid('prp'), number, date: todayISO(),
        clientId: order.clientId, clientName: order.clientName, clientPhone: order.clientPhone,
        clientAddress: order.address, projectName: order.productType || '',
        currency: settings?.currency || '$',
        responsibleId: order.managerId || req.employee?.id || null,
        orderId: order.id, status: 'Черновик',
        createdById: req.employee?.id || null, createdAt: Date.now(), updatedAt: Date.now(),
      },
    });
    const lines = [
      ...order.materials.map((m) => ({ name: m.name, qty: m.qty, unit: m.unit, price: m.unitPrice })),
      ...order.services.map((s) => ({ name: s.name, qty: s.qty, unit: s.unit, price: s.unitPrice })),
    ];
    let sortOrder = 0;
    for (const line of lines) {
      await tx.commercialProposalItem.create({
        data: {
          id: uid('pri'), proposalId: proposal.id, sortOrder: sortOrder++, name: line.name,
          quantity: line.qty, unit: line.unit, unitPrice: line.price,
          total: round2(line.qty * line.price), createdAt: Date.now(), updatedAt: Date.now(),
        },
      });
    }
    await recalcTotals(tx, proposal.id);
    return tx.commercialProposal.findUnique({ where: { id: proposal.id }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  });
  if (!created) return res.status(404).json({ error: 'Заказ не найден' });
  await logAudit(req, { action: 'proposal.fromOrder', entityType: 'proposal', entityId: created.id, newValue: { number: created.number, orderId: req.params.orderId } });
  res.status(201).json(created);
}));

// ---- Items ----

router.post('/:id/items', requirePermission('proposals', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: 'Укажите название изделия' });
  const quantity = Number(body.quantity) || 0;
  if (quantity <= 0) return res.status(400).json({ error: 'Количество должно быть больше 0' });
  const unitPrice = Number(body.unitPrice) || 0;
  if (unitPrice < 0) return res.status(400).json({ error: 'Цена не может быть отрицательной' });

  const result = await prisma.$transaction(async (tx) => {
    const proposal = await tx.commercialProposal.findUnique({ where: { id: req.params.id } });
    if (!proposal) return null;
    const last = await tx.commercialProposalItem.findFirst({ where: { proposalId: proposal.id }, orderBy: { sortOrder: 'desc' } });
    const item = await tx.commercialProposalItem.create({
      data: {
        id: uid('pri'), proposalId: proposal.id, sortOrder: (last?.sortOrder ?? -1) + 1,
        name: body.name, description: body.description || '', imageUrl: body.imageUrl || null,
        quantity, unit: body.unit || 'шт.', dimensions: body.dimensions || '',
        unitPrice, total: round2(quantity * unitPrice), createdAt: Date.now(), updatedAt: Date.now(),
      },
    });
    await recalcTotals(tx, proposal.id);
    return item;
  });
  if (!result) return res.status(404).json({ error: 'КП не найдено' });
  await logAudit(req, { action: 'proposalItem.create', entityType: 'proposalItem', entityId: result.id, newValue: { name: result.name, total: result.total } });
  res.status(201).json(result);
}));

router.patch('/:id/items/:itemId', requirePermission('proposals', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.commercialProposalItem.findUnique({ where: { id: req.params.itemId } });
  if (!before || before.proposalId !== req.params.id) return res.status(404).json({ error: 'Позиция не найдена' });

  const data = { updatedAt: Date.now() };
  if (body.name !== undefined) {
    if (!body.name) return res.status(400).json({ error: 'Укажите название изделия' });
    data.name = body.name;
  }
  if (body.description !== undefined) data.description = body.description;
  if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl || null;
  if (body.unit !== undefined) data.unit = body.unit;
  if (body.dimensions !== undefined) data.dimensions = body.dimensions;
  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity) || 0;
    if (quantity <= 0) return res.status(400).json({ error: 'Количество должно быть больше 0' });
    data.quantity = quantity;
  }
  if (body.unitPrice !== undefined) {
    const unitPrice = Number(body.unitPrice) || 0;
    if (unitPrice < 0) return res.status(400).json({ error: 'Цена не может быть отрицательной' });
    data.unitPrice = unitPrice;
  }
  const quantity = data.quantity ?? before.quantity;
  const unitPrice = data.unitPrice ?? before.unitPrice;
  data.total = round2(quantity * unitPrice);

  const item = await prisma.commercialProposalItem.update({ where: { id: before.id }, data });
  await prisma.$transaction((tx) => recalcTotals(tx, before.proposalId));
  await logAudit(req, { action: 'proposalItem.update', entityType: 'proposalItem', entityId: item.id, oldValue: { total: before.total }, newValue: { total: item.total } });
  res.json(item);
}));

router.delete('/:id/items/:itemId', requirePermission('proposals', 'edit'), ah(async (req, res) => {
  const before = await prisma.commercialProposalItem.findUnique({ where: { id: req.params.itemId } });
  if (!before) return res.status(204).end();
  await prisma.commercialProposalItem.delete({ where: { id: before.id } });
  await prisma.$transaction((tx) => recalcTotals(tx, before.proposalId));
  await logAudit(req, { action: 'proposalItem.delete', entityType: 'proposalItem', entityId: before.id, oldValue: { name: before.name } });
  res.status(204).end();
}));

router.post('/:id/items/reorder', requirePermission('proposals', 'edit'), ah(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids) return res.status(400).json({ error: 'Передайте порядок позиций' });
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.commercialProposalItem.updateMany({
        where: { id: ids[i], proposalId: req.params.id }, data: { sortOrder: i },
      });
    }
  });
  const items = await prisma.commercialProposalItem.findMany({ where: { proposalId: req.params.id }, orderBy: { sortOrder: 'asc' } });
  res.json(items);
}));

// ---- PDF ----

router.get('/:id/pdf', requirePermission('proposals', 'pdf'), ah(async (req, res) => {
  const proposal = await prisma.commercialProposal.findUnique({
    where: { id: req.params.id },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!proposal) return res.status(404).json({ error: 'КП не найдено' });
  const [settings, responsible, brands] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 'default' } }),
    proposal.responsibleId ? prisma.employee.findUnique({ where: { id: proposal.responsibleId } }) : Promise.resolve(null),
    proposal.brandIds.length ? prisma.brand.findMany({ where: { id: { in: proposal.brandIds } } }) : Promise.resolve([]),
  ]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="proposal-${proposal.number}.pdf"`);
  await renderProposalPdf(res, { proposal, settings, responsible, brands });
}));

export default router;
