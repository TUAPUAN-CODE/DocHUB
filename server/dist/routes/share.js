"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sharePublicRouter = exports.shareManageRouter = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const permissions_1 = require("../shared/permissions");
const schemas_1 = require("../shared/schemas");
const cellWriter_1 = require("../services/cellWriter");
const rowQuery_1 = require("../services/rowQuery");
/** Links managed by signed-in file managers (mounted behind `authenticate`) */
exports.shareManageRouter = (0, express_1.Router)();
/** Anonymous read-only access through a link (mounted before `authenticate`) */
exports.sharePublicRouter = (0, express_1.Router)();
const mapLink = (r) => ({
    id: r.link_id,
    token: r.token,
    permission: r.permission,
    allowGuest: !!r.allow_guest,
    expiresAt: r.expires_at,
    isActive: !!r.is_active,
    createdAt: r.created_at,
    createdByName: r.created_by_name ?? null,
    accessCount: r.access_count,
    lastUsedAt: r.last_used_at,
    expired: !!r.expires_at && new Date(r.expires_at) < new Date(),
});
async function findLink(token) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token))
        throw (0, http_1.notFound)('ลิงก์ไม่ถูกต้อง');
    const l = await (0, db_1.q1)(`SELECT l.*, f.file_name, f.color, f.folder_id, f.created_by AS file_created_by
     FROM ShareLinks l JOIN Files f ON f.file_id = l.file_id
     WHERE l.token = @t AND f.is_deleted = 0`, { t: token });
    if (!l)
        throw (0, http_1.notFound)('ไม่พบลิงก์นี้ หรือไฟล์ถูกลบแล้ว');
    if (!l.is_active)
        throw new http_1.AppError(410, 'LINK_REVOKED', 'ลิงก์นี้ถูกยกเลิกแล้ว');
    if (l.expires_at && new Date(l.expires_at) < new Date())
        throw new http_1.AppError(410, 'LINK_EXPIRED', 'ลิงก์นี้หมดอายุแล้ว');
    return l;
}
/* ---------------- managers ---------------- */
exports.shareManageRouter.get('/files/:id/share-links', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    const rows = await (0, db_1.q)(`SELECT l.*, u.display_name AS created_by_name FROM ShareLinks l LEFT JOIN Users u ON u.user_id = l.created_by
       WHERE l.file_id = @f AND l.is_active = 1 ORDER BY l.created_at DESC`, { f: db_1.T.uuid(id) });
    (0, http_1.ok)(res, rows.map(mapLink));
}));
exports.shareManageRouter.post('/files/:id/share-links', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({
        permission: zod_1.z.enum(['read', 'write', 'manage']).default('read'),
        allowGuest: zod_1.z.boolean().default(true),
        expiresAt: zod_1.z.string().datetime({ offset: true }).nullish().or(zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullish(),
    }), req.body ?? {});
    const token = crypto_1.default.randomBytes(24).toString('base64url');
    const row = await (0, db_1.q1)(`INSERT INTO ShareLinks (file_id, token, permission, allow_guest, expires_at, created_by) OUTPUT inserted.*
       VALUES (@f, @t, @p, @g, @e, @u)`, { f: db_1.T.uuid(id), t: token, p: body.permission, g: db_1.T.bit(body.allowGuest), e: db_1.T.dt(body.expiresAt ?? null), u: db_1.T.uuid(req.user.id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'share_link_create', entityType: 'file', entityId: id, fileId: id, newValue: { ...body, name: file.file_name } }, req);
    (0, http_1.ok)(res, mapLink({ ...row, created_by_name: req.user.displayName }), 201);
}));
exports.shareManageRouter.put('/share-links/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const l = await (0, db_1.q1)(`SELECT * FROM ShareLinks WHERE link_id = @id`, { id: db_1.T.uuid(id) });
    if (!l)
        throw (0, http_1.notFound)('ไม่พบลิงก์');
    await (0, permissions_1.requireFile)(req.user, l.file_id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ permission: zod_1.z.enum(['read', 'write', 'manage']), allowGuest: zod_1.z.boolean() }), req.body);
    await (0, db_1.q)(`UPDATE ShareLinks SET permission = @p, allow_guest = @g WHERE link_id = @id`, { p: body.permission, g: db_1.T.bit(body.allowGuest), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'share_link_update', entityType: 'file', entityId: l.file_id, fileId: l.file_id, newValue: body }, req);
    (0, http_1.ok)(res, { updated: true });
}));
exports.shareManageRouter.delete('/share-links/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const l = await (0, db_1.q1)(`SELECT * FROM ShareLinks WHERE link_id = @id`, { id: db_1.T.uuid(id) });
    if (!l)
        throw (0, http_1.notFound)('ไม่พบลิงก์');
    await (0, permissions_1.requireFile)(req.user, l.file_id, permissions_1.LV.manage);
    await (0, db_1.q)(`UPDATE ShareLinks SET is_active = 0 WHERE link_id = @id`, { id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'share_link_revoke', entityType: 'file', entityId: l.file_id, fileId: l.file_id }, req);
    (0, http_1.ok)(res, { revoked: true });
}));
/** A signed-in user opens a link: they receive the permission it carries (never lowering an existing one). */
exports.shareManageRouter.post('/share/:token/redeem', (0, http_1.ah)(async (req, res) => {
    const l = await findLink(String(req.params.token));
    const ctx = await permissions_1.PermCtx.load(req.user);
    const before = ctx.fileLevel({ file_id: l.file_id, folder_id: l.folder_id, created_by: l.file_created_by });
    const want = (0, permissions_1.toLevel)(l.permission);
    let granted = false;
    if (want > before) {
        await (0, db_1.q)(`MERGE FileAccess AS t USING (SELECT @f AS file_id, @u AS user_id) AS s ON t.file_id = s.file_id AND t.user_id = s.user_id
         WHEN MATCHED THEN UPDATE SET permission = @p, granted_by = @by, granted_at = SYSUTCDATETIME(), expires_at = NULL
         WHEN NOT MATCHED THEN INSERT (file_id, user_id, permission, granted_by) VALUES (@f, @u, @p, @by);`, { f: db_1.T.uuid(l.file_id), u: db_1.T.uuid(req.user.id), p: l.permission, by: db_1.T.uuid(l.created_by) });
        granted = true;
        await (0, audit_1.audit)({ userId: req.user.id, action: 'share_link_redeem', entityType: 'file', entityId: l.file_id, fileId: l.file_id, newValue: { permission: l.permission } }, req);
    }
    await (0, db_1.q)(`UPDATE ShareLinks SET access_count = access_count + 1, last_used_at = SYSUTCDATETIME() WHERE link_id = @id`, { id: db_1.T.uuid(l.link_id) });
    (0, http_1.ok)(res, { fileId: l.file_id, permission: l.permission, granted });
}));
/* ---------------- public (no account) ---------------- */
async function guestLink(token) {
    const l = await findLink(token);
    if (!l.allow_guest)
        throw (0, http_1.forbidden)('ลิงก์นี้ต้องเข้าสู่ระบบก่อนจึงจะเปิดได้', 'LOGIN_REQUIRED');
    return l;
}
async function guestSheet(l, sheetId) {
    const s = await (0, db_1.q1)(`SELECT * FROM Sheets WHERE sheet_id = @s AND file_id = @f AND is_deleted = 0`, { s: db_1.T.uuid(sheetId), f: db_1.T.uuid(l.file_id) });
    if (!s)
        throw (0, http_1.notFound)('ไม่พบชีต');
    return s;
}
exports.sharePublicRouter.get('/public/share/:token', (0, http_1.ah)(async (req, res) => {
    const l = await findLink(String(req.params.token));
    const sheets = await (0, db_1.q)(`SELECT * FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: db_1.T.uuid(l.file_id) });
    await (0, db_1.q)(`UPDATE ShareLinks SET access_count = access_count + 1, last_used_at = SYSUTCDATETIME() WHERE link_id = @id`, { id: db_1.T.uuid(l.link_id) });
    (0, http_1.ok)(res, {
        file: { id: l.file_id, name: l.file_name, color: l.color },
        permission: l.permission,
        allowGuest: !!l.allow_guest,
        // A guest only receives content when the link allows it
        sheets: l.allow_guest ? sheets.map(mappers_1.mapSheet) : [],
    });
}));
exports.sharePublicRouter.get('/public/share/:token/sheets/:sheetId', (0, http_1.ah)(async (req, res) => {
    const l = await guestLink(String(req.params.token));
    const s = await guestSheet(l, http_1.zId.parse(req.params.sheetId));
    const cols = await (0, cellWriter_1.loadColumns)(s.sheet_id);
    (0, http_1.ok)(res, { sheet: (0, mappers_1.mapSheet)(s), columns: cols.filter((c) => !c.is_deleted).map(mappers_1.mapColumn) });
}));
exports.sharePublicRouter.post('/public/share/:token/sheets/:sheetId/rows', (0, http_1.ah)(async (req, res) => {
    const l = await guestLink(String(req.params.token));
    const s = await guestSheet(l, http_1.zId.parse(req.params.sheetId));
    const body = (0, http_1.parse)(zod_1.z.object({
        page: zod_1.z.number().int().min(1).default(1),
        pageSize: zod_1.z.number().int().min(1).max(200).default(100),
        sorts: zod_1.z.array(schemas_1.sortSchema).max(3).default([]),
        filters: zod_1.z.array(schemas_1.filterSchema).max(20).default([]),
        search: zod_1.z.string().max(200).optional(),
    }), req.body ?? {});
    const cols = await (0, cellWriter_1.loadColumns)(s.sheet_id);
    const r = await (0, rowQuery_1.queryRows)(s.sheet_id, cols, body);
    // Do not leak who edited what to anonymous visitors
    (0, http_1.ok)(res, { ...r, users: {}, rows: r.rows.map((row) => ({ ...row, meta: {}, createdBy: '', updatedBy: null })) });
}));
//# sourceMappingURL=share.js.map