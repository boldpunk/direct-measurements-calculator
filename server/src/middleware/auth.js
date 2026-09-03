import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = '30m';

export function signToken(employee) {
  return jwt.sign({ sub: employee.id, email: employee.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const employee = await prisma.employee.findUnique({ where: { id: payload.sub } });
    if (!employee || employee.isBlocked) return res.status(401).json({ error: 'Сессия недействительна' });
    req.employeeId = employee.id;
    req.employee = employee;
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

// Returns a middleware that 403s unless the current employee's permissions
// grant `action` on `moduleName`.
export function requirePermission(moduleName, action) {
  return (req, res, next) => {
    const allowed = !!req.employee?.permissions?.[moduleName]?.[action];
    if (!allowed) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}
