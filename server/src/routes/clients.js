import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';

const router = Router();

router.post('/', requirePermission('clients', 'create'), ah(async (req, res) => {
  const { id, name, phone, address, createdAt } = req.body || {};
  const client = await prisma.client.create({
    data: {
      id: id || uid('cli'),
      name: name || 'Без имени',
      phone: phone || '',
      address: address || '',
      createdAt: createdAt || Date.now(),
    },
  });
  await logAudit(req, { action: 'client.create', entityType: 'client', entityId: client.id, newValue: client });
  res.status(201).json(client);
}));

router.patch('/:id', requirePermission('clients', 'edit'), ah(async (req, res) => {
  const { name, phone, address } = req.body || {};
  const data = {};
  if (name !== undefined) data.name = name;
  if (phone !== undefined) data.phone = phone;
  if (address !== undefined) data.address = address;
  const before = await prisma.client.findUnique({ where: { id: req.params.id } });
  const client = await prisma.client.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!client) return res.status(404).json({ error: 'Клиент не найден' });
  await logAudit(req, {
    action: 'client.update', entityType: 'client', entityId: client.id,
    oldValue: before ? Object.fromEntries(Object.keys(data).map((k) => [k, before[k]])) : undefined,
    newValue: Object.fromEntries(Object.keys(data).map((k) => [k, client[k]])),
  });
  res.json(client);
}));

router.delete('/:id', requirePermission('clients', 'delete'), ah(async (req, res) => {
  const orderCount = await prisma.order.count({ where: { clientId: req.params.id } });
  if (orderCount > 0) return res.status(409).json({ error: 'У клиента есть заказы' });
  const before = await prisma.client.findUnique({ where: { id: req.params.id } });
  await prisma.client.delete({ where: { id: req.params.id } }).catch(() => null);
  if (before) await logAudit(req, { action: 'client.delete', entityType: 'client', entityId: before.id, oldValue: before });
  res.status(204).end();
}));

export default router;
