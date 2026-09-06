import { prisma } from './prisma.js';
import { uid } from './util.js';

export async function logAudit(req, { action, entityType, entityId, oldValue, newValue }) {
  try {
    await prisma.auditLog.create({
      data: {
        id: uid('log'),
        employeeId: req.employee?.id || null,
        employeeName: req.employee?.name || '',
        timestamp: Date.now(),
        action,
        entityType,
        entityId: entityId != null ? String(entityId) : null,
        oldValue: oldValue === undefined ? undefined : oldValue,
        newValue: newValue === undefined ? undefined : newValue,
        ip: req.ip || '',
        userAgent: req.headers['user-agent'] || '',
      },
    });
  } catch (e) {
    console.error('Failed to write audit log', e);
  }
}
