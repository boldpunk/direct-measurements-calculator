import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { ah } from '../util.js';

const router = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

function publicEmployee(e) {
  return {
    id: e.id,
    name: e.name,
    role: e.role,
    phone: e.phone,
    email: e.email,
    accessRole: e.accessRole,
    permissions: e.permissions,
    financialFlags: e.financialFlags,
    scopeFlags: e.scopeFlags,
    isBlocked: e.isBlocked,
  };
}

router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Укажите email и пароль' });

  const employee = await prisma.employee.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!employee || !employee.passwordHash) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  if (employee.isBlocked) {
    return res.status(403).json({ error: 'Учётная запись заблокирована администратором' });
  }
  if (employee.lockedUntil && employee.lockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((employee.lockedUntil - Date.now()) / 60000);
    return res.status(423).json({ error: `Слишком много неверных попыток. Повторите через ${minutesLeft} мин.` });
  }

  const ok = await bcrypt.compare(password, employee.passwordHash);
  if (!ok) {
    const failedLoginCount = employee.failedLoginCount + 1;
    const lockedOut = failedLoginCount >= MAX_FAILED_ATTEMPTS;
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        failedLoginCount: lockedOut ? 0 : failedLoginCount,
        lockedUntil: lockedOut ? Date.now() + LOCK_DURATION_MS : null,
      },
    });
    if (lockedOut) {
      return res.status(423).json({ error: 'Слишком много неверных попыток. Аккаунт заблокирован на 15 минут.' });
    }
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  const updated = await prisma.employee.update({
    where: { id: employee.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastActivityAt: Date.now() },
  });

  const token = signToken(updated);
  res.json({ token, employee: publicEmployee(updated) });
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  res.json({ employee: publicEmployee(req.employee) });
}));

// Called on user activity to keep the session alive; a fully idle session
// simply expires (JWT has a short lifetime) and the next request 401s.
router.post('/refresh', requireAuth, ah(async (req, res) => {
  await prisma.employee.update({ where: { id: req.employee.id }, data: { lastActivityAt: Date.now() } });
  const token = signToken(req.employee);
  res.json({ token });
}));

export default router;
