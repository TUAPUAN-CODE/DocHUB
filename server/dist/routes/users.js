"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const routes_1 = require("../modules/tags/routes");
const router = (0, express_1.Router)();
const adminOnly = (0, auth_1.requireRole)('admin');
const zRole = zod_1.z.enum(auth_1.ROLES);
async function setRole(tx, userId, role, by) {
    await (0, db_1.q)(`DELETE FROM UserRoles WHERE user_id = @u`, { u: db_1.T.uuid(userId) }, tx);
    await (0, db_1.q)(`INSERT INTO UserRoles (user_id, role_id, assigned_by) VALUES (@u, @r, @b)`, { u: db_1.T.uuid(userId), r: auth_1.ROLE_ID[role], b: db_1.T.uuid(by) }, tx);
}
async function activeAdminCount(excludeIds = []) {
    const r = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id AND ur.role_id = 3
     WHERE u.is_active = 1 AND u.user_id NOT IN ${(0, db_1.idList)('@ex')}`, { ex: (0, db_1.jsonParam)(excludeIds) });
    return Number(r?.n ?? 0);
}
async function getUser(id) {
    return (0, db_1.q1)(`SELECT u.*, ${auth_1.ROLE_SQL} AS role FROM Users u WHERE u.user_id = @id`, { id: db_1.T.uuid(id) });
}
/** Lightweight lookup for share dialogs — available to every signed-in user */
router.get('/users/lookup', (0, http_1.ah)(async (req, res) => {
    const s = String(req.query.q ?? '').trim();
    const rows = await (0, db_1.q)(`SELECT TOP 20 u.user_id, u.username, u.display_name, u.email, u.avatar_url, ${auth_1.ROLE_SQL} AS role
       FROM Users u WHERE u.is_active = 1
       ${s ? `AND (u.display_name LIKE @s OR u.username LIKE @s OR u.email LIKE @s)` : ''}
       ORDER BY u.display_name`, { s: `%${(0, http_1.likeEscape)(s)}%` });
    (0, http_1.ok)(res, rows.map(mappers_1.mapUser));
}));
router.put('/users/me/profile', (0, http_1.ah)(async (req, res) => {
    const body = (0, http_1.parse)(zod_1.z.object({
        displayName: zod_1.z.string().trim().min(1).max(200),
        email: zod_1.z.string().trim().email('อีเมลไม่ถูกต้อง').max(255),
        avatarUrl: zod_1.z.string().max(1000).nullish(),
    }), req.body);
    const dup = await (0, db_1.q1)(`SELECT user_id FROM Users WHERE email = @e AND user_id <> @id`, { e: body.email, id: db_1.T.uuid(req.user.id) });
    if (dup)
        throw (0, http_1.conflict)('อีเมลนี้ถูกใช้งานแล้ว');
    await (0, db_1.q)(`UPDATE Users SET display_name = @n, email = @e, avatar_url = @a, updated_at = SYSUTCDATETIME() WHERE user_id = @id`, { n: body.displayName, e: body.email, a: db_1.T.text(body.avatarUrl ?? null), id: db_1.T.uuid(req.user.id) });
    (0, auth_1.invalidateUserCache)(req.user.id);
    (0, http_1.ok)(res, (0, mappers_1.mapUser)(await getUser(req.user.id)));
}));
router.get('/users', adminOnly, (0, http_1.ah)(async (req, res) => {
    const { page, pageSize, offset } = (0, http_1.pageParams)(req.query, 20, 200);
    const s = String(req.query.search ?? '').trim();
    const role = String(req.query.role ?? '');
    const status = String(req.query.status ?? '');
    const where = ['1 = 1'];
    const p = {};
    if (s) {
        where.push('(u.display_name LIKE @s OR u.username LIKE @s OR u.email LIKE @s)');
        p.s = `%${(0, http_1.likeEscape)(s)}%`;
    }
    const tag = String(req.query.tag ?? '');
    if (/^[0-9a-f-]{36}$/i.test(tag)) {
        where.push('EXISTS (SELECT 1 FROM UserTags ut WHERE ut.user_id = u.user_id AND ut.tag_id = @tag)');
        p.tag = db_1.T.uuid(tag);
    }
    if (status === 'active')
        where.push('u.is_active = 1');
    if (status === 'inactive')
        where.push('u.is_active = 0');
    const roleFilter = auth_1.ROLES.includes(role) ? `WHERE x.role = @role` : '';
    if (roleFilter)
        p.role = role;
    const base = `SELECT u.user_id, u.username, u.email, u.display_name, u.avatar_url, u.is_active, u.last_login_at,
                  u.created_at, ${auth_1.ROLE_SQL} AS role FROM Users u WHERE ${where.join(' AND ')}`;
    const count = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM (${base}) x ${roleFilter}`, p);
    const rows = await (0, db_1.q)(`SELECT * FROM (${base}) x ${roleFilter} ORDER BY x.created_at DESC
       OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`, p);
    const stats = await (0, db_1.q1)(`SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM Users`);
    const tags = await (0, routes_1.tagsOfUsers)(rows.map((r) => r.user_id));
    (0, http_1.ok)(res, {
        items: rows.map((r) => ({ ...(0, mappers_1.mapUser)(r), tags: tags.get(String(r.user_id).toLowerCase()) ?? [] })),
        total: Number(count?.n ?? 0),
        page,
        pageSize,
        stats: { total: Number(stats?.total ?? 0), active: Number(stats?.active ?? 0) },
    });
}));
const createSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(3, 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร').max(100).regex(/^[a-zA-Z0-9._-]+$/, 'ใช้ได้เฉพาะ a-z 0-9 . _ -'),
    email: zod_1.z.string().trim().email('อีเมลไม่ถูกต้อง').max(255),
    displayName: zod_1.z.string().trim().min(1).max(200),
    password: zod_1.z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(200),
    role: zRole.default('user'),
});
router.post('/users', adminOnly, (0, http_1.ah)(async (req, res) => {
    const body = (0, http_1.parse)(createSchema, req.body);
    const dup = await (0, db_1.q1)(`SELECT username, email FROM Users WHERE username = @u OR email = @e`, { u: body.username, e: body.email });
    if (dup)
        throw (0, http_1.conflict)(dup.username?.toLowerCase() === body.username.toLowerCase() ? 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' : 'อีเมลนี้ถูกใช้แล้ว');
    const hash = await bcryptjs_1.default.hash(body.password, 12);
    const id = await (0, db_1.withTx)(async (tx) => {
        const row = await (0, db_1.q1)(`INSERT INTO Users (username, email, password_hash, display_name, created_by) OUTPUT inserted.user_id
         VALUES (@u, @e, @h, @n, @by)`, { u: body.username, e: body.email, h: hash, n: body.displayName, by: db_1.T.uuid(req.user.id) }, tx);
        await setRole(tx, row.user_id, body.role, req.user.id);
        await (0, audit_1.audit)({ userId: req.user.id, action: 'user_create', entityType: 'user', entityId: row.user_id,
            newValue: { username: body.username, role: body.role } }, req, tx);
        return row.user_id;
    });
    (0, http_1.ok)(res, (0, mappers_1.mapUser)(await getUser(id)), 201);
}));
router.put('/users/:id', adminOnly, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const body = (0, http_1.parse)(zod_1.z.object({
        email: zod_1.z.string().trim().email().max(255).optional(),
        displayName: zod_1.z.string().trim().min(1).max(200).optional(),
        role: zRole.optional(),
        isActive: zod_1.z.boolean().optional(),
    }), req.body);
    const before = await getUser(id);
    if (!before)
        throw (0, http_1.notFound)('ไม่พบผู้ใช้');
    const self = id === req.user.id;
    if (self && body.isActive === false)
        throw (0, http_1.badRequest)('ไม่สามารถปิดการใช้งานบัญชีของตัวเองได้');
    if (self && body.role && body.role !== 'admin')
        throw (0, http_1.badRequest)('ไม่สามารถลดสิทธิ์ของตัวเองได้');
    const losingAdmin = before.role === 'admin' && ((body.role && body.role !== 'admin') || body.isActive === false);
    if (losingAdmin && (await activeAdminCount([id])) === 0)
        throw (0, http_1.badRequest)('ระบบต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน');
    if (body.email) {
        const dup = await (0, db_1.q1)(`SELECT 1 AS x FROM Users WHERE email = @e AND user_id <> @id`, { e: body.email, id: db_1.T.uuid(id) });
        if (dup)
            throw (0, http_1.conflict)('อีเมลนี้ถูกใช้แล้ว');
    }
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.q)(`UPDATE Users SET email = COALESCE(@e, email), display_name = COALESCE(@n, display_name),
           is_active = COALESCE(@a, is_active), updated_at = SYSUTCDATETIME() WHERE user_id = @id`, { e: db_1.T.text(body.email ?? null), n: db_1.T.text(body.displayName ?? null), a: db_1.T.bit(body.isActive ?? null), id: db_1.T.uuid(id) }, tx);
        if (body.role && body.role !== before.role)
            await setRole(tx, id, body.role, req.user.id);
        if (body.isActive === false)
            await (0, db_1.q)(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE user_id = @id AND revoked_at IS NULL`, { id: db_1.T.uuid(id) }, tx);
        await (0, audit_1.audit)({ userId: req.user.id, action: 'user_update', entityType: 'user', entityId: id,
            oldValue: { role: before.role, isActive: !!before.is_active, email: before.email, displayName: before.display_name },
            newValue: body }, req, tx);
    });
    (0, auth_1.invalidateUserCache)(id);
    (0, http_1.ok)(res, (0, mappers_1.mapUser)(await getUser(id)));
}));
router.post('/users/:id/reset-password', adminOnly, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { password } = (0, http_1.parse)(zod_1.z.object({ password: zod_1.z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(200) }), req.body);
    const u = await getUser(id);
    if (!u)
        throw (0, http_1.notFound)('ไม่พบผู้ใช้');
    await (0, db_1.q)(`UPDATE Users SET password_hash = @h, updated_at = SYSUTCDATETIME() WHERE user_id = @id`, { h: await bcryptjs_1.default.hash(password, 12), id: db_1.T.uuid(id) });
    await (0, db_1.q)(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE user_id = @id AND revoked_at IS NULL`, { id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'password_reset', entityType: 'user', entityId: id }, req);
    (0, http_1.ok)(res, { reset: true });
}));
router.post('/users/bulk', adminOnly, (0, http_1.ah)(async (req, res) => {
    const body = (0, http_1.parse)(zod_1.z.object({ ids: zod_1.z.array(http_1.zId).min(1).max(500), action: zod_1.z.enum(['activate', 'deactivate', 'set_role']), role: zRole.optional() }), req.body);
    const ids = body.ids.filter((i) => i !== req.user.id);
    if (!ids.length)
        throw (0, http_1.badRequest)('ไม่สามารถเปลี่ยนแปลงบัญชีของตัวเองแบบกลุ่มได้');
    if (body.action === 'set_role' && !body.role)
        throw (0, http_1.badRequest)('กรุณาเลือกบทบาท');
    if ((body.action === 'deactivate' || (body.action === 'set_role' && body.role !== 'admin')) && (await activeAdminCount(ids)) === 0)
        throw (0, http_1.badRequest)('ระบบต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน');
    await (0, db_1.withTx)(async (tx) => {
        if (body.action === 'set_role')
            for (const id of ids)
                await setRole(tx, id, body.role, req.user.id);
        else {
            await (0, db_1.q)(`UPDATE Users SET is_active = @a, updated_at = SYSUTCDATETIME() WHERE user_id IN ${(0, db_1.idList)('@ids')}`, { a: body.action === 'activate', ids: (0, db_1.jsonParam)(ids) }, tx);
            if (body.action === 'deactivate')
                await (0, db_1.q)(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE revoked_at IS NULL AND user_id IN ${(0, db_1.idList)('@ids')}`, { ids: (0, db_1.jsonParam)(ids) }, tx);
        }
        await (0, audit_1.audit)({ userId: req.user.id, action: 'user_bulk_update', entityType: 'user', entityId: 'bulk', newValue: { ...body, ids } }, req, tx);
    });
    ids.forEach((i) => (0, auth_1.invalidateUserCache)(i));
    (0, http_1.ok)(res, { updated: ids.length });
}));
exports.default = router;
//# sourceMappingURL=users.js.map