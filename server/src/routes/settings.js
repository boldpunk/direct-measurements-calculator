import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { DEFAULT_SETTINGS } from '../constants.js';

const router = Router();

router.patch('/', ah(async (req, res) => {
  const body = req.body || {};
  const data = {};
  if (body.companyName !== undefined) data.companyName = body.companyName;
  if (body.currency !== undefined) data.currency = body.currency;
  if (body.stageBufferDays !== undefined) data.stageBufferDays = Number(body.stageBufferDays) || DEFAULT_SETTINGS.stageBufferDays;

  const settings = await prisma.settings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...DEFAULT_SETTINGS, ...data },
    update: data,
  });
  res.json({ companyName: settings.companyName, currency: settings.currency, stageBufferDays: settings.stageBufferDays });
}));

export default router;
