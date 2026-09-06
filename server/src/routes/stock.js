import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid, todayISO } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';

const router = Router();

// ---- Categories / Brands / Suppliers (simple reference data) ----

function refResource(field, model, buildData, { uniqueByName = false } = {}) {
  router.get(`/${field}`, requirePermission('stock', 'view'), ah(async (req, res) => {
    res.json(await prisma[model].findMany({ orderBy: { name: 'asc' } }));
  }));

  router.post(`/${field}`, requirePermission('stock', 'create'), ah(async (req, res) => {
    const body = req.body || {};
    if (uniqueByName && body.name) {
      const existing = await prisma[model].findFirst({ where: { name: body.name } });
      if (existing) return res.status(200).json(existing);
    }
    const record = await prisma[model].create({ data: { id: body.id || uid(field.slice(0, 3)), createdAt: Date.now(), ...buildData(body) } });
    await logAudit(req, { action: `stock.${field}.create`, entityType: field, entityId: record.id, newValue: record });
    res.status(201).json(record);
  }));

  router.patch(`/${field}/:id`, requirePermission('stock', 'edit'), ah(async (req, res) => {
    const before = await prisma[model].findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Не найдено' });
    const record = await prisma[model].update({ where: { id: req.params.id }, data: buildData(req.body || {}) });
    await logAudit(req, { action: `stock.${field}.update`, entityType: field, entityId: record.id, oldValue: before, newValue: record });
    res.json(record);
  }));

  router.delete(`/${field}/:id`, requirePermission('stock', 'delete'), ah(async (req, res) => {
    const before = await prisma[model].findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(204).end();
    try {
      await prisma[model].delete({ where: { id: req.params.id } });
    } catch (e) {
      if (e.code === 'P2003') {
        return res.status(409).json({ error: 'Нельзя удалить — используется в товарах на складе' });
      }
      throw e;
    }
    await logAudit(req, { action: `stock.${field}.delete`, entityType: field, entityId: before.id, oldValue: before });
    res.status(204).end();
  }));
}

refResource('categories', 'category', (b) => ({ name: b.name }), { uniqueByName: true });
refResource('brands', 'brand', (b) => ({ name: b.name }), { uniqueByName: true });
refResource('suppliers', 'supplier', (b) => ({
  name: b.name, phone: b.phone || '', contactPerson: b.contactPerson || '', comment: b.comment || '',
}));

// ---- Supplier balances (owed = cost of income movements, minus payments made) ----

router.get('/suppliers-summary', requirePermission('stock', 'view'), ah(async (req, res) => {
  const [suppliers, incomes, payments] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
    prisma.stockMovement.findMany({ where: { type: 'income', supplierId: { not: null } } }),
    prisma.supplierPayment.findMany(),
  ]);
  const costBySupplier = {};
  incomes.forEach((m) => { costBySupplier[m.supplierId] = (costBySupplier[m.supplierId] || 0) + m.qty * (m.price || 0); });
  const paidBySupplier = {};
  payments.forEach((p) => { paidBySupplier[p.supplierId] = (paidBySupplier[p.supplierId] || 0) + p.amount; });

  res.json(suppliers.map((s) => {
    const totalCost = costBySupplier[s.id] || 0;
    const totalPaid = paidBySupplier[s.id] || 0;
    return { ...s, totalCost, totalPaid, balance: totalCost - totalPaid };
  }));
}));

router.get('/suppliers/:id/payments', requirePermission('stock', 'view'), ah(async (req, res) => {
  const payments = await prisma.supplierPayment.findMany({
    where: { supplierId: req.params.id }, orderBy: { createdAt: 'desc' },
  });
  res.json(payments);
}));

router.post('/suppliers/:id/payments', requirePermission('stock', 'income'), ah(async (req, res) => {
  const body = req.body || {};
  const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!supplier) return res.status(404).json({ error: 'Поставщик не найден' });
  const amount = Number(body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Укажите сумму больше 0' });

  const payment = await prisma.supplierPayment.create({
    data: {
      id: uid('spay'), supplierId: supplier.id, date: body.date || todayISO(),
      amount, comment: body.comment || '', employeeId: req.employee.id, createdAt: Date.now(),
    },
  });
  await logAudit(req, { action: 'stock.supplier_payment.create', entityType: 'supplier_payment', entityId: payment.id, newValue: payment });
  res.status(201).json(payment);
}));

