import { Router } from 'express';
import { prisma } from '../prisma.js';
import { ah, uid, todayISO, addDays } from '../util.js';

const router = Router();

router.post('/', ah(async (req, res) => {
  const body = req.body || {};
  const rework = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        id: uid('tsk'),
        orderId: body.orderId,
        stageKey: 'carpentry',
        name: `Переделка: ${body.description}`,
        qty: 1,
        assigneeId: body.responsibleId || null,
        deadline: addDays(todayISO(), 2),
        priority: 'Срочно',
        status: 'ожидает',
        comment: `Автоматически создано из переделки (${body.reason}).`,
        createdAt: Date.now(),
      },
    });
    return tx.rework.create({
      data: {
        id: body.id || uid('rwk'),
        orderId: body.orderId,
        reason: body.reason,
        description: body.description,
        photoUrl: body.photoUrl || '',
        responsibleId: body.responsibleId || null,
        urgency: body.urgency || 'срочно',
        status: 'открыто',
        costImpact: Number(body.costImpact) || 0,
        taskId: task.id,
        createdAt: Date.now(),
      },
    });
  });
  res.status(201).json(rework);
}));

router.patch('/:id/status', ah(async (req, res) => {
  const { status } = req.body || {};
  const rework = await prisma.$transaction(async (tx) => {
    const updated = await tx.rework.update({ where: { id: req.params.id }, data: { status } }).catch(() => null);
    if (!updated) return null;
    if (updated.taskId && status === 'готово') {
      await tx.task.update({ where: { id: updated.taskId }, data: { status: 'готово' } }).catch(() => null);
    }
    return updated;
  });
  if (!rework) return res.status(404).json({ error: 'Переделка не найдена' });
  res.json(rework);
}));

export default router;
