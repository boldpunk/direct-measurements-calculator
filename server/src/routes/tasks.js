import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid, todayISO, addDays } from '../util.js';
import { logAudit } from '../audit.js';

const router = Router();

// Столярка board tasks share this same Task entity/endpoints with the
// general Задачи page, distinguished only by stageKey. Carpentry-floor
// roles get carpentry.* permissions rather than full tasks.* rights.
const CARPENTRY_STAGE_KEYS = ['carpentry', 'drilling'];
const isCarpentryStage = (stageKey) => CARPENTRY_STAGE_KEYS.includes(stageKey);

router.post('/', ah(async (req, res) => {
  const body = req.body || {};
  const perms = req.employee?.permissions || {};
  const allowed = perms.tasks?.create || (isCarpentryStage(body.stageKey) && perms.carpentry?.create);
  if (!allowed) return res.status(403).json({ error: 'Недостаточно прав' });

  let stageId = null;
  if (body.orderId && body.stageKey) {
    const stage = await prisma.stage.findFirst({ where: { orderId: body.orderId, defKey: body.stageKey } });
    stageId = stage ? stage.id : null;
  }
  const task = await prisma.task.create({
    data: {
      id: body.id || uid('tsk'),
      orderId: body.orderId || null,
      stageId,
      stageKey: body.stageKey || null,
      name: body.name,
      qty: Number(body.qty) || 1,
      assigneeId: body.assigneeId || null,
      deadline: body.deadline || addDays(todayISO(), 3),
      status: body.status || 'ожидает',
      priority: body.priority || 'Средний',
      comment: body.comment || '',
      createdAt: Date.now(),
    },
  });
  await logAudit(req, { action: 'task.create', entityType: 'task', entityId: task.id, newValue: task });
  res.status(201).json(task);
}));

// A status/priority-only change is allowed with just carpentry.changeStatus,
// matching production-floor roles that shouldn't need full task-edit rights
// just to move a card on the board.
router.patch('/:id', ah(async (req, res) => {
  const body = req.body || {};
  const perms = req.employee?.permissions || {};
  const isStatusOnlyChange = Object.keys(body).every((k) => ['status', 'priority'].includes(k));
  const allowed = perms.tasks?.edit || (isStatusOnlyChange && perms.carpentry?.changeStatus);
  if (!allowed) return res.status(403).json({ error: 'Недостаточно прав' });

  const data = {};
  ['name', 'qty', 'assigneeId', 'deadline', 'status', 'priority', 'comment'].forEach((k) => {
    if (body[k] !== undefined) data[k] = k === 'qty' ? Number(body[k]) || 1 : body[k];
  });

  const before = await prisma.task.findUnique({ where: { id: req.params.id } });
  const task = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!updated) return null;
    if (data.status === 'готово') {
      const rw = await tx.rework.findFirst({ where: { taskId: updated.id } });
      if (rw) await tx.rework.update({ where: { id: rw.id }, data: { status: 'готово' } });
    }
    return updated;
  });
  if (!task) return res.status(404).json({ error: 'Задача не найдена' });
  await logAudit(req, {
    action: 'task.update', entityType: 'task', entityId: task.id,
    oldValue: before ? Object.fromEntries(Object.keys(data).map((k) => [k, before[k]])) : undefined,
    newValue: Object.fromEntries(Object.keys(data).map((k) => [k, task[k]])),
  });
  res.json(task);
}));

router.delete('/:id', ah(async (req, res) => {
  const before = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(204).end();

  const perms = req.employee?.permissions || {};
  const allowed = perms.tasks?.delete || (isCarpentryStage(before.stageKey) && perms.carpentry?.delete);
  if (!allowed) return res.status(403).json({ error: 'Недостаточно прав' });

  await prisma.task.delete({ where: { id: req.params.id } }).catch(() => null);
  await logAudit(req, { action: 'task.delete', entityType: 'task', entityId: before.id, oldValue: before });
  res.status(204).end();
}));

export default router;