// ---- Items (ProductSpec, the actual stock-keeping unit) ----

function shapeItem(spec) {
  const available = spec.qty - spec.reserved;
  const lowStock = spec.minStock != null && spec.qty <= spec.minStock;
  return {
    id: spec.id,
    categoryId: spec.product.categoryId,
    categoryName: spec.product.category.name,
    brandId: spec.product.brandId,
    brandName: spec.product.brand.name,
    productId: spec.productId,
    productName: spec.product.name,
    name: spec.name,
    sku: spec.sku,
    unit: spec.unit,
    qty: spec.qty,
    reserved: spec.reserved,
    available,
    minStock: spec.minStock,
    purchasePrice: spec.purchasePrice,
    salePrice: spec.salePrice,
    supplierId: spec.supplierId,
    supplierName: spec.supplier?.name || '',
    location: spec.location,
    comment: spec.comment,
    status: spec.status,
    stockStatus: spec.qty <= 0 ? 'out' : lowStock ? 'low' : 'ok',
    createdAt: spec.createdAt,
  };
}

const itemInclude = { product: { include: { category: true, brand: true } }, supplier: true };

router.get('/items', requirePermission('stock', 'view'), ah(async (req, res) => {
  const { search, categoryId, brandId, status, lowStock, outOfStock } = req.query;
  const where = {};
  if (categoryId) where.product = { categoryId };
  if (brandId) where.product = { ...(where.product || {}), brandId };
  if (status) where.status = status;

  let specs = await prisma.productSpec.findMany({ where, include: itemInclude, orderBy: { createdAt: 'desc' } });
  let items = specs.map(shapeItem);

  if (search) {
    const q = String(search).toLowerCase();
    items = items.filter((it) => [it.categoryName, it.brandName, it.productName, it.name, it.sku]
      .some((f) => (f || '').toLowerCase().includes(q)));
  }
  if (lowStock === '1') items = items.filter((it) => it.stockStatus === 'low');
  if (outOfStock === '1') items = items.filter((it) => it.stockStatus === 'out');

  res.json(items);
}));

router.get('/items/:id', requirePermission('stock', 'view'), ah(async (req, res) => {
  const spec = await prisma.productSpec.findUnique({ where: { id: req.params.id }, include: itemInclude });
  if (!spec) return res.status(404).json({ error: 'Товар не найден' });
  const movements = await prisma.stockMovement.findMany({
    where: { specId: spec.id }, orderBy: { createdAt: 'desc' },
    include: { employee: { select: { name: true } }, supplier: { select: { name: true } } },
  });
  const orders = await prisma.order.findMany({
    where: { materials: { some: { specId: spec.id } } },
    select: { id: true, number: true, productType: true, clientName: true },
  });
  res.json({ ...shapeItem(spec), movements, orders });
}));

async function findOrCreate(model, where, data) {
  const existing = await prisma[model].findFirst({ where });
  if (existing) return existing;
  return prisma[model].create({ data: { id: uid(model.slice(0, 3)), createdAt: Date.now(), ...data } });
}

