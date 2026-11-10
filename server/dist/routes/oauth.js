"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const auth_1 = require("../middleware/auth");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const logger_1 = require("../shared/logger");
const auth_2 = require("./auth");
const service_1 = require("../modules/accountRequests/service");
/** "Sign in with Google / Microsoft" (OpenID Connect authorization-code flow) */
const router = (0, express_1.Router)();
const STATE_COOKIE = 'dsp_oauth';
const cfg = (p) => {
    if (p === 'google')
        return {
            ...env_1.env.oauth.google,
            authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
            token: 'https://oauth2.googleapis.com/token',
            scope: 'openid email profile',
        };
    const t = encodeURIComponent(env_1.env.oauth.microsoft.tenant);
    return {
        ...env_1.env.oauth.microsoft,
        authorize: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
        token: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
        scope: 'openid email profile',
    };
};
const enabled = (p) => !!cfg(p).clientId && !!cfg(p).clientSecret;
const isProvider = (v) => v === 'google' || v === 'microsoft';
function baseUrl(req) {
    if (env_1.env.publicUrl)
        return env_1.env.publicUrl;
    return `${req.protocol}://${req.get('host')}`;
}
const redirectUri = (req, p) => `${baseUrl(req)}/api/auth/oauth/${p}/callback`;
/** Only same-site relative paths may be used as the post-login destination (no open redirect) */
const safeFrom = (v) => (typeof v === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(v) ? v : '/');
const fail = (res, req, msg, from = '/') => res.redirect(`${baseUrl(req)}/login?oauth_error=${encodeURIComponent(msg)}${from !== '/' ? `&next=${encodeURIComponent(from)}` : ''}`);
router.get('/providers', (_req, res) => (0, http_1.ok)(res, { google: enabled('google'), microsoft: enabled('microsoft') }));
router.get('/oauth/:provider/start', (req, res) => {
    const p = String(req.params.provider);
    if (!isProvider(p) || !enabled(p))
        return fail(res, req, 'ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วยบริการนี้');
    const c = cfg(p);
    const state = crypto_1.default.randomBytes(16).toString('hex');
    const nonce = crypto_1.default.randomBytes(16).toString('hex');
    const cookie = jsonwebtoken_1.default.sign({ state, nonce, p, from: safeFrom(req.query.from) }, env_1.env.jwt.secret, { expiresIn: '10m' });
    res.cookie(STATE_COOKIE, cookie, { httpOnly: true, sameSite: 'lax', secure: env_1.env.cookieSecure, path: '/api/auth/oauth', maxAge: 10 * 60_000 });
    const u = new URL(c.authorize);
    u.search = new URLSearchParams({
        client_id: c.clientId, redirect_uri: redirectUri(req, p), response_type: 'code', scope: c.scope, state, nonce,
        ...(p === 'google' ? { prompt: 'select_account' } : { response_mode: 'query', prompt: 'select_account' }),
    }).toString();
    res.redirect(u.toString());
});
async function exchange(req, p, code) {
    const c = cfg(p);
    const r = await fetch(c.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(req, p) }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.id_token)
        throw new Error(body.error_description || body.error || `token endpoint ${r.status}`);
    // The id_token comes straight from the provider's token endpoint over TLS, so the signature check is optional (OIDC Core 3.1.3.7).
    const claims = jsonwebtoken_1.default.decode(body.id_token);
    if (!claims?.sub)
        throw new Error('id_token ไม่ถูกต้อง');
    if (claims.aud !== c.clientId)
        throw new Error('id_token audience ไม่ตรงกัน');
    if (claims.exp && claims.exp * 1000 < Date.now())
        throw new Error('id_token หมดอายุ');
    return claims;
}
router.get('/oauth/:provider/callback', (0, http_1.ah)(async (req, res) => {
    const p = String(req.params.provider);
    if (!isProvider(p) || !enabled(p))
        return fail(res, req, 'ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วยบริการนี้');
    res.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' });
    if (req.query.error)
        return fail(res, req, String(req.query.error_description || req.query.error).slice(0, 200));
    let st;
    try {
        st = jsonwebtoken_1.default.verify(String(req.cookies?.[STATE_COOKIE] ?? ''), env_1.env.jwt.secret);
    }
    catch {
        return fail(res, req, 'เซสชันการเข้าสู่ระบบหมดอายุ กรุณาลองใหม่');
    }
    if (st.p !== p || st.state !== req.query.state || !req.query.code)
        return fail(res, req, 'ข้อมูลการยืนยันตัวตนไม่ถูกต้อง', st.from);
    let claims;
    try {
        claims = await exchange(req, p, String(req.query.code));
        if (claims.nonce !== st.nonce)
            throw new Error('nonce ไม่ตรงกัน');
    }
    catch (e) {
        logger_1.logger.warn(`OAuth ${p} failed: ${e?.message}`);
        return fail(res, req, 'ยืนยันตัวตนกับผู้ให้บริการไม่สำเร็จ', st.from);
    }
    const email = (claims.email || claims.preferred_username || '').trim().toLowerCase();
    // Google states verification explicitly. For Microsoft the e-mail claim is only trustworthy in a single-tenant app.
    const specificTenant = !['common', 'organizations', 'consumers'].includes(env_1.env.oauth.microsoft.tenant.toLowerCase());
    const emailVerified = p === 'google' ? claims.email_verified === true || claims.email_verified === 'true' : specificTenant;
    const domain = email.split('@')[1] ?? '';
    if (env_1.env.oauth.allowedDomains.length && !env_1.env.oauth.allowedDomains.includes(domain))
        return fail(res, req, `อีเมลโดเมน ${domain || '-'} ไม่ได้รับอนุญาต`);
    // 1) already linked  2) existing account with the same verified e-mail  3) optional auto-create
    let userId = (await (0, db_1.q1)(`SELECT user_id FROM OAuthIdentities WHERE provider = @p AND subject = @s`, { p, s: claims.sub }))?.user_id ?? null;
    if (!userId && email && emailVerified) {
        const u = await (0, db_1.q1)(`SELECT user_id FROM Users WHERE email = @e`, { e: email });
        if (u) {
            userId = u.user_id;
            await (0, db_1.q)(`INSERT INTO OAuthIdentities (provider, subject, user_id, email) VALUES (@p, @s, @u, @e)`, { p, s: claims.sub, u: db_1.T.uuid(userId), e: email });
        }
    }
    if (!userId && !(env_1.env.oauth.autoCreate && email && emailVerified)) {
        // no account yet → the sign-up form, filled with this account; an admin approves the request
        if (!email)
            return fail(res, req, 'บัญชีนี้ไม่มีอีเมล กรุณาขอสร้างบัญชีด้วยชื่อผู้ใช้และรหัสผ่าน', st.from);
        if (await (0, service_1.pendingForIdentity)(p, claims.sub))
            return fail(res, req, 'คำขอสร้างบัญชีของคุณกำลังรอผู้ดูแลระบบอนุมัติ', st.from);
        const token = (0, service_1.signSignupToken)({ p, sub: claims.sub, email, name: (claims.name || email.split('@')[0]).slice(0, 200), from: st.from });
        return res.redirect(`${baseUrl(req)}/signup?oauth=${encodeURIComponent(token)}`);
    }
    if (!userId) {
        const username = await (0, service_1.uniqueUsername)(email.split('@')[0]);
        const hash = await bcryptjs_1.default.hash(crypto_1.default.randomBytes(24).toString('hex'), 10);
        userId = await (0, db_1.withTx)(async (tx) => {
            const row = await (0, db_1.q1)(`INSERT INTO Users (username, email, password_hash, display_name, avatar_url) OUTPUT inserted.user_id VALUES (@u, @e, @h, @n, @a)`, { u: username, e: email, h: hash, n: (claims.name || username).slice(0, 200), a: db_1.T.text(claims.picture?.slice(0, 1000) ?? null) }, tx);
            await (0, db_1.q)(`INSERT INTO UserRoles (user_id, role_id) VALUES (@u, @r)`, { u: db_1.T.uuid(row.user_id), r: auth_1.ROLE_ID.user }, tx);
            await (0, db_1.q)(`INSERT INTO OAuthIdentities (provider, subject, user_id, email) VALUES (@p, @s, @u, @e)`, { p, s: claims.sub, u: db_1.T.uuid(row.user_id), e: email }, tx);
            await (0, audit_1.audit)({ userId: row.user_id, action: 'user_create', entityType: 'user', entityId: row.user_id, newValue: { via: p, email } }, req, tx);
            return row.user_id;
        });
    }
    const user = await (0, db_1.q1)(`SELECT user_id, is_active FROM Users WHERE user_id = @id`, { id: db_1.T.uuid(userId) });
    if (!user?.is_active)
        return fail(res, req, 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', st.from);
    await (0, db_1.q)(`UPDATE Users SET last_login_at = SYSUTCDATETIME() WHERE user_id = @id`, { id: db_1.T.uuid(userId) });
    (0, auth_1.invalidateUserCache)(userId);
    await (0, auth_2.issueRefresh)(res, userId, req.headers['user-agent']);
    await (0, audit_1.audit)({ userId, action: 'login', entityType: 'user', entityId: userId, newValue: { via: p } }, req);
    res.redirect(`${baseUrl(req)}${st.from}`);
}));
exports.default = router;
//# sourceMappingURL=oauth.js.map