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

export default router;