// Combined creation: Category -> Brand -> Product -> Spec, find-or-create at
// every level by name so the same catalog tree keeps growing instead of
// duplicating rows every time someone adds another spec under it.
router.post('/items', requirePermission('stock', 'create'), ah(async (req, res) => {
  const body = req.body || {};
  if (!body.categoryName || !body.brandName || !body.productName) {
    return res.status(400).json({ error: 'Категория, бренд и наименование обязательны' });
  }

  const spec = await prisma.$transaction(async (tx) => {
    const category = await findOrCreate('category', { name: body.categoryName }, { name: body.categoryName });
    const brand = await findOrCreate('brand', { name: body.brandName }, { name: body.brandName });
    const product = await findOrCreate('product',
      { categoryId: category.id, brandId: brand.id, name: body.productName },
      { categoryId: category.id, brandId: brand.id, name: body.productName });

    return tx.productSpec.create({
      data: {
        id: uid('spc'),
        productId: product.id,
        name: body.name || '',
        sku: body.sku || '',
        unit: body.unit || 'шт.',
        qty: 0,
        minStock: body.minStock != null && body.minStock !== '' ? Number(body.minStock) : null,
        purchasePrice: Number(body.purchasePrice) || 0,
        salePrice: Number(body.salePrice) || 0,
        supplierId: body.supplierId || null,
        location: body.location || '',
        comment: body.comment || '',
        createdAt: Date.now(),
      },
    });
  });

  const full = await prisma.productSpec.findUnique({ where: { id: spec.id }, include: itemInclude });
  await logAudit(req, { action: 'stock.item.create', entityType: 'stock_item', entityId: spec.id, newValue: shapeItem(full) });
  res.status(201).json(shapeItem(full));
}));

router.patch('/items/:id', requirePermission('stock', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.productSpec.findUnique({ where: { id: req.params.id }, include: itemInclude });
  if (!before) return res.status(404).json({ error: 'Товар не найден' });

  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.sku !== undefined) data.sku = body.sku;
  if (body.unit !== undefined) data.unit = body.unit;
  if (body.minStock !== undefined) data.minStock = body.minStock === '' || body.minStock == null ? null : Number(body.minStock);
  if (body.purchasePrice !== undefined) data.purchasePrice = Number(body.purchasePrice) || 0;
  if (body.salePrice !== undefined) data.salePrice = Number(body.salePrice) || 0;
  if (body.supplierId !== undefined) data.supplierId = body.supplierId || null;
  if (body.location !== undefined) data.location = body.location;
  if (body.comment !== undefined) data.comment = body.comment;
  if (body.status !== undefined) data.status = body.status;

  const updated = await prisma.productSpec.update({ where: { id: req.params.id }, data, include: itemInclude });
  await logAudit(req, {
    action: 'stock.item.update', entityType: 'stock_item', entityId: updated.id,
    oldValue: shapeItem(before), newValue: shapeItem(updated),
  });
  res.json(shapeItem(updated));
}));

// Not a hard delete if the item has ever moved — archive instead so order
// history stays intact (spec section 24).
router.delete('/items/:id', requirePermission('stock', 'delete'), ah(async (req, res) => {
  const spec = await prisma.productSpec.findUnique({ where: { id: req.params.id } });
  if (!spec) return res.status(404).json({ error: 'Товар не найден' });
  const hasMovements = await prisma.stockMovement.count({ where: { specId: spec.id } });
  const hasMaterials = await prisma.material.count({ where: { specId: spec.id } });

  if (hasMovements || hasMaterials) {
    const updated = await prisma.productSpec.update({ where: { id: spec.id }, data: { status: 'archived' } });
    await logAudit(req, { action: 'stock.item.archive', entityType: 'stock_item', entityId: spec.id, oldValue: { status: spec.status }, newValue: { status: 'archived' } });
    return res.json(shapeItem({ ...updated, product: undefined }));
  }
  await prisma.productSpec.delete({ where: { id: spec.id } });
  await logAudit(req, { action: 'stock.item.delete', entityType: 'stock_item', entityId: spec.id, oldValue: spec });
  res.status(204).end();
}));

// ---- Movements: income / expense / adjustment ----

