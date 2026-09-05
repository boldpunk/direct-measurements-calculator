import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import stateRoutes from './routes/state.js';
import clientsRoutes from './routes/clients.js';
import ordersRoutes from './routes/orders.js';
import tasksRoutes from './routes/tasks.js';
import reworkRoutes from './routes/rework.js';
import partnersRoutes from './routes/partners.js';
import employeesRoutes from './routes/employees.js';
import settingsRoutes from './routes/settings.js';
import auditLogRoutes from './routes/auditLog.js';
import { requireAuth } from './middleware/auth.js';

const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.set('trust proxy', true);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/state', requireAuth, stateRoutes);
app.use('/api/clients', requireAuth, clientsRoutes);
app.use('/api/orders', requireAuth, ordersRoutes);
app.use('/api/tasks', requireAuth, tasksRoutes);
app.use('/api/rework', requireAuth, reworkRoutes);
app.use('/api/partners', requireAuth, partnersRoutes);
app.use('/api/employees', requireAuth, employeesRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/audit-log', requireAuth, auditLogRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`MebelFlow API listening on http://localhost:${port}`);
});
