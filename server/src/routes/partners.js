import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';

const router = Router();

router.post('/', requirePermission('outsource', 'create'), ah(async (req, res) => {
  const body = req.body || {};
  const partner = await prisma.partner.create({
    data: {
      id: body.id || uid('ptn'),
      name: body.name,
      services: body.services || [],
      contacts: body.contacts || '',
      avgLeadDays: Number(body.avgLeadDays) || 0,
      rating: Number(body.rating) || 0,
      comment: body.comment || '',
    },
  });
  await logAudit(req, { action: 'partner.create', entityType: 'partner', entityId: partner.id, newValue: partner });
  res.status(201).json(partner);
}));

router.delete('/:id', requirePermission('outsource', 'delete'), ah(async (req, res) => {
  const before = await prisma.partner.findUnique({ where: { id: req.params.id } });
  await prisma.partner.delete({ where: { id: req.params.id } }).catch(() => null);
  if (before) await logAudit(req, { action: 'partner.delete', entityType: 'partner', entityId: before.id, oldValue: before });
  res.status(204).end();
}));

export default router;
