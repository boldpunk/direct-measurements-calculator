import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid, todayISO, addDays } from '../util.js';
import { STAGE_DEFS, DEFAULT_SETTINGS } from '../constants.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';
import { renderOrderPdf } from '../pdf.js';

const router = Router();

router.get('/:id/pdf', requirePermission('orders', 'view'), ah(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  const [materials, services, manager, settings] = await Promise.all([
    prisma.material.findMany({ where: { orderId: order.id } }),
    prisma.orderService.findMany({ where: { orderId: order.id } }),
    order.managerId ? prisma.employee.findUnique({ where: { id: order.managerId } }) : Promise.resolve(null),
    prisma.settings.findUnique({ where: { id: 'default' } }),
  ]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="order-${order.number}.pdf"`);
  renderOrderPdf(res, { order, materials, services, manager, settings });
}));

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

router.post('/', requirePermission('orders', 'create'), ah(async (req, res) => {
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
  await logAudit(req, {
    action: 'order.create', entityType: 'order', entityId: order.id,
    newValue: { number: order.number, clientName: order.clientName, amount: order.amount, status: order.status },
  });
  res.status(201).json(order);
}));

router.patch('/:id', requirePermission('orders', 'edit'), ah(async (req, res) => {
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

  const before = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Заказ не найден' });

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

  const changedFields = Object.keys(data);
  await logAudit(req, {
    action: 'order.update', entityType: 'order', entityId: order.id,
    oldValue: Object.fromEntries(changedFields.map((k) => [k, before[k]])),
    newValue: Object.fromEntries(changedFields.map((k) => [k, order[k]])),
  });
  res.json(order);
}));

router.patch('/:id/status', ah(async (req, res) => {
  const { status } = req.body || {};
  const action = status === 'Завершён' ? 'close' : status === 'Отменён' ? 'cancel' : 'edit';
  if (!req.employee?.permissions?.orders?.[action]) return res.status(403).json({ error: 'Недостаточно прав' });

  const order = await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id: req.params.id } });
    if (!existing) return null;
    if (existing.status === status) return existing;
    const updated = await tx.order.update({ where: { id: req.params.id }, data: { status } });
    await pushActivity(tx, existing.id, `Статус изменён: ${existing.status} → ${status}`);

    // Close: reservations become an actual write-off (with the order link
    // preserved). Cancel: reservations are released, stock is untouched —
    // the goods never left the shelf.
    if (status === 'Завершён' || status === 'Отменён') {
      const reservations = await tx.stockReservation.findMany({ where: { orderId: existing.id } });
      for (const r of reservations) {
        if (status === 'Завершён') {
          await tx.productSpec.update({ where: { id: r.specId }, data: { qty: { decrement: r.qty }, reserved: { decrement: r.qty } } });
          await tx.stockMovement.create({
            data: { id: uid('mov'), specId: r.specId, type: 'expense', qty: r.qty, orderId: existing.id, reason: 'заказ', comment: `Списание при завершении заказа №${existing.number}`, createdAt: Date.now() },
          });
        } else {
          await tx.productSpec.update({ where: { id: r.specId }, data: { reserved: { decrement: r.qty } } });
          await tx.stockMovement.create({
            data: { id: uid('mov'), specId: r.specId, type: 'unreserve', qty: r.qty, orderId: existing.id, comment: `Заказ №${existing.number} отменён`, createdAt: Date.now() },
          });
        }
        await tx.stockReservation.delete({ where: { id: r.id } });
      }
    }
    return updated;
  });

  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  await logAudit(req, {
    action: `order.status_change`, entityType: 'order', entityId: order.id,
    newValue: { status: order.status },
  });
  res.json(order);
}));

router.delete('/:id', requirePermission('orders', 'delete'), ah(async (req, res) => {
  const before = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (before) {
    // Release any active stock reservations first — Material/StockReservation
    // rows cascade-delete with the order, but ProductSpec.reserved wouldn't
    // unwind on its own and would leak forever.
    await prisma.$transaction(async (tx) => {
      const reservations = await tx.stockReservation.findMany({ where: { orderId: before.id } });
      for (const r of reservations) {
        await tx.productSpec.update({ where: { id: r.specId }, data: { reserved: { decrement: r.qty } } });
        await tx.stockMovement.create({
          data: { id: uid('mov'), specId: r.specId, type: 'unreserve', qty: r.qty, orderId: before.id, comment: `Заказ №${before.number} удалён`, createdAt: Date.now() },
        });
      }
      await tx.order.delete({ where: { id: before.id } });
    });
    await logAudit(req, {
      action: 'order.delete', entityType: 'order', entityId: before.id,
      oldValue: { number: before.number, clientName: before.clientName, amount: before.amount },
    });
  }
  res.status(204).end();
}));

// ---- Stages ----

router.post('/:id/stages/:stageId/complete', requirePermission('production', 'changeStatus'), ah(async (req, res) => {
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

router.patch('/:id/stages/:stageId', requirePermission('production', 'assign'), ah(async (req, res) => {
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

function financeResource(field, model, buildData, activityText, { createPerm, deletePerm }) {
  router.post(`/:id/${field}`, requirePermission('finance', createPerm), ah(async (req, res) => {
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
    await logAudit(req, { action: `${field}.create`, entityType: field, entityId: record.id, newValue: record });
    res.status(201).json(record);
  }));

  router.delete(`/:id/${field}/:itemId`, requirePermission('finance', deletePerm), ah(async (req, res) => {
    const before = await prisma[model].findUnique({ where: { id: req.params.itemId } }).catch(() => null);
    await prisma[model].delete({ where: { id: req.params.itemId } }).catch(() => null);
    if (before) await logAudit(req, { action: `${field}.delete`, entityType: field, entityId: before.id, oldValue: before });
    res.status(204).end();
  }));
}

financeResource('payments', 'payment',
  (b) => ({ date: b.date || todayISO(), comment: b.comment || '', amount: Number(b.amount) || 0 }),
  (b, currency) => `Добавлена оплата: ${fmtMoney(b.amount, currency)}`,
  { createPerm: 'addPayment', deletePerm: 'deletePayment' });

// ---- Materials (plain rows, or pulled from Склад with a reservation) ----

router.post('/:id/materials', requirePermission('finance', 'editPayment'), ah(async (req, res) => {
  const body = req.body || {};
  const orderId = req.params.id;

  if (body.specId) {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) return { error: 404 };
      const spec = await tx.productSpec.findUnique({ where: { id: body.specId } });
      if (!spec || spec.status !== 'active') return { error: 'Товар на складе не найден' };

      const qty = Number(body.qty) || 0;
      const available = spec.qty - spec.reserved;
      if (qty > available && !req.employee?.permissions?.stock?.adjustment) {
        return { shortage: { available, requested: qty, shortage: qty - available } };
      }

      const material = await tx.material.create({
        data: {
          id: uid('mat'), orderId, name: `${spec.name || ''}`.trim() || 'Товар со склада',
          qty, unit: spec.unit, unitPrice: spec.salePrice, specId: spec.id, source: 'stock',
        },
      });
      await tx.productSpec.update({ where: { id: spec.id }, data: { reserved: { increment: qty } } });
      await tx.stockReservation.create({ data: { id: uid('rsv'), specId: spec.id, orderId, materialId: material.id, qty, createdAt: Date.now() } });
      await tx.stockMovement.create({
        data: { id: uid('mov'), specId: spec.id, type: 'reserve', qty, employeeId: req.employee.id, orderId, comment: `Резерв для заказа №${order.number}`, createdAt: Date.now() },
      });
      await pushActivity(tx, orderId, `Добавлен материал со склада: ${material.name} — ${qty} ${spec.unit}`);
      return { material };
    });

    if (result.error === 404) return res.status(404).json({ error: 'Заказ не найден' });
    if (result.error) return res.status(404).json({ error: result.error });
    if (result.shortage) {
      return res.status(409).json({
        error: `Недостаточно товара на складе. Доступно: ${result.shortage.available} шт. Запрошено: ${result.shortage.requested} шт. Не хватает: ${result.shortage.shortage} шт.`,
        ...result.shortage,
      });
    }
    await logAudit(req, { action: 'materials.create', entityType: 'materials', entityId: result.material.id, newValue: result.material });
    return res.status(201).json(result.material);
  }

  const record = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return null;
    const created = await tx.material.create({
      data: { id: uid('mat'), orderId, name: body.name, qty: Number(body.qty) || 0, unit: body.unit || 'шт.', unitPrice: Number(body.unitPrice) || 0 },
    });
    await pushActivity(tx, orderId, `Добавлен материал: ${body.name}`);
    return created;
  });
  if (!record) return res.status(404).json({ error: 'Заказ не найден' });
  await logAudit(req, { action: 'materials.create', entityType: 'materials', entityId: record.id, newValue: record });
  res.status(201).json(record);
}));

router.patch('/:id/materials/:itemId', requirePermission('finance', 'editPayment'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.material.findUnique({ where: { id: req.params.itemId }, include: { reservation: true } });
  if (!before || before.orderId !== req.params.id) return res.status(404).json({ error: 'Материал не найден' });

  if (before.specId && body.qty !== undefined) {
    const newQty = Number(body.qty) || 0;
    const delta = newQty - before.qty;
    const result = await prisma.$transaction(async (tx) => {
      const spec = await tx.productSpec.findUnique({ where: { id: before.specId } });
      const available = spec.qty - spec.reserved;
      if (delta > 0 && delta > available && !req.employee?.permissions?.stock?.adjustment) {
        return { shortage: { available, requested: delta, shortage: delta - available } };
      }
      await tx.productSpec.update({ where: { id: spec.id }, data: { reserved: { increment: delta } } });
      if (before.reservation) await tx.stockReservation.update({ where: { id: before.reservation.id }, data: { qty: newQty } });
      await tx.stockMovement.create({
        data: {
          id: uid('mov'), specId: spec.id, type: delta >= 0 ? 'reserve' : 'unreserve', qty: Math.abs(delta),
          employeeId: req.employee.id, orderId: before.orderId, comment: 'Изменение количества в заказе', createdAt: Date.now(),
        },
      });
      const material = await tx.material.update({ where: { id: before.id }, data: { qty: newQty } });
      return { material };
    });
    if (result.shortage) {
      return res.status(409).json({
        error: `Недостаточно товара на складе. Доступно: ${result.shortage.available} шт. Запрошено: ${result.shortage.requested} шт. Не хватает: ${result.shortage.shortage} шт.`,
        ...result.shortage,
      });
    }
    await logAudit(req, { action: 'materials.update', entityType: 'materials', entityId: result.material.id, oldValue: { qty: before.qty }, newValue: { qty: result.material.qty } });
    return res.json(result.material);
  }

  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.qty !== undefined) data.qty = Number(body.qty) || 0;
  if (body.unit !== undefined) data.unit = body.unit;
  if (body.unitPrice !== undefined) data.unitPrice = Number(body.unitPrice) || 0;
  const material = await prisma.material.update({ where: { id: before.id }, data });
  await logAudit(req, { action: 'materials.update', entityType: 'materials', entityId: material.id, oldValue: before, newValue: material });
  res.json(material);
}));

router.delete('/:id/materials/:itemId', requirePermission('finance', 'deletePayment'), ah(async (req, res) => {
  const before = await prisma.material.findUnique({ where: { id: req.params.itemId }, include: { reservation: true } });
  if (!before) return res.status(204).end();

  await prisma.$transaction(async (tx) => {
    if (before.reservation) {
      await tx.productSpec.update({ where: { id: before.specId }, data: { reserved: { decrement: before.reservation.qty } } });
      await tx.stockMovement.create({
        data: { id: uid('mov'), specId: before.specId, type: 'unreserve', qty: before.reservation.qty, employeeId: req.employee.id, orderId: before.orderId, comment: 'Материал удалён из заказа', createdAt: Date.now() },
      });
    }
    await tx.material.delete({ where: { id: before.id } });
  });
  await logAudit(req, { action: 'materials.delete', entityType: 'materials', entityId: before.id, oldValue: before });
  res.status(204).end();
}));

// ---- Services (order line items backed by the Service catalog) ----

router.post('/:id/services', requirePermission('finance', 'editPayment'), ah(async (req, res) => {
  const body = req.body || {};
  const orderId = req.params.id;
  if (!body.serviceId) return res.status(400).json({ error: 'Выберите услугу' });
  const qty = Number(body.qty) || 0;
  if (qty <= 0) return res.status(400).json({ error: 'Количество должно быть больше 0' });

  const record = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return null;
    const service = await tx.service.findUnique({ where: { id: body.serviceId } });
    if (!service || service.status !== 'active') return { error: 'Услуга не найдена' };
    const created = await tx.orderService.create({
      data: {
        id: uid('osv'), orderId, serviceId: service.id,
        name: service.name, unit: service.unit, unitPrice: service.price, qty, createdAt: Date.now(),
      },
    });
    await pushActivity(tx, orderId, `Добавлена услуга: ${service.name} — ${qty} ${service.unit}`);
    return created;
  });
  if (!record) return res.status(404).json({ error: 'Заказ не найден' });
  if (record.error) return res.status(404).json({ error: record.error });
  await logAudit(req, { action: 'services.create', entityType: 'orderService', entityId: record.id, newValue: record });
  res.status(201).json(record);
}));

router.patch('/:id/services/:itemId', requirePermission('finance', 'editPayment'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.orderService.findUnique({ where: { id: req.params.itemId } });
  if (!before || before.orderId !== req.params.id) return res.status(404).json({ error: 'Услуга не найдена' });
  if (body.qty !== undefined && (Number(body.qty) || 0) <= 0) return res.status(400).json({ error: 'Количество должно быть больше 0' });

  const data = {};
  if (body.qty !== undefined) data.qty = Number(body.qty) || 0;
  const record = await prisma.orderService.update({ where: { id: before.id }, data });
  await logAudit(req, { action: 'services.update', entityType: 'orderService', entityId: record.id, oldValue: before, newValue: record });
  res.json(record);
}));

router.delete('/:id/services/:itemId', requirePermission('finance', 'deletePayment'), ah(async (req, res) => {
  const before = await prisma.orderService.findUnique({ where: { id: req.params.itemId } });
  if (!before) return res.status(204).end();
  await prisma.orderService.delete({ where: { id: before.id } });
  await logAudit(req, { action: 'services.delete', entityType: 'orderService', entityId: before.id, oldValue: before });
  res.status(204).end();
}));

financeResource('outsourcing', 'outsourceExpense',
  (b) => ({ name: b.name, amount: Number(b.amount) || 0 }),
  (b) => `Добавлен аутсорс: ${b.name}`,
  { createPerm: 'editPayment', deletePerm: 'deletePayment' });

financeResource('salaries', 'salaryExpense',
  (b) => ({ name: b.name, amount: Number(b.amount) || 0 }),
  null,
  { createPerm: 'editPayment', deletePerm: 'deletePayment' });

financeResource('other-expenses', 'otherExpense',
  (b) => ({ name: b.name, amount: Number(b.amount) || 0 }),
  null,
  { createPerm: 'editPayment', deletePerm: 'deletePayment' });

export default router;
