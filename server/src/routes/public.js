// What a client sees by the link from their order card (/client.html?t=…):
// status and progress, deadline, amount, payments and the КП — nothing about
// costs, staff or other orders. No login; the 32-char token is the key, and
// regenerating it (or switching the link off) revokes old links.
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { brandingAssetUrl } from '../branding-assets.js';
import { renderProposalPdf } from '../pdf-proposal.js';
import { ORDER_STATUSES, CUSTOM_ORDER_STATUSES } from '../constants.js';

const router = Router();

const findOrder = (token) => (/^[A-Za-z0-9_-]{20,64}$/.test(String(token)) ? prisma.order.findUnique({ where: { shareToken: String(token) } }) : null);

router.get('/orders/:token', ah(async (req, res) => {
  const order = await findOrder(req.params.token);
  if (!order || order.archivedAt) return res.status(404).json({ error: 'Ссылка недействительна' });
  const [settings, payments, proposals] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 'default' } }),
    prisma.payment.findMany({ where: { orderId: order.id }, orderBy: { date: 'asc' }, select: { date: true, amount: true } }),
    prisma.commercialProposal.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' }, select: { number: true, total: true, currency: true } }),
  ]);
  const stageRows = settings?.enableStages === false ? [] : await prisma.stage.findMany({
    where: { orderId: order.id, skipped: false, type: { not: 'outsource' } }, orderBy: { position: 'asc' },
    select: { name: true, status: true, deadline: true },
  });
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  res.set('Cache-Control', 'no-store');
  res.json({
    company: {
      name: settings?.companyName || 'MebelFlow', phone: settings?.companyPhone || '', instagram: settings?.companyInstagram || '',
      website: settings?.companyWebsite || '', address: settings?.companyAddress || '',
      logoUrl: brandingAssetUrl('logo', settings?.logoUrl), currency: settings?.currency || '$',
    },
    order: {
      number: order.number, productType: settings?.enableProductType === false ? '' : order.productType,
      clientName: order.clientName, status: order.status, deadline: order.deadline, startDate: order.startDate,
      amount: order.amount, paid, remaining: Math.max(0, order.amount - paid),
    },
    statuses: (settings?.enableCustomOrderStatuses ? CUSTOM_ORDER_STATUSES : ORDER_STATUSES).filter((s) => s !== 'Отменён'),
    stages: stageRows,
    payments,
    proposals: proposals.map((p) => ({ number: p.number, total: p.total, currency: p.currency, pdf: `/api/public/orders/${req.params.token}/proposals/${p.number}.pdf` })),
  });
}));

router.get('/orders/:token/proposals/:number.pdf', ah(async (req, res) => {
  const order = await findOrder(req.params.token);
  if (!order || order.archivedAt) return res.status(404).end();
  const proposal = await prisma.commercialProposal.findFirst({
    where: { orderId: order.id, number: req.params.number },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!proposal) return res.status(404).end();
  const [settings, responsible, brands] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 'default' } }),
    proposal.responsibleId ? prisma.employee.findUnique({ where: { id: proposal.responsibleId } }) : null,
    proposal.brandIds.length ? prisma.brand.findMany({ where: { id: { in: proposal.brandIds } } }) : [],
  ]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="KP-${proposal.number}.pdf"`);
  await renderProposalPdf(res, { proposal, settings, responsible, brands });
}));

export default router;