router.post('/items/:id/income', requirePermission('stock', 'income'), ah(async (req, res) => {
  const body = req.body || {};
  const qty = Number(body.qty);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Укажите количество больше 0' });

  const spec = await prisma.$transaction(async (tx) => {
    const updated = await tx.productSpec.update({
      where: { id: req.params.id },
      data: {
        qty: { increment: qty },
        ...(body.price != null && body.price !== '' ? { purchasePrice: Number(body.price) } : {}),
        ...(body.supplierId ? { supplierId: body.supplierId } : {}),
      },
    });
    await tx.stockMovement.create({
      data: {
        id: uid('mov'), specId: updated.id, type: 'income', qty,
        price: body.price != null && body.price !== '' ? Number(body.price) : null,
        supplierId: body.supplierId || null, employeeId: req.employee.id,
        comment: body.comment || '', createdAt: Date.now(),
      },
    });
    return updated;
  });

  await logAudit(req, { action: 'stock.income', entityType: 'stock_item', entityId: spec.id, newValue: { qty, price: body.price } });
  res.status(201).json(shapeItem({ ...spec, product: await prisma.product.findUnique({ where: { id: spec.productId }, include: { category: true, brand: true } }), supplier: spec.supplierId ? await prisma.supplier.findUnique({ where: { id: spec.supplierId } }) : null }));
}));

const EXPENSE_REASONS = ['производство', 'сборка', 'заказ', 'брак', 'потеря', 'другое'];

router.post('/items/:id/expense', requirePermission('stock', 'expense'), ah(async (req, res) => {
  const body = req.body || {};
  const qty = Number(body.qty);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Укажите количество больше 0' });
  if (body.reason && !EXPENSE_REASONS.includes(body.reason)) return res.status(400).json({ error: 'Неизвестная причина расхода' });

  const before = await prisma.productSpec.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Товар не найден' });
  const available = before.qty - before.reserved;
  if (qty > available && !req.employee?.permissions?.stock?.adjustment) {
    return res.status(409).json({
      error: 'Недостаточно товара на складе',
      available, requested: qty, shortage: qty - available,
    });
  }

  const spec = await prisma.$transaction(async (tx) => {
    const updated = await tx.productSpec.update({ where: { id: req.params.id }, data: { qty: { decrement: qty } } });
    await tx.stockMovement.create({
      data: {
        id: uid('mov'), specId: updated.id, type: 'expense', qty,
        employeeId: req.employee.id, reason: body.reason || 'другое', comment: body.comment || '', createdAt: Date.now(),
      },
    });
    return updated;
  });

  await logAudit(req, { action: 'stock.expense', entityType: 'stock_item', entityId: spec.id, newValue: { qty, reason: body.reason } });
  res.status(201).json({ qty: spec.qty, reserved: spec.reserved, available: spec.qty - spec.reserved });
}));

router.post('/items/:id/adjustment', requirePermission('stock', 'adjustment'), ah(async (req, res) => {
  const body = req.body || {};
  const newQty = Number(body.qty);
  if (Number.isNaN(newQty) || newQty < 0) return res.status(400).json({ error: 'Некорректное количество' });

  const before = await prisma.productSpec.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Товар не найден' });
  const delta = newQty - before.qty;

  const spec = await prisma.$transaction(async (tx) => {
    const updated = await tx.productSpec.update({ where: { id: req.params.id }, data: { qty: newQty } });
    await tx.stockMovement.create({
      data: {
        id: uid('mov'), specId: updated.id, type: 'adjustment', qty: delta,
        employeeId: req.employee.id, comment: body.comment || '', createdAt: Date.now(),
      },
    });
    return updated;
  });

  await logAudit(req, { action: 'stock.adjustment', entityType: 'stock_item', entityId: spec.id, oldValue: { qty: before.qty }, newValue: { qty: spec.qty } });
  res.status(201).json({ qty: spec.qty, reserved: spec.reserved, available: spec.qty - spec.reserved });
}));

// ---- Dashboard ----

router.get('/dashboard', requirePermission('stock', 'view'), ah(async (req, res) => {
  const specs = await prisma.productSpec.findMany({ where: { status: 'active' }, include: itemInclude });
  const items = specs.map(shapeItem);
  const totalValue = items.reduce((sum, it) => sum + it.qty * it.purchasePrice, 0);
  const totalUnits = items.reduce((sum, it) => sum + it.qty, 0);
  const lowStock = items.filter((it) => it.stockStatus === 'low');
  const outOfStock = items.filter((it) => it.stockStatus === 'out');
  const reserved = items.filter((it) => it.reserved > 0);

  res.json({
    totalValue, itemCount: items.length, totalUnits,
    lowStock, outOfStock, reserved,
  });
}));

export default router;
