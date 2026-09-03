import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export function signToken(employee) {
  return jwt.sign({ sub: employee.id, email: employee.email }, JWT_SECRET, { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.employeeId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}
