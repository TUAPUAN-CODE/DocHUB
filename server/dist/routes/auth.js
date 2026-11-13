"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueRefresh = issueRefresh;
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const zod_1 = require("zod");
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const auth_1 = require("../middleware/auth");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const module_1 = require("../modules/pageAccess/module");
/** + the pages of the left bar (and features) the user's role sees */
const withPages = async (u) => ({ ...u, pages: await (0, module_1.pagesFor)(u.role), pageLabels: await (0, module_1.pageLabels)() });
const router = (0, express_1.Router)();
const COOKIE = 'dsp_rt';
const sha = (s) => crypto_1.default.createHash('sha256').update(s).digest('hex');
const loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMIT', message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่' } },
});
async function issueRefresh(res, userId, ua) {
    const secret = crypto_1.default.randomBytes(48).toString('hex');
    const expires = new Date(Date.now() + env_1.env.jwt.refreshDays * 86400_000);
    const row = await (0, db_1.q1)(`INSERT INTO RefreshTokens (user_id, token_hash, user_agent, expires_at) OUTPUT inserted.token_id
     VALUES (@u, @h, @ua, @e)`, { u: db_1.T.uuid(userId), h: sha(secret), ua: db_1.T.text(ua?.slice(0, 500) ?? null), e: db_1.T.dt(expires) });
    res.cookie(COOKIE, `${row.token_id}.${secret}`, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env_1.env.cookieSecure,
        path: '/api/auth',
        expires,
    });
}
const clearCookie = (res) => res.clearCookie(COOKIE, { path: '/api/auth' });
router.post('/login', loginLimiter, (0, http_1.ah)(async (req, res) => {
    const { username, password } = (0, http_1.parse)(zod_1.z.object({ username: zod_1.z.string().trim().min(1).max(255), password: zod_1.z.string().min(1).max(200) }), req.body);
    const u = await (0, db_1.q1)(`SELECT u.*, ${auth_1.ROLE_SQL} AS role FROM Users u WHERE u.username = @n OR u.email = @n`, { n: username });
    if (!u || !(await bcryptjs_1.default.compare(password, u.password_hash)))
        throw new http_1.AppError(401, 'INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    if (!u.is_active)
        throw new http_1.AppError(403, 'INACTIVE', 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    await (0, db_1.q)(`UPDATE Users SET last_login_at = SYSUTCDATETIME() WHERE user_id = @id`, { id: db_1.T.uuid(u.user_id) });
    (0, auth_1.invalidateUserCache)(u.user_id);
    const authUser = await (0, auth_1.loadAuthUser)(u.user_id);
    await issueRefresh(res, u.user_id, req.headers['user-agent']);
    await (0, audit_1.audit)({ userId: u.user_id, action: 'login', entityType: 'user', entityId: u.user_id }, req);
    (0, http_1.ok)(res, { accessToken: (0, auth_1.signAccessToken)(authUser), user: await withPages((0, mappers_1.mapUser)(u)) });
}));
router.post('/refresh', (0, http_1.ah)(async (req, res) => {
    const raw = req.cookies?.[COOKIE];
    const [id, secret] = (raw ?? '').split('.');
    if (!(0, http_1.isGuid)(id) || !secret) {
        clearCookie(res);
        throw new http_1.AppError(401, 'NO_SESSION', 'กรุณาเข้าสู่ระบบ');
    }
    const t = await (0, db_1.q1)(`SELECT * FROM RefreshTokens WHERE token_id = @id`, { id: db_1.T.uuid(id) });
    // A token rotated less than 60 s ago is still accepted (parallel tabs / StrictMode double effects).
    const GRACE_MS = 60_000;
    const revokedAgo = t?.revoked_at ? Date.now() - new Date(t.revoked_at).getTime() : null;
    const valid = t && t.token_hash === sha(secret) && new Date(t.expires_at) > new Date() && (revokedAgo === null || revokedAgo < GRACE_MS);
    if (!valid) {
        // Reuse of a long-revoked token looks like theft → revoke every session of that user
        if (t && revokedAgo !== null && revokedAgo >= GRACE_MS)
            await (0, db_1.q)(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE user_id = @u AND revoked_at IS NULL`, { u: db_1.T.uuid(t.user_id) });
        clearCookie(res);
        throw new http_1.AppError(401, 'NO_SESSION', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
    const user = await (0, auth_1.loadAuthUser)(t.user_id);
    if (!user) {
        clearCookie(res);
        throw new http_1.AppError(401, 'INACTIVE', 'บัญชีนี้ไม่สามารถใช้งานได้');
    }
    await (0, db_1.q)(`UPDATE RefreshTokens SET revoked_at = COALESCE(revoked_at, SYSUTCDATETIME()) WHERE token_id = @id`, { id: db_1.T.uuid(id) });
    await issueRefresh(res, user.id, req.headers['user-agent']);
    const full = await (0, db_1.q1)(`SELECT u.*, ${auth_1.ROLE_SQL} AS role FROM Users u WHERE u.user_id = @id`, { id: db_1.T.uuid(user.id) });
    (0, http_1.ok)(res, { accessToken: (0, auth_1.signAccessToken)(user), user: await withPages((0, mappers_1.mapUser)(full)) });
}));
router.post('/logout', (0, http_1.ah)(async (req, res) => {
    const raw = req.cookies?.[COOKIE];
    const [id] = (raw ?? '').split('.');
    if ((0, http_1.isGuid)(id))
        await (0, db_1.q)(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE token_id = @id`, { id: db_1.T.uuid(id) });
    clearCookie(res);
    (0, http_1.ok)(res, { loggedOut: true });
}));
router.get('/me', auth_1.authenticate, (0, http_1.ah)(async (req, res) => {
    const u = await (0, db_1.q1)(`SELECT u.*, ${auth_1.ROLE_SQL} AS role FROM Users u WHERE u.user_id = @id`, { id: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, await withPages((0, mappers_1.mapUser)(u)));
}));
router.post('/change-password', auth_1.authenticate, (0, http_1.ah)(async (req, res) => {
    const { currentPassword, newPassword } = (0, http_1.parse)(zod_1.z.object({ currentPassword: zod_1.z.string().min(1), newPassword: zod_1.z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(200) }), req.body);
    const u = await (0, db_1.q1)(`SELECT password_hash FROM Users WHERE user_id = @id`, { id: db_1.T.uuid(req.user.id) });
    if (!u || !(await bcryptjs_1.default.compare(currentPassword, u.password_hash)))
        throw (0, http_1.badRequest)('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    const hash = await bcryptjs_1.default.hash(newPassword, 12);
    await (0, db_1.q)(`UPDATE Users SET password_hash = @h, updated_at = SYSUTCDATETIME() WHERE user_id = @id`, { h: hash, id: db_1.T.uuid(req.user.id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'password_change', entityType: 'user', entityId: req.user.id }, req);
    (0, http_1.ok)(res, { changed: true });
}));
exports.default = router;
//# sourceMappingURL=auth.js.map