import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';

const router = Router();

router.get('/', requirePermission('services', 'view'), ah(async (req, res) => {
  const status = req.query.status;
  res.json(await prisma.service.findMany({
    where: status ? { status } : undefined,
    orderBy: { name: 'asc' },
  }));
}));

router.post('/', requirePermission('services', 'create'), ah(async (req, res) => {
  const body = req.body || {};
  if (!body.name) return res.status(400).json({ error: 'Укажите название услуги' });
  if (Number(body.price) < 0) return res.status(400).json({ error: 'Цена не может быть отрицательной' });

  const record = await prisma.service.create({
    data: {
      id: body.id || uid('svc'),
      name: body.name,
      category: body.category || '',
      unit: body.unit || 'шт.',
      price: Number(body.price) || 0,
      comment: body.comment || '',
      createdAt: Date.now(),
    },
  });
  await logAudit(req, { action: 'services.create', entityType: 'service', entityId: record.id, newValue: record });
  res.status(201).json(record);
}));

router.patch('/:id', requirePermission('services', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Услуга не найдена' });
  if (body.name !== undefined && !body.name) return res.status(400).json({ error: 'Укажите название услуги' });
  if (body.price !== undefined && Number(body.price) < 0) return res.status(400).json({ error: 'Цена не может быть отрицательной' });

  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.category !== undefined) data.category = body.category;
  if (body.unit !== undefined) data.unit = body.unit;
  if (body.price !== undefined) data.price = Number(body.price) || 0;
  if (body.comment !== undefined) data.comment = body.comment;
  if (body.status !== undefined) data.status = body.status;

  const record = await prisma.service.update({ where: { id: req.params.id }, data });
  await logAudit(req, { action: 'services.update', entityType: 'service', entityId: record.id, oldValue: before, newValue: record });
  res.json(record);
}));

// Services already used on an order are archived, not deleted — deleting
// them would null out serviceId on historical OrderService rows (the row
// itself, with its price snapshot, survives fine, but "archived and hidden
// from new orders" is the intent, not "erase that it ever existed").
router.delete('/:id', requirePermission('services', 'delete'), ah(async (req, res) => {
  const before = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(204).end();
  const usageCount = await prisma.orderService.count({ where: { serviceId: before.id } });
  if (usageCount > 0) {
    const record = await prisma.service.update({ where: { id: before.id }, data: { status: 'archived' } });
    await logAudit(req, { action: 'services.archive', entityType: 'service', entityId: record.id, oldValue: before, newValue: record });
    return res.json(record);
  }
  await prisma.service.delete({ where: { id: before.id } });
  await logAudit(req, { action: 'services.delete', entityType: 'service', entityId: before.id, oldValue: before });
  res.status(204).end();
}));

export default router;
