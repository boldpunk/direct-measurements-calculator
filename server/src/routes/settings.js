import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { DEFAULT_SETTINGS } from '../constants.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';

const router = Router();

const BADGE_TONES = ['neutral', 'info', 'warning', 'success', 'danger'];

router.patch('/', requirePermission('settings', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  const data = {};
  if (body.companyName !== undefined) data.companyName = body.companyName;
  if (body.currency !== undefined) data.currency = body.currency;
  if (body.stageBufferDays !== undefined) data.stageBufferDays = Number(body.stageBufferDays) || DEFAULT_SETTINGS.stageBufferDays;
  if (body.orderStatusColors !== undefined) {
    const clean = {};
    for (const [status, tone] of Object.entries(body.orderStatusColors || {})) {
      if (BADGE_TONES.includes(tone)) clean[status] = tone;
    }
    data.orderStatusColors = clean;
  }
  if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl || null;
  if (body.faviconUrl !== undefined) data.faviconUrl = body.faviconUrl || null;
  if (body.enableProductType !== undefined) data.enableProductType = !!body.enableProductType;
  if (body.enableWeight !== undefined) data.enableWeight = !!body.enableWeight;
  if (body.enableStages !== undefined) data.enableStages = !!body.enableStages;
  if (body.enableExpenses !== undefined) data.enableExpenses = !!body.enableExpenses;
  if (body.enableManufacturingDates !== undefined) data.enableManufacturingDates = !!body.enableManufacturingDates;
  if (body.enableServicesFinanceReport !== undefined) data.enableServicesFinanceReport = !!body.enableServicesFinanceReport;
  if (body.enablePurchaseSaleSplit !== undefined) data.enablePurchaseSaleSplit = !!body.enablePurchaseSaleSplit;
  if (body.enablePdfExtras !== undefined) data.enablePdfExtras = !!body.enablePdfExtras;

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
  res.json({
    companyName: settings.companyName, currency: settings.currency,
    stageBufferDays: settings.stageBufferDays, orderStatusColors: settings.orderStatusColors,
    logoUrl: settings.logoUrl, faviconUrl: settings.faviconUrl,
    enableProductType: settings.enableProductType, enableWeight: settings.enableWeight, enableStages: settings.enableStages,
    enableExpenses: settings.enableExpenses, enableManufacturingDates: settings.enableManufacturingDates,
    enableServicesFinanceReport: settings.enableServicesFinanceReport, enablePurchaseSaleSplit: settings.enablePurchaseSaleSplit,
    enablePdfExtras: settings.enablePdfExtras,
  });
}));

export default router;
