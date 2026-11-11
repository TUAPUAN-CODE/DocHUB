"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicRouter = void 0;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const notify_1 = require("../../shared/notify");
const routes_1 = require("../tags/routes");
const service_1 = require("./service");
// root is never asked for nor given here (a root gives it on the users page)
const zRole = zod_1.z.enum(auth_1.ADMIN_GRANTABLE);
const ROLE_TH = { viewer: 'Viewer (ดูอย่างเดียว)', user: 'User (กรอกข้อมูล)', master: 'Master', admin: 'Admin', root: 'Root' };
const PROVIDER_TH = { microsoft: 'Microsoft', google: 'Google' };
/* ---------------- public: ask for an account ---------------- */
exports.publicRouter = (0, express_1.Router)();
const signupLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMIT', message: 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่' } },
});
/** Name / e-mail of the Microsoft / Google account that is asking (to fill the form) */
exports.publicRouter.get('/signup/oauth', (0, http_1.ah)(async (req, res) => {
    const t = (0, service_1.readSignupToken)(String(req.query.token ?? ''));
    if (!t)
        throw (0, http_1.badRequest)('ลิงก์ขอสร้างบัญชีหมดอายุ กรุณาเข้าสู่ระบบด้วย Microsoft อีกครั้ง');
    (0, http_1.ok)(res, { provider: t.p, email: t.email, name: t.name });
}));
const signupSchema = zod_1.z.object({
    displayName: zod_1.z.string().trim().min(1, 'กรุณากรอกชื่อ-นามสกุล').max(200),
    // optional: some staff have no e-mail ('' = none)
    email: zod_1.z.string().trim().toLowerCase().max(255).refine((v) => v === '' || zod_1.z.string().email().safeParse(v).success, 'อีเมลไม่ถูกต้อง').optional(),
    username: zod_1.z.string().trim().min(3, 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร').max(100).regex(/^[a-zA-Z0-9._-]+$/, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ -').optional(),
    password: zod_1.z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(200).optional(),
    oauthToken: zod_1.z.string().max(4000).optional(),
    requestedRole: zRole,
    note: zod_1.z.string().trim().max(1000).optional(),
});
exports.publicRouter.post('/signup', signupLimiter, (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(signupSchema, req.body);
    const oauth = b.oauthToken ? (0, service_1.readSignupToken)(b.oauthToken) : null;
    if (b.oauthToken && !oauth)
        throw (0, http_1.badRequest)('ลิงก์ขอสร้างบัญชีหมดอายุ กรุณาเข้าสู่ระบบด้วย Microsoft อีกครั้ง');
    const email = (oauth?.email ?? b.email ?? '').toLowerCase() || null;
    if (!oauth && (!b.username || !b.password))
        throw (0, http_1.badRequest)('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    if (email && (await (0, db_1.q1)(`SELECT 1 AS x FROM Users WHERE email = @e`, { e: email })))
        throw (0, http_1.conflict)('อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ (ลืมรหัสผ่านติดต่อผู้ดูแลระบบ)');
    if (b.username && !oauth && (await (0, db_1.q1)(`SELECT 1 AS x FROM Users WHERE username = @u`, { u: b.username })))
        throw (0, http_1.conflict)('ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น');
    const pending = await (0, db_1.q1)(`SELECT TOP 1 request_id FROM AccountRequests WHERE status = 'pending'
       AND ((@e IS NOT NULL AND email = @e) ${b.username && !oauth ? 'OR username = @u' : ''} ${oauth ? 'OR (provider = @p AND provider_subject = @s)' : ''})`, { e: db_1.T.text(email), u: db_1.T.text(b.username ?? null), p: db_1.T.text(oauth?.p ?? null), s: db_1.T.text(oauth?.sub ?? null) });
    if (pending)
        throw (0, http_1.conflict)('มีคำขอสร้างบัญชีนี้รอการอนุมัติอยู่แล้ว');
    const hash = oauth ? null : await bcryptjs_1.default.hash(b.password, 12);
    await (0, db_1.q)(`INSERT INTO AccountRequests (username, email, display_name, password_hash, provider, provider_subject, requested_role, note)
       VALUES (@u, @e, @n, @h, @p, @s, @r, @note)`, {
        u: db_1.T.text(oauth ? null : b.username), e: db_1.T.text(email), n: b.displayName, h: db_1.T.text(hash),
        p: db_1.T.text(oauth?.p ?? null), s: db_1.T.text(oauth?.sub ?? null), r: b.requestedRole, note: db_1.T.text(b.note || null),
    });
    await (0, service_1.notifyAdmins)('คำขอสร้างบัญชีใหม่', `${b.displayName} (${email ?? b.username ?? '-'}${oauth ? ` · ${PROVIDER_TH[oauth.p]}` : ''}) ขอบัญชีระดับ ${ROLE_TH[b.requestedRole]}`);
    (0, http_1.ok)(res, { requested: true, via: oauth?.p ?? null }, 201);
}));
/* ---------------- admin: review ---------------- */
const router = (0, express_1.Router)();
const adminOnly = (0, auth_1.requireRole)('admin');
const mapRequest = (r) => ({
    id: r.request_id,
    username: r.username ?? null,
    email: r.email,
    displayName: r.display_name,
    provider: r.provider ?? null,
    requestedRole: r.requested_role,
    note: r.note ?? null,
    status: r.status,
    grantedRole: r.granted_role ?? null,
    userId: r.user_id ?? null,
    reviewerName: r.reviewer_name ?? null,
    reviewNote: r.review_note ?? null,
    reviewedAt: r.reviewed_at ?? null,
    createdAt: r.created_at,
});
router.get('/account-requests', adminOnly, (0, http_1.ah)(async (req, res) => {
    const status = String(req.query.status ?? 'pending');
    const rows = await (0, db_1.q)(`SELECT TOP 300 ar.request_id, ar.username, ar.email, ar.display_name, ar.provider, ar.requested_role, ar.note, ar.status,
       ar.granted_role, ar.user_id, ar.review_note, ar.reviewed_at, ar.created_at, rv.display_name AS reviewer_name
     FROM AccountRequests ar LEFT JOIN Users rv ON rv.user_id = ar.reviewed_by
     ${['pending', 'approved', 'rejected'].includes(status) ? 'WHERE ar.status = @s' : ''}
     ORDER BY CASE WHEN ar.status = 'pending' THEN 0 ELSE 1 END, ar.created_at DESC`, { s: status });
    (0, http_1.ok)(res, rows.map(mapRequest));
}));
router.get('/account-requests/pending-count', adminOnly, (0, http_1.ah)(async (_req, res) => {
    const r = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM AccountRequests WHERE status = 'pending'`);
    (0, http_1.ok)(res, { count: Number(r?.n ?? 0) });
}));
router.post('/account-requests/:id/approve', adminOnly, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const b = (0, http_1.parse)(zod_1.z.object({ role: zRole, tagIds: zod_1.z.array(http_1.zId).max(200).optional(), reviewNote: zod_1.z.string().trim().max(1000).optional() }), req.body);
    const userId = await (0, db_1.withTx)(async (tx) => {
        const r = await (0, db_1.q1)(`SELECT * FROM AccountRequests WITH (UPDLOCK, ROWLOCK) WHERE request_id = @id`, { id: db_1.T.uuid(id) }, tx);
        if (!r)
            throw (0, http_1.notFound)('ไม่พบคำขอ');
        if (r.status !== 'pending')
            throw (0, http_1.conflict)('คำขอนี้ได้รับการพิจารณาไปแล้ว');
        if (r.email && (await (0, db_1.q1)(`SELECT 1 AS x FROM Users WHERE email = @e`, { e: r.email }, tx)))
            throw (0, http_1.conflict)(`อีเมล ${r.email} มีบัญชีอยู่แล้ว — ปฏิเสธคำขอนี้แทน`);
        let username = r.username;
        if (username && (await (0, db_1.q1)(`SELECT 1 AS x FROM Users WHERE username = @u`, { u: username }, tx)))
            throw (0, http_1.conflict)(`ชื่อผู้ใช้ ${username} ถูกใช้แล้ว — ปฏิเสธคำขอนี้แทน`);
        if (!username)
            username = await (0, service_1.uniqueUsername)(String(r.email).split('@')[0]);
        const hash = r.password_hash ?? (await bcryptjs_1.default.hash(crypto_1.default.randomBytes(24).toString('hex'), 10)); // Microsoft / Google: signs in there
        const u = await (0, db_1.q1)(`INSERT INTO Users (username, email, password_hash, display_name, created_by) OUTPUT inserted.user_id VALUES (@u, @e, @h, @n, @by)`, { u: username, e: db_1.T.text(r.email ?? null), h: hash, n: r.display_name, by: db_1.T.uuid(req.user.id) }, tx);
        const newId = u.user_id;
        await (0, db_1.q)(`INSERT INTO UserRoles (user_id, role_id, assigned_by) VALUES (@u, @r, @by)`, { u: db_1.T.uuid(newId), r: auth_1.ROLE_ID[b.role], by: db_1.T.uuid(req.user.id) }, tx);
        if (r.provider && r.provider_subject && !(await (0, db_1.q1)(`SELECT 1 AS x FROM OAuthIdentities WHERE provider = @p AND subject = @s`, { p: r.provider, s: r.provider_subject }, tx)))
            await (0, db_1.q)(`INSERT INTO OAuthIdentities (provider, subject, user_id, email) VALUES (@p, @s, @u, @e)`, { p: r.provider, s: r.provider_subject, u: db_1.T.uuid(newId), e: r.email }, tx);
        if (b.tagIds?.length)
            await (0, routes_1.setUserTags)(tx, newId, b.tagIds, req.user.id);
        await (0, db_1.q)(`UPDATE AccountRequests SET status = 'approved', granted_role = @g, user_id = @u, reviewed_by = @by, review_note = @n, reviewed_at = SYSUTCDATETIME(), password_hash = NULL
         WHERE request_id = @id`, { g: b.role, u: db_1.T.uuid(newId), by: db_1.T.uuid(req.user.id), n: db_1.T.text(b.reviewNote || null), id: db_1.T.uuid(id) }, tx);
        await (0, audit_1.audit)({ userId: req.user.id, action: 'user_create', entityType: 'user', entityId: newId,
            newValue: { username, role: b.role, requestedRole: r.requested_role, via: r.provider ?? 'signup', requestId: id } }, req, tx);
        return newId;
    });
    await (0, notify_1.notify)([userId], { type: 'welcome', title: 'ยินดีต้อนรับสู่ DataSheet Pro', message: `บัญชีของคุณได้รับอนุมัติแล้ว ระดับ ${ROLE_TH[b.role]}`, link: '/' });
    (0, http_1.ok)(res, { approved: true, userId });
}));
router.post('/account-requests/:id/reject', adminOnly, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { reviewNote } = (0, http_1.parse)(zod_1.z.object({ reviewNote: zod_1.z.string().trim().max(1000).optional() }), req.body);
    const r = await (0, db_1.q)(`UPDATE AccountRequests SET status = 'rejected', reviewed_by = @by, review_note = @n, reviewed_at = SYSUTCDATETIME(), password_hash = NULL
       OUTPUT inserted.email WHERE request_id = @id AND status = 'pending'`, { by: db_1.T.uuid(req.user.id), n: db_1.T.text(reviewNote || null), id: db_1.T.uuid(id) });
    if (!r.length)
        throw (0, http_1.conflict)('คำขอนี้ได้รับการพิจารณาไปแล้ว หรือไม่พบคำขอ');
    await (0, audit_1.audit)({ userId: req.user.id, action: 'account_request_reject', entityType: 'account_request', entityId: id, newValue: { email: r[0].email, reviewNote } }, req);
    (0, http_1.ok)(res, { rejected: true });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map