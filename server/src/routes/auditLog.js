import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();

router.get('/', requirePermission('settings', 'manageRoles'), ah(async (req, res) => {
  const { employeeId, entityType, from, to, limit } = req.query;
  const where = {};
  if (employeeId) where.employeeId = String(employeeId);
  if (entityType) where.entityType = String(entityType);
  if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = Number(from);
    if (to) where.timestamp.lte = Number(to);
  }

  const take = Math.min(Number(limit) || 200, 500);
  const entries = await prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, take });
  res.json(entries);
}));

// Errors collected from browsers and the API (see app-errors.js).
router.get('/errors', requirePermission('settings', 'manageRoles'), ah(async (req, res) => {
  const errors = await prisma.appError.findMany({ orderBy: { lastAt: 'desc' }, take: 200 });
  res.json(errors);
}));

// «Исправлено»: drop the group; if it happens again it comes back as new.
router.delete('/errors/:id', requirePermission('settings', 'manageRoles'), ah(async (req, res) => {
  await prisma.appError.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
}));

export default router;
