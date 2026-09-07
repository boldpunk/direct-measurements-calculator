// Temporary one-time data migration endpoints (old Render deployment -> new
// Hetzner VPS). Gated by a shared secret, not employee auth, since the
// import side runs against a database that has no real employees yet.
// Remove this file (and its mount in index.js) once the migration is done.
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah } from '../util.js';

const router = Router();

const MIGRATION_SECRET = process.env.MIGRATION_SECRET || '';

// Order matters for import (parents before children); export order is
// irrelevant but kept the same for readability.
const MODELS_IN_DEPENDENCY_ORDER = [
  'settings', 'employee', 'partner', 'client', 'category', 'brand', 'supplier',
  'product', 'productSpec', 'order', 'stage', 'task', 'rework', 'activity',
  'payment', 'material', 'stockReservation', 'stockMovement', 'supplierPayment',
  'outsourceExpense', 'salaryExpense', 'otherExpense', 'auditLog',
];

const TABLE_NAMES = [
  'AuditLog', 'OtherExpense', 'SalaryExpense', 'OutsourceExpense', 'SupplierPayment',
  'StockMovement', 'StockReservation', 'Material', 'Payment', 'Activity', 'Rework',
  'Task', 'Stage', 'Order', 'ProductSpec', 'Product', 'Supplier', 'Brand', 'Category',
  'Client', 'Partner', 'Employee', 'Settings',
];

function requireSecret(req, res, next) {
  if (!MIGRATION_SECRET || req.get('X-Migration-Secret') !== MIGRATION_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.get('/export', requireSecret, ah(async (req, res) => {
  const dump = {};
  for (const model of MODELS_IN_DEPENDENCY_ORDER) {
    dump[model] = await prisma[model].findMany();
  }
  res.json(dump);
}));

router.post('/import', requireSecret, ah(async (req, res) => {
  const dump = req.body || {};
  const counts = {};

  await prisma.$transaction(async (tx) => {
    const quoted = TABLE_NAMES.map((t) => `"${t}"`).join(', ');
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} CASCADE;`);

    for (const model of MODELS_IN_DEPENDENCY_ORDER) {
      const rows = dump[model];
      if (!Array.isArray(rows) || rows.length === 0) {
        counts[model] = 0;
        continue;
      }
      await tx[model].createMany({ data: rows });
      counts[model] = rows.length;
    }
  }, { timeout: 120000 });

  res.json({ ok: true, counts });
}));

export default router;
