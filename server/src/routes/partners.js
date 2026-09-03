import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid } from '../util.js';

const router = Router();

router.post('/', ah(async (req, res) => {
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
  res.status(201).json(partner);
}));

router.delete('/:id', ah(async (req, res) => {
  await prisma.partner.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
}));

export default router;
