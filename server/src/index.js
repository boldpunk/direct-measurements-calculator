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
import stockRoutes from './routes/stock.js';
import servicesRoutes from './routes/services.js';
import migrationRoutes from './routes/migration.js';
import brandingRoutes from './routes/branding.js';
import filesRoutes from './routes/files.js';
import { dataUrisToFiles } from './stored-files.js';
import { eventsHandler, announceChanges } from './live.js';
import { clientErrorsHandler, recordError } from './app-errors.js';
import pushRoutes from './routes/push.js';
import publicRoutes from './routes/public.js';
import reportsRoutes from './routes/reports.js';
import salaryRoutes from './routes/salary.js';
import proposalsRoutes from './routes/proposals.js';
import partnerBalanceRoutes from './routes/partnerBalance.js';
import { requireAuth } from './middleware/auth.js';
import { prisma } from './prisma.js';

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
app.use(express.json({ limit: '20mb' }));

// Used by deploy.sh after a restart and by deploy/healthcheck.sh. Touches the
// database so "API up, Postgres down" reports as unhealthy.
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'database' });
  }
});

app.get('/api/events', eventsHandler);
app.post('/api/client-errors', clientErrorsHandler);
app.use('/api/push', requireAuth, pushRoutes);
app.use('/api/public', publicRoutes);
app.use('/api', announceChanges);
app.use('/api/auth', authRoutes);
app.use('/api/state', requireAuth, stateRoutes);
app.use('/api/clients', requireAuth, clientsRoutes);
app.use('/api/orders', requireAuth, ordersRoutes);
app.use('/api/tasks', requireAuth, tasksRoutes);
app.use('/api/rework', requireAuth, dataUrisToFiles(['photoUrl']), reworkRoutes);
app.use('/api/partners', requireAuth, partnersRoutes);
app.use('/api/employees', requireAuth, employeesRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/audit-log', requireAuth, auditLogRoutes);
app.use('/api/stock', requireAuth, dataUrisToFiles(['logoUrl']), stockRoutes);
app.use('/api/services', requireAuth, servicesRoutes);
app.use('/api/branding', brandingRoutes);
app.use('/api/files', filesRoutes);
// One-off Render → Hetzner transfer. /import TRUNCATEs every table, so it is
// off unless explicitly switched on for the duration of a migration.
if (process.env.ENABLE_MIGRATION_ROUTES === '1') app.use('/api/migration', migrationRoutes);
app.use('/api/reports', requireAuth, reportsRoutes);
app.use('/api/salary', requireAuth, salaryRoutes);
app.use('/api/proposals', requireAuth, dataUrisToFiles(['imageUrl']), proposalsRoutes);
app.use('/api/partner-balance', requireAuth, partnerBalanceRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  recordError({
    source: 'server', message: err?.message || String(err), stack: err?.stack || '',
    url: `${req.method} ${req.originalUrl.split('?')[0]}`, userAgent: req.headers['user-agent'], employee: req.employee,
  });
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`MebelFlow API listening on http://localhost:${port}`);
});
