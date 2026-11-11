"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = exports.manifestRouter = exports.publicRouter = exports.DEFAULT_APP_NAME = void 0;
exports.appName = appName;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const auth_1 = require("../../middleware/auth");
const cluster_1 = require("../../services/cluster");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
/**
 * The app's name ("Quality" by default): left bar, sign-in page, browser tab and the name under the icon on a phone's
 * home screen (manifest + apple-mobile-web-app-title). Set by an admin on ตั้งค่า → ชื่อระบบ.
 */
exports.DEFAULT_APP_NAME = 'Quality';
const KEY = 'app_name';
let cache = null;
(0, cluster_1.onBroadcast)('appInfo', () => { cache = null; });
async function appName() {
    if (cache && Date.now() - cache.at < 60_000)
        return cache.name;
    const r = await (0, db_1.q1)(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k: KEY }).catch(() => null);
    cache = { at: Date.now(), name: r?.setting_value?.trim() || exports.DEFAULT_APP_NAME };
    return cache.name;
}
/** before sign-in */
exports.publicRouter = (0, express_1.Router)();
exports.publicRouter.get('/app-info', (0, http_1.ah)(async (_req, res) => (0, http_1.ok)(res, { name: await appName() })));
/** the web app manifest with the configured name (served before the static files of client/dist) */
exports.manifestRouter = (0, express_1.Router)();
exports.manifestRouter.get('/manifest.webmanifest', (0, http_1.ah)(async (_req, res, next) => {
    const file = env_1.env.serveClientDir ? path_1.default.resolve(env_1.env.serveClientDir, 'manifest.webmanifest') : '';
    if (!file || !fs_1.default.existsSync(file))
        return next();
    const m = JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
    const name = await appName();
    res.type('application/manifest+json').set('Cache-Control', 'no-cache').send(JSON.stringify({ ...m, name, short_name: name.slice(0, 12) }));
}));
/** signed in: admins change it */
exports.router = (0, express_1.Router)();
exports.router.put('/app-info', (0, auth_1.requireRole)('admin'), (0, http_1.ah)(async (req, res) => {
    const { name } = (0, http_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(1, 'กรุณาใส่ชื่อ').max(40, 'ไม่เกิน 40 ตัวอักษร') }), req.body);
    const before = await appName();
    await (0, db_1.q)(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
     WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (s.setting_key, @v, @u);`, { k: KEY, v: name, u: db_1.T.uuid(req.user.id) });
    cache = null;
    (0, cluster_1.broadcast)('appInfo');
    await (0, audit_1.audit)({ userId: req.user.id, action: 'app_name_update', entityType: 'system', entityId: KEY, oldValue: { name: before }, newValue: { name } }, req);
    (0, http_1.ok)(res, { name });
}));
//# sourceMappingURL=routes.js.map