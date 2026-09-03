import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid, todayISO, addDays } from '../util.js';
import { STAGE_DEFS, DEFAULT_SETTINGS } from '../constants.js';

const router = Router();

async function pushActivity(tx, orderId, text) {
  await tx.activity.create({ data: { id: uid('act'), orderId, timestamp: Date.now(), text } });
  const count = await tx.activity.count({ where: { orderId } });
  if (count > 50) {
    const stale = await tx.activity.findMany({
      where: { orderId }, orderBy: { timestamp: 'asc' }, take: count - 50,
    });
    await tx.activity.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
  }
}

function fmtMoney(amount, currency) {
  return `${(Number(amount) || 0).toLocaleString('ru-RU')} ${currency}`;
}

async function findOrCreateClient(tx, { clientId, clientName, clientPhone, address }) {
  if (clientId) {
    const existing = await tx.client.findUnique({ where: { id: clientId } });
    if (existing) return existing;
  }
  if (clientPhone) {
    const existing = await tx.client.findFirst({ where: { phone: clientPhone } });
    if (existing) {
      if (address && !existing.address) {
        return tx.client.update({ where: { id: existing.id }, data: { address } });
      }
      return existing;
    }
  }
  return tx.client.create({
    data: { id: uid('cli'), name: clientName || 'Без имени', phone: clientPhone || '', address: address || '', createdAt: Date.now() },
  });
}

router.post('/', ah(async (req, res) => {
  const body = req.body || {};
  const order = await prisma.$transaction(async (tx) => {
    const settings = await tx.settings.upsert({
      where: { id: 'default' }, create: { id: 'default', ...DEFAULT_SETTINGS }, update: {},
    });
    const client = await findOrCreateClient(tx, body);
    const number = await tx.settings.update({
      where: { id: 'default' }, data: { orderSeq: { increment: 1 } },
    }).then((s) => s.orderSeq);

    const created = await tx.order.create({
      data: {
        id: body.id || uid('ord'),
        number,
        clientId: client.id,
        clientName: body.clientName || client.name || '',
        clientPhone: body.clientPhone || client.phone || '',
        address: body.address || client.address || '',
        productType: body.productType,
        managerId: body.managerId || null,
        amount: Number(body.amount) || 0,
        startDate: body.startDate || todayISO(),
        deadline: body.deadline || addDays(todayISO(), 14),
        status: body.status || 'Новый',
        needsCarpentry: body.needsCarpentry !== false,
        notes: body.notes || '',
        createdAt: Date.now(),
      },
    });

    await tx.stage.createMany({
      data: STAGE_DEFS.map((def, i) => {
        const skip = def.key === 'carpentry' && !created.needsCarpentry;
        return {
          id: uid('stg'),
          orderId: created.id,
          defKey: def.key,
          name: def.name,
          type: def.type,
          service: def.service || null,
          position: i,
          deadline: addDays(created.startDate, (i + 1) * settings.stageBufferDays),
          status: skip ? 'готово' : (i === 0 ? 'в работе' : 'ожидает'),
          skipped: skip,
        };
      }),
    });

    await pushActivity(tx, created.id, 'Заказ создан');
    return created;
  });
  res.status(201).json(order);
}));

router.patch('/:id', ah(async (req, res) => {
  const body = req.body || {};
  const data = {};
  if (body.clientName !== undefined) data.clientName = body.clientName;
  if (body.clientPhone !== undefined) data.clientPhone = body.clientPhone;
  if (body.address !== undefined) data.address = body.address;
  if (body.productType !== undefined) data.productType = body.productType;
  if (body.amount !== undefined) data.amount = Number(body.amount) || 0;
  if (body.deadline !== undefined) data.deadline = body.deadline;
  if (body.managerId !== undefined) data.managerId = body.managerId || null;
  if (body.notes !== undefined) data.notes = body.notes;

  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!updated) return null;
    if (updated.clientId) {
      const clientPatch = {};
      if (body.clientName !== undefined) clientPatch.name = body.clientName;
      if (body.clientPhone !== undefined) clientPatch.phone = body.clientPhone;
      if (Object.keys(clientPatch).length) {
        await tx.client.update({ where: { id: updated.clientId }, data: clientPatch }).catch(() => null);
      }
      if (body.address !== undefined) {
        const client = await tx.client.findUnique({ where: { id: updated.clientId } });
        if (client && !client.address) await tx.client.update({ where: { id: client.id }, data: { address: body.address } });
      }
    }
    return updated;
  });
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  res.json(order);
}));

