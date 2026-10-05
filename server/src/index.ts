import fs from 'fs';
import http from 'http';
import path from 'path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './config/env';
import { getPool } from './config/db';
import { authenticate } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { logger } from './shared/logger';
import { initSocket } from './socket';
import { purgeExpiredTrash } from './services/purge';
import { leaderTask, leaderTasks, releaseLeases } from './services/leader';
import { NODE_ID, clusterEnabled } from './services/cluster';
import { applyMigrations } from './scripts/migrate';
import accessRoutes from './routes/access';
import activityRoutes from './routes/activity';
import auditRoutes from './routes/audit';
import authRoutes from './routes/auth';
import cellRoutes from './routes/cells';
import columnRoutes from './routes/columns';
import dashboardRoutes from './routes/dashboards';
import favoriteRoutes from './routes/favorites';
import fileRoutes from './routes/files';
import folderRoutes from './routes/folders';
import notificationRoutes from './routes/notifications';
import rowRoutes from './routes/rows';
import searchRoutes from './routes/search';
import sheetRoutes from './routes/sheets';
import themeRoutes from './routes/themes';
import trashRoutes from './routes/trash';
import oauthRoutes from './routes/oauth';
import pdfRoutes from './routes/pdf';
import unionRoutes from './routes/union';
import { shareManageRouter, sharePublicRouter } from './routes/share';
import formulaModule from './modules/formula/module';
import exportArchiveModule from './modules/exportArchive/module';
import approvalsModule from './modules/approvals/module';
import inkcodeModule from './modules/inkcode/module';
import aiModule from './modules/ai/module';
import connectorsModule, { startConnectorScheduler } from './modules/connectors/module';
import './modules/alerts/module';
import scanModule from './modules/scan/module';
import mixModule from './modules/mix/module';
import linesModule from './modules/lines/module';
import traceModule from './modules/trace/module';
import formLayoutModule from './modules/formLayout/module';
import devicesModule, { startGateway } from './modules/devices/module';
import lineAlertsModule, { startLineWorker } from './modules/lineAlerts/module';
import uploadRoutes from './routes/uploads';
import userRoutes from './routes/users';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: env.corsOrigins, credentials: true }));
// the LINE webhook signature is checked against the exact bytes LINE sent
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { if (req.url?.startsWith('/api/line/webhook')) (req as any).rawBody = buf; } }));
app.use(cookieParser());
app.use('/uploads', express.static(path.resolve(env.uploadDir), { maxAge: '7d', index: false }));

app.get('/api/health', async (_req, res) => {
  try {
    await (await getPool()).request().query('SELECT 1 AS ok');
    res.json({ success: true, data: { status: 'ok', db: 'up', node: NODE_ID, cluster: clusterEnabled, runs: leaderTasks(), time: new Date().toISOString() } });
  } catch {
    res.status(503).json({ success: false, error: { code: 'DB_DOWN', message: 'Database unavailable' } });
  }
});

app.use('/api', rateLimit({ windowMs: 60_000, max: env.rateLimitPerMin, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth', authRoutes);
app.use('/api/auth', oauthRoutes);
app.use('/api', sharePublicRouter);
app.use('/api', lineAlertsModule.webhook);
app.use('/api', devicesModule.ingest);
app.use('/api', authenticate);
for (const r of [
  userRoutes, folderRoutes, fileRoutes, sheetRoutes, columnRoutes, rowRoutes, cellRoutes, accessRoutes, auditRoutes,
  favoriteRoutes, activityRoutes, searchRoutes, notificationRoutes, themeRoutes, dashboardRoutes, uploadRoutes, trashRoutes, shareManageRouter, unionRoutes, pdfRoutes, formulaModule.router, exportArchiveModule.router, approvalsModule.router, connectorsModule.router, aiModule.router, inkcodeModule.router, lineAlertsModule.router, scanModule.router, mixModule.router, linesModule.router, traceModule.router, formLayoutModule.router, devicesModule.router,
]) app.use('/api', r);
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบ API ที่เรียก' } });
});
app.use(errorHandler);

if (env.serveClientDir) {
  const dir = path.resolve(env.serveClientDir);
  if (fs.existsSync(path.join(dir, 'index.html'))) {
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
    logger.info(`Serving client from ${dir}`);
  }
}

const server = http.createServer(app);
initSocket(server);

getPool()
  .then(() => applyMigrations())
  .then(() => {
    server.listen(env.port, '0.0.0.0', () =>
      logger.info(`DataSheet Pro API listening on http://0.0.0.0:${env.port} (LAN: http://172.48.0.116:${env.port})`)
    );
    // jobs that must run on ONE server: whoever holds the lease runs them, another server takes over if it stops (see services/leader.ts)
    leaderTask('trash-purge', () => { void purgeExpiredTrash(); const t = setInterval(() => void purgeExpiredTrash(), 6 * 3600_000); return () => clearInterval(t); });
    leaderTask('line-alerts', startLineWorker);
    leaderTask('connectors', startConnectorScheduler);
    leaderTask('rfid-gateway', startGateway);
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void releaseLeases().finally(() => process.exit(0)));
  })
  .catch((err) => {
    logger.error(`Cannot connect to SQL Server: ${err?.message}`);
    process.exit(1);
  });

const shutdown = () => {
  logger.info('Shutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);