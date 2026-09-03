import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { ah, uid } from '../util.js';

const router = Router();
const publicEmployee = (e) => ({ id: e.id, name: e.name, role: e.role, phone: e.phone, email: e.email });

router.post('/', ah(async (req, res) => {
  const body = req.body || {};
  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : null;
  const employee = await prisma.employee.create({
    data: {
      id: body.id || uid('emp'),
      name: body.name,
      role: body.role,
      phone: body.phone || '',
      email: body.email ? String(body.email).toLowerCase() : null,
      passwordHash,
      createdAt: Date.now(),
    },
  });
  res.status(201).json(publicEmployee(employee));
}));

router.delete('/:id', ah(async (req, res) => {
  await prisma.employee.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
}));

export default router;
