// Low stock: what to reorder, and a heads-up when an item drops to its
// minimum. An item needs reordering when it's out (qty ≤ 0) or at/below its
// minStock. Suggested quantity refills to twice the minimum (enough for a
// while without overstocking); out-of-stock items without a minimum get 1.
import { prisma } from './prisma.js';
import { notifyEmployees } from './push.js';

export function suggestedQty(spec) {
  const available = (Number(spec.qty) || 0) - (Number(spec.reserved) || 0);
  if (spec.minStock != null && spec.minStock > 0) return Math.max(1, Math.ceil(spec.minStock * 2 - available));
  return Math.max(1, Math.ceil(-available) || 1);
}

export function needsReorder(spec) {
  return spec.status === 'active' && (spec.qty <= 0 || (spec.minStock != null && spec.qty <= spec.minStock));
}

export async function reorderList() {
  const specs = await prisma.productSpec.findMany({
    where: { status: 'active' },
    include: { product: { include: { brand: true } }, supplier: true },
  });
  const rows = specs.filter(needsReorder).map((s) => ({
    specId: s.id,
    name: [s.product.brand?.name, s.product.name, s.name].filter((x) => x && x !== '—').join(' '),
    sku: s.sku, unit: s.unit, qty: s.qty, reserved: s.reserved, minStock: s.minStock,
    suggested: suggestedQty(s), purchasePrice: s.purchasePrice,
    supplierId: s.supplierId || '', supplier: s.supplier?.name || 'Без поставщика',
    supplierPhone: s.supplier?.phone || '', supplierContact: s.supplier?.contactPerson || '',
  }));
  const groups = new Map();
  rows.forEach((r) => {
    const g = groups.get(r.supplierId) || { supplierId: r.supplierId, supplier: r.supplier, phone: r.supplierPhone, contact: r.supplierContact, items: [] };
    g.items.push(r);
    groups.set(r.supplierId, g);
  });
  return [...groups.values()].sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || a.supplier.localeCompare(b.supplier, 'ru'));
}

// Call after anything that lowers stock. Pushes to staff who manage stock
// when an item has just crossed down to its minimum (or ran out).
export async function checkLowStock(before, after, actorId) {
  if (!after || needsReorder(before)) return; // was already low — no repeat alerts
  if (!needsReorder(after)) return;
  const spec = await prisma.productSpec.findUnique({ where: { id: after.id }, include: { product: true } });
  const staff = await prisma.employee.findMany({ where: { isBlocked: false }, select: { id: true, permissions: true } });
  const ids = staff.filter((e) => e.permissions?.stock?.income || e.permissions?.stock?.edit).map((e) => e.id).filter((id) => id !== actorId);
  notifyEmployees(ids, {
    title: after.qty <= 0 ? 'Закончилось на складе' : 'Заканчивается на складе',
    body: `${spec.product.name}${spec.name && spec.name !== '—' ? ` ${spec.name}` : ''}: осталось ${after.qty} ${after.unit}${after.minStock != null ? ` (минимум ${after.minStock})` : ''}`,
    url: '/#/stock',
  });
}
