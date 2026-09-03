import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid } from '../util.js';

const router = Router();

router.post('/', ah(async (req, res) => {
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
  res.status(201).json(client);
}));

router.patch('/:id', ah(async (req, res) => {
  const { name, phone, address } = req.body || {};
  const data = {};
  if (name !== undefined) data.name = name;
  if (phone !== undefined) data.phone = phone;
  if (address !== undefined) data.address = address;
  const client = await prisma.client.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!client) return res.status(404).json({ error: 'Клиент не найден' });
  res.json(client);
}));

router.delete('/:id', ah(async (req, res) => {
  const orderCount = await prisma.order.count({ where: { clientId: req.params.id } });
  if (orderCount > 0) return res.status(409).json({ error: 'У клиента есть заказы' });
  await prisma.client.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
}));

export default router;
