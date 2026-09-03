import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { ah } from '../util.js';

const router = Router();

function publicEmployee(e) {
  return { id: e.id, name: e.name, role: e.role, phone: e.phone, email: e.email };
}

router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Укажите email и пароль' });

  const employee = await prisma.employee.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!employee || !employee.passwordHash) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const ok = await bcrypt.compare(password, employee.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });

  const token = signToken(employee);
  res.json({ token, employee: publicEmployee(employee) });
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  const employee = await prisma.employee.findUnique({ where: { id: req.employeeId } });
  if (!employee) return res.status(404).json({ error: 'Сотрудник не найден' });
  res.json({ employee: publicEmployee(employee) });
}));

export default router;
