import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { ah, uid } from '../util.js';
import { requirePermission } from '../middleware/auth.js';
import { logAudit } from '../audit.js';
import { PRESET_ROLES, emptyPermissions, defaultScopeFlags, emptyFinancialFlags } from '../rbac.js';

const router = Router();

const publicEmployee = (e) => ({
  id: e.id, name: e.name, role: e.role, phone: e.phone, email: e.email,
  accessRole: e.accessRole, permissions: e.permissions, financialFlags: e.financialFlags,
  scopeFlags: e.scopeFlags, isBlocked: e.isBlocked,
});

router.post('/', requirePermission('employees', 'create'), ah(async (req, res) => {
  const body = req.body || {};
  const grantsLogin = !!(body.email && body.password);

  if (grantsLogin && (!body.accessRole || !body.permissions)) {
    return res.status(400).json({ error: 'Для сотрудника с доступом в систему нужно выбрать роль и разрешения' });
  }

  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : null;
  const employee = await prisma.employee.create({
    data: {
      id: body.id || uid('emp'),
      name: body.name,
      role: body.role,
      phone: body.phone || '',
      email: body.email ? String(body.email).toLowerCase() : null,
      passwordHash,
      accessRole: grantsLogin ? body.accessRole : 'Без доступа',
      permissions: grantsLogin ? body.permissions : emptyPermissions(),
      financialFlags: grantsLogin ? (body.financialFlags || emptyFinancialFlags()) : emptyFinancialFlags(),
      scopeFlags: grantsLogin ? (body.scopeFlags || defaultScopeFlags()) : defaultScopeFlags(),
      createdAt: Date.now(),
    },
  });
  await logAudit(req, {
    action: 'employee.create', entityType: 'employee', entityId: employee.id,
    newValue: { name: employee.name, role: employee.role, accessRole: employee.accessRole },
  });
  res.status(201).json(publicEmployee(employee));
}));

router.get('/roles', ah(async (req, res) => {
  const perms = req.employee?.permissions?.employees || {};
  if (!perms.create && !perms.edit) return res.status(403).json({ error: 'Недостаточно прав' });
  res.json(PRESET_ROLES);
}));

router.patch('/:id', requirePermission('employees', 'edit'), ah(async (req, res) => {
  const body = req.body || {};
  const before = await prisma.employee.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Сотрудник не найден' });

  const willHaveEmail = body.email !== undefined ? !!body.email : !!before.email;
  const willHaveAccessRole = body.accessRole !== undefined ? body.accessRole : before.accessRole;
  if (willHaveEmail && (!willHaveAccessRole || willHaveAccessRole === 'Без доступа') && !body.permissions) {
    return res.status(400).json({ error: 'Для сотрудника с доступом в систему нужно выбрать роль и разрешения' });
  }

  const data = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.role !== undefined) data.role = body.role;
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.email !== undefined) data.email = body.email ? String(body.email).toLowerCase() : null;
  if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);
  if (body.accessRole !== undefined) data.accessRole = body.accessRole;
  if (body.permissions !== undefined) data.permissions = body.permissions;
  if (body.financialFlags !== undefined) data.financialFlags = body.financialFlags;
  if (body.scopeFlags !== undefined) data.scopeFlags = body.scopeFlags;

  const employee = await prisma.employee.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!employee) return res.status(404).json({ error: 'Сотрудник не найден' });

  await logAudit(req, {
    action: 'employee.update', entityType: 'employee', entityId: employee.id,
    oldValue: before ? { accessRole: before.accessRole, name: before.name, role: before.role } : undefined,
    newValue: { accessRole: employee.accessRole, name: employee.name, role: employee.role },
  });
  res.json(publicEmployee(employee));
}));

router.patch('/:id/block', requirePermission('employees', 'block'), ah(async (req, res) => {
  if (req.params.id === req.employee.id) return res.status(400).json({ error: 'Нельзя заблокировать самого себя' });
  const { blocked } = req.body || {};
  const employee = await prisma.employee.update({
    where: { id: req.params.id }, data: { isBlocked: !!blocked },
  }).catch(() => null);
  if (!employee) return res.status(404).json({ error: 'Сотрудник не найден' });
  await logAudit(req, {
    action: blocked ? 'employee.block' : 'employee.unblock', entityType: 'employee', entityId: employee.id,
    newValue: { isBlocked: employee.isBlocked },
  });
  res.json(publicEmployee(employee));
}));

router.delete('/:id', requirePermission('employees', 'delete'), ah(async (req, res) => {
  if (req.params.id === req.employee.id) return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  const before = await prisma.employee.findUnique({ where: { id: req.params.id } });
  await prisma.employee.delete({ where: { id: req.params.id } }).catch(() => null);
  if (before) {
    await logAudit(req, {
      action: 'employee.delete', entityType: 'employee', entityId: before.id,
      oldValue: { name: before.name, role: before.role, accessRole: before.accessRole },
    });
  }
  res.status(204).end();
}));

export default router;
