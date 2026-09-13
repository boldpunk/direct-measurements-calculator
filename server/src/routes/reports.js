import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { renderPurchaseListPdf } from '../pdf.js';
import { CUSTOM_ORDER_STATUSES } from '../constants.js';

const router = Router();

// Orders past these statuses no longer need anything purchased for them —
// mirrors CLOSED_STATUSES/CUSTOM_CLOSED_STATUSES in src/store.js.
const CLOSED_STATUSES = ['Завершён', 'Отменён'];
const CUSTOM_CLOSED_STATUSES = [CUSTOM_ORDER_STATUSES[CUSTOM_ORDER_STATUSES.length - 1]];

// "Заявки на закупку" — a daily shopping list: every manually-entered
// material (source: 'manual', i.e. not already pulled from Склад stock) on
// an active order, aggregated by supplier + name + unit and totaled.
router.get('/purchase-list/pdf', requirePermission('finance', 'view'), ah(async (req, res) => {
  const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
  const closedStatuses = settings?.enableCustomOrderStatuses ? CUSTOM_CLOSED_STATUSES : CLOSED_STATUSES;
  const orders = await prisma.order.findMany({ where: { status: { notIn: closedStatuses } } });
  const orderIds = orders.map((o) => o.id);
  const materials = orderIds.length
    ? await prisma.material.findMany({ where: { orderId: { in: orderIds }, source: 'manual' } })
    : [];

  const grouped = new Map();
  for (const m of materials) {
    const supplier = m.supplier || 'Без поставщика';
    const key = `${supplier} :: ${m.name} :: ${m.unit}`;
    const row = grouped.get(key) || { supplier, name: m.name, unit: m.unit, qty: 0 };
    row.qty += m.qty;
    grouped.set(key, row);
  }
  const rows = [...grouped.values()].sort((a, b) => a.supplier.localeCompare(b.supplier) || a.name.localeCompare(b.name));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="purchase-list.pdf"');
  renderPurchaseListPdf(res, { rows, settings });
}));

export default router;