router.patch('/:id/status', ah(async (req, res) => {
  const { status } = req.body || {};
  const order = await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id: req.params.id } });
    if (!existing) return null;
    if (existing.status === status) return existing;
    const updated = await tx.order.update({ where: { id: req.params.id }, data: { status } });
    await pushActivity(tx, existing.id, `Статус изменён: ${existing.status} → ${status}`);
    return updated;
  });
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  res.json(order);
}));

router.delete('/:id', ah(async (req, res) => {
  await prisma.order.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
}));

// ---- Stages ----

router.post('/:id/stages/:stageId/complete', ah(async (req, res) => {
  await prisma.$transaction(async (tx) => {
    const stage = await tx.stage.findUnique({ where: { id: req.params.stageId } });
    if (!stage || stage.orderId !== req.params.id) return;
    await tx.stage.update({ where: { id: stage.id }, data: { status: 'готово' } });
    const next = await tx.stage.findFirst({
      where: { orderId: stage.orderId, skipped: false, status: 'ожидает' },
      orderBy: { position: 'asc' },
    });
    if (next) await tx.stage.update({ where: { id: next.id }, data: { status: 'в работе' } });
  });
  res.status(204).end();
}));

router.patch('/:id/stages/:stageId', ah(async (req, res) => {
  const { assigneeId, partnerId, deadline } = req.body || {};
  const data = {};
  if (assigneeId !== undefined) data.assigneeId = assigneeId || null;
  if (partnerId !== undefined) data.partnerId = partnerId || null;
  if (deadline !== undefined) data.deadline = deadline;
  const stage = await prisma.stage.update({ where: { id: req.params.stageId }, data }).catch(() => null);
  if (!stage) return res.status(404).json({ error: 'Этап не найден' });
  res.json(stage);
}));

// ---- Finance sub-resources ----

function financeResource(field, model, buildData, activityText) {
  router.post(`/:id/${field}`, ah(async (req, res) => {
    const body = req.body || {};
    const record = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: req.params.id } });
      if (!order) return null;
      const created = await tx[model].create({ data: { id: body.id || uid(field.slice(0, 3)), orderId: order.id, ...buildData(body) } });
      if (activityText) {
        const settings = await tx.settings.findUnique({ where: { id: 'default' } });
        await pushActivity(tx, order.id, activityText(body, settings?.currency || '$'));
      }
      return created;
    });
    if (!record) return res.status(404).json({ error: 'Заказ не найден' });
    res.status(201).json(record);
  }));

  router.delete(`/:id/${field}/:itemId`, ah(async (req, res) => {
    await prisma[model].delete({ where: { id: req.params.itemId } }).catch(() => null);
    res.status(204).end();
  }));
}

financeResource('payments', 'payment',
  (b) => ({ date: b.date || todayISO(), comment: b.comment || '', amount: Number(b.amount) || 0 }),
  (b, currency) => `Добавлена оплата: ${fmtMoney(b.amount, currency)}`);

financeResource('materials', 'material',
  (b) => ({ name: b.name, qty: Number(b.qty) || 0, unit: b.unit || 'шт.', unitPrice: Number(b.unitPrice) || 0 }),
  (b) => `Добавлен материал: ${b.name}`);

financeResource('outsourcing', 'outsourceExpense',
  (b) => ({ name: b.name, amount: Number(b.amount) || 0 }),
  (b) => `Добавлен аутсорс: ${b.name}`);

financeResource('salaries', 'salaryExpense',
  (b) => ({ name: b.name, amount: Number(b.amount) || 0 }));

financeResource('other-expenses', 'otherExpense',
  (b) => ({ name: b.name, amount: Number(b.amount) || 0 }));

export default router;
