import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { ah } from '../util.js';
import { logAudit } from '../audit.js';
import { ipBlockedMinutes, noteFailure } from '../login-guard.js';

const router = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
// Compared against when the email is unknown, so a wrong email takes as long
// as a wrong password and the response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('mebelflow-timing-equaliser', 10);

// Login events go to the Журнал действий (with IP and device).
function logLogin(req, employee, action, extra) {
  return logAudit({ ip: req.ip, headers: req.headers, employee }, {
    action, entityType: 'auth', entityId: employee?.id, newValue: extra,
  });
}

// Second-precision "now": JWT iat is in whole seconds, so a token issued in
// the same second as the change must still count as newer.
const changedAtNow = () => Math.floor(Date.now() / 1000) * 1000;

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

  const blockedFor = ipBlockedMinutes(req.ip);
  if (blockedFor) {
    res.set('Retry-After', String(blockedFor * 60));
    return res.status(429).json({ error: `Слишком много неудачных попыток входа. Повторите через ${blockedFor} мин.` });
  }

  const cleanEmail = String(email).toLowerCase().trim();
  const employee = await prisma.employee.findUnique({ where: { email: cleanEmail } });
  if (!employee || !employee.passwordHash) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    noteFailure(req.ip);
    await logLogin(req, null, 'auth.login_failed', { email: cleanEmail, reason: 'unknown_email' });
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  if (employee.isBlocked) {
    return res.status(403).json({ error: 'Учётная запись заблокирована администратором' });
  }
  if (employee.lockedUntil && employee.lockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((employee.lockedUntil - Date.now()) / 60000);
    return res.status(423).json({ error: `Слишком много неверных попыток. Повторите через ${minutesLeft} мин.` });
  }

  const ok = await bcrypt.compare(String(password), employee.passwordHash);
  if (!ok) {
    noteFailure(req.ip);
    const failedLoginCount = employee.failedLoginCount + 1;
    const lockedOut = failedLoginCount >= MAX_FAILED_ATTEMPTS;
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        failedLoginCount: lockedOut ? 0 : failedLoginCount,
        lockedUntil: lockedOut ? Date.now() + LOCK_DURATION_MS : null,
      },
    });
    await logLogin(req, employee, lockedOut ? 'auth.locked' : 'auth.login_failed', { reason: 'wrong_password' });
    if (lockedOut) {
      return res.status(423).json({ error: 'Слишком много неверных попыток. Аккаунт заблокирован на 15 минут.' });
    }
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }

  const updated = await prisma.employee.update({
    where: { id: employee.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastActivityAt: Date.now() },
  });
  await logLogin(req, updated, 'auth.login');

  const token = signToken(updated);
  res.json({ token, employee: publicEmployee(updated) });
}));

// The employee changes their own password. Every other device is signed out
// (their tokens predate passwordChangedAt); this one gets a fresh token.
router.post('/change-password', requireAuth, ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const employee = req.employee;
  if (!employee.passwordHash || !(await bcrypt.compare(String(currentPassword || ''), employee.passwordHash))) {
    return res.status(400).json({ error: 'Текущий пароль указан неверно' });
  }
  const next = String(newPassword || '');
  if (next.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Новый пароль — минимум ${MIN_PASSWORD_LENGTH} символов` });
  }
  if (await bcrypt.compare(next, employee.passwordHash)) {
    return res.status(400).json({ error: 'Новый пароль совпадает с текущим' });
  }
  const updated = await prisma.employee.update({
    where: { id: employee.id },
    data: { passwordHash: await bcrypt.hash(next, 10), passwordChangedAt: changedAtNow() },
  });
  await logAudit(req, { action: 'auth.password_change', entityType: 'auth', entityId: employee.id });
  res.json({ token: signToken(updated) });
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
