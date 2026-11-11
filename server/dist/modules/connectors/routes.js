"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const env_1 = require("../../config/env");
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const parse_1 = require("./parse");
const runner_1 = require("./runner");
const secret_1 = require("./secret");
const source_1 = require("./source");
const parse_2 = require("./parse");
const router = (0, express_1.Router)();
const MS_STATE = 'ms_connector_state';
const manage = (0, auth_1.requireRole)('master', 'admin');
const cfgSchema = zod_1.z.object({
    url: zod_1.z.string().trim().min(8).max(2000),
    method: zod_1.z.enum(['GET', 'POST']).default('GET'),
    headers: zod_1.z.record(zod_1.z.string().max(2000)).default({}),
    body: zod_1.z.string().max(20000).optional(),
    format: zod_1.z.enum(['auto', 'json', 'csv', 'xlsx']).default('auto'),
    jsonPath: zod_1.z.string().max(300).optional(),
    sheetName: zod_1.z.string().max(200).optional(),
    headerRow: zod_1.z.number().int().min(1).max(1000).optional(),
    delimiter: zod_1.z.string().max(3).optional(),
});
const mappingSchema = zod_1.z.array(zod_1.z.object({ source: zod_1.z.string().min(1).max(300), columnId: http_1.zId })).max(200);
const bodySchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(200), kind: zod_1.z.enum(['http', 'sharepoint']), config: cfgSchema,
    targetSheetId: http_1.zId.nullish(), mapping: mappingSchema.default([]), keyColumnId: http_1.zId.nullish(), scheduleMin: zod_1.z.number().int().min(0).max(10080).default(0),
});
const map = (r) => ({
    id: r.connector_id, name: r.name, kind: r.kind, config: (0, http_1.safeJson)(r.config_json, {}), targetSheetId: r.target_sheet_id, mapping: (0, http_1.safeJson)(r.mapping_json, []), keyColumnId: r.key_column_id,
    scheduleMin: r.schedule_min, lastRunAt: r.last_run_at, lastStatus: r.last_status, lastMessage: r.last_message, running: !!r.running_since, createdBy: r.created_by,
    hasCredentials: !!(0, secret_1.decryptJson)(r.secret_enc) && (r.kind === 'sharepoint' ? !!(0, secret_1.decryptJson)(r.secret_enc)?.msRefresh : (0, secret_1.decryptJson)(r.secret_enc)?.type !== 'none'),
});
async function owned(req) {
    const r = await (0, db_1.q1)(`SELECT * FROM Connectors WHERE connector_id = @i AND is_deleted = 0`, { i: db_1.T.uuid((0, http_1.pid)(req)) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบ connector');
    if (r.created_by.toLowerCase() !== req.user.id.toLowerCase() && !(0, auth_1.isAdminRole)(req.user.role))
        throw (0, http_1.forbidden)('connector นี้เป็นของผู้ใช้อื่น');
    return r;
}
const needsAuthJson = (e) => ({ code: 'NEEDS_AUTH', kind: e.kind });
router.get('/connectors', manage, (0, http_1.ah)(async (req, res) => {
    const rows = await (0, db_1.q)(`SELECT * FROM Connectors WHERE is_deleted = 0 ${(0, auth_1.isAdminRole)(req.user.role) ? '' : 'AND created_by = @u'} ORDER BY name`, { u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { items: rows.map(map), microsoft: (0, source_1.msConfigured)() });
}));
router.post('/connectors', manage, (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(bodySchema, req.body);
    if (b.targetSheetId)
        await (0, permissions_1.requireSheet)(req.user, b.targetSheetId, permissions_1.LV.write);
    const r = await (0, db_1.q1)(`INSERT INTO Connectors (name, kind, config_json, target_sheet_id, mapping_json, key_column_id, schedule_min, created_by)
     OUTPUT inserted.connector_id VALUES (@n, @k, @c, @t, @m, @kc, @s, @u)`, { n: b.name, k: b.kind, c: db_1.T.text(JSON.stringify(b.config)), t: db_1.T.uuid(b.targetSheetId ?? null), m: db_1.T.text(JSON.stringify(b.mapping)), kc: db_1.T.uuid(b.keyColumnId ?? null), s: db_1.T.int(b.scheduleMin), u: db_1.T.uuid(req.user.id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'connector_create', entityType: 'connector', entityId: r.connector_id, newValue: { name: b.name, kind: b.kind, host: safeHost(b.config.url) } }, req);
    (0, http_1.ok)(res, { id: r.connector_id }, 201);
}));
router.put('/connectors/:id', manage, (0, http_1.ah)(async (req, res) => {
    const cur = await owned(req);
    const b = (0, http_1.parse)(bodySchema, req.body);
    if (b.targetSheetId)
        await (0, permissions_1.requireSheet)(req.user, b.targetSheetId, permissions_1.LV.write);
    const urlChanged = (0, http_1.safeJson)(cur.config_json, { url: '' }).url !== b.config.url;
    await (0, db_1.q)(`UPDATE Connectors SET name = @n, kind = @k, config_json = @c, target_sheet_id = @t, mapping_json = @m, key_column_id = @kc, schedule_min = @s,
           secret_enc = CASE WHEN @reset = 1 THEN NULL ELSE secret_enc END WHERE connector_id = @i`, { n: b.name, k: b.kind, c: db_1.T.text(JSON.stringify(b.config)), t: db_1.T.uuid(b.targetSheetId ?? null), m: db_1.T.text(JSON.stringify(b.mapping)), kc: db_1.T.uuid(b.keyColumnId ?? null), s: db_1.T.int(b.scheduleMin), reset: db_1.T.int(urlChanged || cur.kind !== b.kind ? 1 : 0), i: db_1.T.uuid(cur.connector_id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'connector_update', entityType: 'connector', entityId: cur.connector_id, newValue: { name: b.name } }, req);
    (0, http_1.ok)(res, { saved: true, credentialsReset: urlChanged });
}));
router.delete('/connectors/:id', manage, (0, http_1.ah)(async (req, res) => {
    const cur = await owned(req);
    await (0, db_1.q)(`UPDATE Connectors SET is_deleted = 1 WHERE connector_id = @i`, { i: db_1.T.uuid(cur.connector_id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'connector_delete', entityType: 'connector', entityId: cur.connector_id, newValue: { name: cur.name } }, req);
    (0, http_1.ok)(res, { deleted: true });
}));
/** Credentials typed into the popup — stored encrypted, never sent back */
router.put('/connectors/:id/credentials', manage, (0, http_1.ah)(async (req, res) => {
    const cur = await owned(req);
    const b = (0, http_1.parse)(zod_1.z.object({ type: zod_1.z.enum(['none', 'basic', 'bearer', 'header']), username: zod_1.z.string().max(300).optional(), password: zod_1.z.string().max(500).optional(), token: zod_1.z.string().max(4000).optional(), headerName: zod_1.z.string().max(100).optional() }), req.body);
    await (0, db_1.q)(`UPDATE Connectors SET secret_enc = @s WHERE connector_id = @i`, { s: db_1.T.text((0, secret_1.encryptJson)(b)), i: db_1.T.uuid(cur.connector_id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'connector_credentials', entityType: 'connector', entityId: cur.connector_id, newValue: { type: b.type } }, req);
    (0, http_1.ok)(res, { saved: true });
}));
/** Looks at the source without writing anything: field names + the first rows, so the user can define the format / mapping */
router.post('/connectors/preview', manage, (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(zod_1.z.object({ id: http_1.zId.optional(), kind: zod_1.z.enum(['http', 'sharepoint']), config: cfgSchema, credentials: zod_1.z.object({ type: zod_1.z.enum(['none', 'basic', 'bearer', 'header']), username: zod_1.z.string().optional(), password: zod_1.z.string().optional(), token: zod_1.z.string().optional(), headerName: zod_1.z.string().optional() }).optional() }), req.body);
    let enc = null;
    if (b.id) {
        const cur = await (0, db_1.q1)(`SELECT * FROM Connectors WHERE connector_id = @i AND is_deleted = 0`, { i: db_1.T.uuid(b.id) });
        if (cur && (cur.created_by.toLowerCase() === req.user.id.toLowerCase() || (0, auth_1.isAdminRole)(req.user.role)))
            enc = cur.secret_enc;
    }
    if (b.credentials)
        enc = (0, secret_1.encryptJson)(b.credentials);
    try {
        const f = await (0, source_1.fetchSource)(b.kind, b.config, enc, b.id ? async (e) => { await (0, db_1.q)(`UPDATE Connectors SET secret_enc = @s WHERE connector_id = @i`, { s: db_1.T.text(e), i: db_1.T.uuid(b.id) }); } : undefined);
        const recs = (0, parse_2.parseRecords)(f.body, b.config, f.contentType, f.finalUrl);
        const fields = [...new Set(recs.slice(0, 200).flatMap((r) => Object.keys(r)))];
        (0, http_1.ok)(res, { total: recs.length, fields, rows: recs.slice(0, 20), sheetNames: (0, parse_1.sheetNamesOf)(f.body) });
    }
    catch (e) {
        if (e instanceof source_1.NeedsAuth)
            return void res.status(401).json({ success: false, error: { code: 'NEEDS_AUTH', message: e.message, details: needsAuthJson(e) } });
        throw (0, http_1.badRequest)(e.message);
    }
}));
router.post('/connectors/:id/run', manage, (0, http_1.ah)(async (req, res) => {
    const cur = await owned(req);
    try {
        const r = await (0, runner_1.runConnector)(cur.connector_id, { userId: req.user.id });
        await (0, audit_1.audit)({ userId: req.user.id, action: 'connector_run', entityType: 'connector', entityId: cur.connector_id, newValue: { name: cur.name, ...r, errors: undefined } }, req);
        (0, http_1.ok)(res, r);
    }
    catch (e) {
        if (e instanceof source_1.NeedsAuth)
            return void res.status(401).json({ success: false, error: { code: 'NEEDS_AUTH', message: e.message, details: needsAuthJson(e) } });
        throw (0, http_1.badRequest)(e.message);
    }
}));
/* ---------- Microsoft sign-in popup (SharePoint / OneDrive links) ---------- */
const baseUrl = (req) => env_1.env.publicUrl || `${req.protocol}://${req.get('host')}`;
router.get('/connectors/:id/ms/start', manage, (0, http_1.ah)(async (req, res) => {
    const cur = await owned(req);
    if (!(0, source_1.msConfigured)())
        throw (0, http_1.badRequest)('ยังไม่ได้ตั้งค่า MS_CLIENT_ID / MS_CLIENT_SECRET บนเซิร์ฟเวอร์');
    const nonce = crypto_1.default.randomBytes(16).toString('hex');
    const st = jsonwebtoken_1.default.sign({ c: cur.connector_id, u: req.user.id, n: nonce }, env_1.env.jwt.secret, { expiresIn: '10m' });
    res.cookie(MS_STATE, st, { httpOnly: true, sameSite: 'lax', secure: env_1.env.cookieSecure, maxAge: 600_000, path: '/api/connectors/ms' });
    (0, http_1.ok)(res, { url: (0, source_1.msAuthorizeUrl)(baseUrl(req), nonce) });
}));
// the browser comes back from Microsoft without the API token: identity = signed state cookie
router.get('/connectors/ms/callback', (0, http_1.ah)(async (req, res) => {
    const done = (okFlag, msg) => res.type('html').send(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px"><p>${okFlag ? '✅' : '❌'} ${msg.replace(/[<>&]/g, '')}</p><script>try{window.opener&&window.opener.postMessage({type:'ms-connector',ok:${okFlag}},window.location.origin)}catch(e){};setTimeout(()=>window.close(),okFlag?800:4000)</script>`);
    try {
        if (req.query.error)
            return done(false, String(req.query.error_description || req.query.error).slice(0, 200));
        const st = jsonwebtoken_1.default.verify(String(req.cookies?.[MS_STATE] ?? ''), env_1.env.jwt.secret);
        res.clearCookie(MS_STATE, { path: '/api/connectors/ms' });
        if (st.n !== req.query.state || !req.query.code)
            return done(false, 'ข้อมูลยืนยันไม่ถูกต้อง');
        const tok = await (0, source_1.msExchangeCode)(baseUrl(req), String(req.query.code));
        if (!tok.refresh_token)
            return done(false, 'Microsoft ไม่ได้ส่ง refresh token (ตรวจสิทธิ์ offline_access ของแอป)');
        await (0, db_1.q)(`UPDATE Connectors SET secret_enc = @s WHERE connector_id = @i AND is_deleted = 0`, { s: db_1.T.text((0, secret_1.encryptJson)({ type: 'none', msRefresh: tok.refresh_token })), i: db_1.T.uuid(st.c) });
        await (0, audit_1.audit)({ userId: st.u, action: 'connector_ms_signin', entityType: 'connector', entityId: st.c }, req);
        done(true, 'เข้าสู่ระบบ Microsoft สำเร็จ — กลับไปที่หน้าเดิมได้เลย');
    }
    catch (e) {
        done(false, `เข้าสู่ระบบไม่สำเร็จ: ${e.message}`);
    }
}));
function safeHost(u) { try {
    return new URL(u).host;
}
catch {
    return '';
} }
exports.default = router;
//# sourceMappingURL=routes.js.map