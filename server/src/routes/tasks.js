import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid, todayISO, addDays } from '../util.js';

const router = Router();

router.post('/', ah(async (req, res) => {
  const body = req.body || {};
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
  res.status(201).json(task);
}));

router.patch('/:id', ah(async (req, res) => {
  const body = req.body || {};
  const data = {};
  ['name', 'qty', 'assigneeId', 'deadline', 'status', 'priority', 'comment'].forEach((k) => {
    if (body[k] !== undefined) data[k] = k === 'qty' ? Number(body[k]) || 1 : body[k];
  });

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
  res.json(task);
}));

router.delete('/:id', ah(async (req, res) => {
  await prisma.task.delete({ where: { id: req.params.id } }).catch(() => null);
  res.status(204).end();
}));

export default router;
