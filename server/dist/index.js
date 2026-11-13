"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const helmet_1 = __importDefault(require("helmet"));
const env_1 = require("./config/env");
const db_1 = require("./config/db");
const auth_1 = require("./middleware/auth");
const error_1 = require("./middleware/error");
const logger_1 = require("./shared/logger");
const socket_1 = require("./socket");
const purge_1 = require("./services/purge");
const leader_1 = require("./services/leader");
const cluster_1 = require("./services/cluster");
const migrate_1 = require("./scripts/migrate");
const access_1 = __importDefault(require("./routes/access"));
const activity_1 = __importDefault(require("./routes/activity"));
const audit_1 = __importDefault(require("./routes/audit"));
const auth_2 = __importDefault(require("./routes/auth"));
const cells_1 = __importDefault(require("./routes/cells"));
const columns_1 = __importDefault(require("./routes/columns"));
const dashboards_1 = __importDefault(require("./routes/dashboards"));
const favorites_1 = __importDefault(require("./routes/favorites"));
const files_1 = __importDefault(require("./routes/files"));
const folders_1 = __importDefault(require("./routes/folders"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const rows_1 = __importDefault(require("./routes/rows"));
const search_1 = __importDefault(require("./routes/search"));
const sheets_1 = __importDefault(require("./routes/sheets"));
const themes_1 = __importDefault(require("./routes/themes"));
const trash_1 = __importDefault(require("./routes/trash"));
const oauth_1 = __importDefault(require("./routes/oauth"));
const pdf_1 = __importDefault(require("./routes/pdf"));
const union_1 = __importDefault(require("./routes/union"));
const share_1 = require("./routes/share");
require("./modules/autostamp/module"); // before formulas: they may read the stamped date / name
const module_1 = __importDefault(require("./modules/formula/module"));
const module_2 = __importStar(require("./modules/revisions/module"));
const module_3 = __importDefault(require("./modules/tags/module"));
const module_4 = __importDefault(require("./modules/accountRequests/module"));
const module_5 = __importDefault(require("./modules/dataSearch/module"));
const module_6 = __importDefault(require("./modules/monitor/module"));
const module_7 = __importDefault(require("./modules/pageAccess/module"));
const module_8 = __importDefault(require("./modules/appInfo/module"));
const module_9 = __importDefault(require("./modules/news/module"));
const module_10 = __importDefault(require("./modules/apps/module"));
const rootAccount_1 = require("./scripts/rootAccount");
const module_11 = __importDefault(require("./modules/exportArchive/module"));
const module_12 = __importDefault(require("./modules/approvals/module"));
const module_13 = __importStar(require("./modules/inkcode/module"));
const module_14 = __importDefault(require("./modules/ai/module"));
const module_15 = __importStar(require("./modules/connectors/module"));
require("./modules/alerts/module");
const module_16 = __importDefault(require("./modules/scan/module"));
const module_17 = __importDefault(require("./modules/mix/module"));
const module_18 = __importDefault(require("./modules/lines/module"));
const module_19 = __importDefault(require("./modules/trace/module"));
const module_20 = __importDefault(require("./modules/formLayout/module"));
const module_21 = __importStar(require("./modules/devices/module"));
const module_22 = __importStar(require("./modules/lineAlerts/module"));
const uploads_1 = __importDefault(require("./routes/uploads"));
const users_1 = __importDefault(require("./routes/users"));
const app = (0, express_1.default)();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(module_6.default.trafficMeter); // counts every request (admin Monitor page)
app.use((0, helmet_1.default)({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use((0, cors_1.default)({ origin: env_1.env.corsOrigins, credentials: true }));
// the LINE webhook signature is checked against the exact bytes LINE sent
app.use(express_1.default.json({ limit: '5mb', verify: (req, _res, buf) => { if (req.url?.startsWith('/api/line/webhook'))
        req.rawBody = buf; } }));
app.use((0, cookie_parser_1.default)());
app.use('/uploads', express_1.default.static(path_1.default.resolve(env_1.env.uploadDir), { maxAge: '7d', index: false }));
app.get('/api/health', async (_req, res) => {
    try {
        await (await (0, db_1.getPool)()).request().query('SELECT 1 AS ok');
        res.json({ success: true, data: { status: 'ok', db: 'up', node: cluster_1.NODE_ID, cluster: cluster_1.clusterEnabled, runs: (0, leader_1.leaderTasks)(), time: new Date().toISOString() } });
    }
    catch {
        res.status(503).json({ success: false, error: { code: 'DB_DOWN', message: 'Database unavailable' } });
    }
});
app.use('/api', (0, express_rate_limit_1.default)({ windowMs: 60_000, max: env_1.env.rateLimitPerMin, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth', auth_2.default);
app.use('/api/auth', oauth_1.default);
app.use('/api/auth', module_4.default.publicRouter);
app.use('/api', share_1.sharePublicRouter);
app.use('/api', module_8.default.publicRouter);
app.use('/api', module_22.default.webhook);
app.use('/api', module_21.default.ingest);
app.use('/api', auth_1.authenticate);
for (const r of [
    users_1.default, folders_1.default, files_1.default, sheets_1.default, columns_1.default, rows_1.default, cells_1.default, access_1.default, audit_1.default,
    favorites_1.default, activity_1.default, search_1.default, notifications_1.default, themes_1.default, dashboards_1.default, uploads_1.default, trash_1.default, share_1.shareManageRouter, union_1.default, pdf_1.default, module_1.default.router, module_11.default.router, module_12.default.router, module_15.default.router, module_14.default.router, module_13.default.router, module_22.default.router, module_16.default.router, module_17.default.router, module_18.default.router, module_19.default.router, module_20.default.router, module_21.default.router, module_2.default.router, module_3.default.router, module_4.default.router, module_5.default.router, module_6.default.router, module_7.default.router, module_9.default.router, module_8.default.router, module_10.default.router,
])
    app.use('/api', r);
app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบ API ที่เรียก' } });
});
app.use(error_1.errorHandler);
if (env_1.env.serveClientDir) {
    const dir = path_1.default.resolve(env_1.env.serveClientDir);
    if (fs_1.default.existsSync(path_1.default.join(dir, 'index.html'))) {
        app.use(module_8.default.manifestRouter); // the configured app name under the phone icon
        app.use(express_1.default.static(dir, { index: false, maxAge: '1h' }));
        app.get('*', (_req, res) => res.sendFile(path_1.default.join(dir, 'index.html')));
        logger_1.logger.info(`Serving client from ${dir}`);
    }
}
const server = http_1.default.createServer(app);
(0, socket_1.initSocket)(server);
(0, db_1.getPool)()
    .then(() => (0, migrate_1.applyMigrations)())
    .then(() => (0, migrate_1.applySeeds)().catch((e) => logger_1.logger.error(`Seeds skipped: ${e?.message}`)))
    .then(() => (0, rootAccount_1.ensureRootAccount)().catch((e) => logger_1.logger.error(`Root account not checked: ${e?.message}`)))
    .then(() => (0, module_2.ensureTypedBaselines)().catch((e) => logger_1.logger.error(`Doc types: first Revs not checked: ${e?.message}`)))
    .then(() => {
    module_6.default.startTrafficFlush();
    server.listen(env_1.env.port, '0.0.0.0', () => logger_1.logger.info(`DataSheet Pro API listening on http://0.0.0.0:${env_1.env.port} (LAN: http://172.48.0.116:${env_1.env.port})`));
    // jobs that must run on ONE server: whoever holds the lease runs them, another server takes over if it stops (see services/leader.ts)
    (0, leader_1.leaderTask)('trash-purge', () => { void (0, purge_1.purgeExpiredTrash)(); const t = setInterval(() => void (0, purge_1.purgeExpiredTrash)(), 6 * 3600_000); return () => clearInterval(t); });
    (0, leader_1.leaderTask)('line-alerts', module_22.startLineWorker);
    (0, leader_1.leaderTask)('connectors', module_15.startConnectorScheduler);
    (0, leader_1.leaderTask)('rfid-gateway', module_21.startGateway);
    (0, leader_1.leaderTask)('inkcode-plan-folder', module_13.startPlanFolderWatcher);
    for (const sig of ['SIGINT', 'SIGTERM'])
        process.on(sig, () => void (0, leader_1.releaseLeases)().finally(() => process.exit(0)));
})
    .catch((err) => {
    logger_1.logger.error(`Cannot connect to SQL Server: ${err?.message}`);
    process.exit(1);
});
const shutdown = () => {
    logger_1.logger.info('Shutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
//# sourceMappingURL=index.js.map