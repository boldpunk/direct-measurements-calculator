import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { DEFAULT_SETTINGS } from '../constants.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';

const router = Router();

router.patch('/', requirePermission('settings', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  const data = {};
  if (body.companyName !== undefined) data.companyName = body.companyName;
  if (body.currency !== undefined) data.currency = body.currency;
  if (body.stageBufferDays !== undefined) data.stageBufferDays = Number(body.stageBufferDays) || DEFAULT_SETTINGS.stageBufferDays;

  const before = await prisma.settings.findUnique({ where: { id: 'default' } });
  const settings = await prisma.settings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...DEFAULT_SETTINGS, ...data },
    update: data,
  });
  await logAudit(req, {
    action: 'settings.update', entityType: 'settings', entityId: 'default',
    oldValue: before ? Object.fromEntries(Object.keys(data).map((k) => [k, before[k]])) : undefined,
    newValue: data,
  });
  res.json({ companyName: settings.companyName, currency: settings.currency, stageBufferDays: settings.stageBufferDays });
}));

export default router;
