import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { q, q1, T, withTx } from '../config/db';
import { env } from '../config/env';
import { invalidateUserCache, ROLE_ID } from '../middleware/auth';
import { audit } from '../shared/audit';
import { ah, ok } from '../shared/http';
import { logger } from '../shared/logger';
import { issueRefresh } from './auth';
import { pendingForIdentity, signSignupToken, uniqueUsername } from '../modules/accountRequests/service';

/** "Sign in with Google / Microsoft" (OpenID Connect authorization-code flow) */
const router = Router();
type Provider = 'google' | 'microsoft';
const STATE_COOKIE = 'dsp_oauth';

const cfg = (p: Provider) => {
  if (p === 'google')
    return {
      ...env.oauth.google,
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
    };
  const t = encodeURIComponent(env.oauth.microsoft.tenant);
  return {
    ...env.oauth.microsoft,
    authorize: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
    token: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
    scope: 'openid email profile',
  };
};
const enabled = (p: Provider) => !!cfg(p).clientId && !!cfg(p).clientSecret;
const isProvider = (v: string): v is Provider => v === 'google' || v === 'microsoft';

function baseUrl(req: Request) {
  if (env.publicUrl) return env.publicUrl;
  return `${req.protocol}://${req.get('host')}`;
}
const redirectUri = (req: Request, p: Provider) => `${baseUrl(req)}/api/auth/oauth/${p}/callback`;
/** Only same-site relative paths may be used as the post-login destination (no open redirect) */
const safeFrom = (v: unknown) => (typeof v === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(v) ? v : '/');
const fail = (res: Response, req: Request, msg: string, from = '/') =>
  res.redirect(`${baseUrl(req)}/login?oauth_error=${encodeURIComponent(msg)}${from !== '/' ? `&next=${encodeURIComponent(from)}` : ''}`);

router.get('/providers', (_req, res) => ok(res, { google: enabled('google'), microsoft: enabled('microsoft') }));

router.get('/oauth/:provider/start', (req, res) => {
  const p = String(req.params.provider);
  if (!isProvider(p) || !enabled(p)) return fail(res, req, 'ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วยบริการนี้');
  const c = cfg(p);
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const cookie = jwt.sign({ state, nonce, p, from: safeFrom(req.query.from) }, env.jwt.secret, { expiresIn: '10m' });
  res.cookie(STATE_COOKIE, cookie, { httpOnly: true, sameSite: 'lax', secure: env.cookieSecure, path: '/api/auth/oauth', maxAge: 10 * 60_000 });
  const u = new URL(c.authorize);
  u.search = new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri(req, p), response_type: 'code', scope: c.scope, state, nonce,
    ...(p === 'google' ? { prompt: 'select_account' } : { response_mode: 'query', prompt: 'select_account' }),
  }).toString();
  res.redirect(u.toString());
});

interface Claims { sub: string; email?: string; email_verified?: boolean | string; preferred_username?: string; name?: string; picture?: string; nonce?: string; aud?: string; exp?: number; iss?: string; tid?: string }

async function exchange(req: Request, p: Provider, code: string): Promise<Claims> {
  const c = cfg(p);
  const r = await fetch(c.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(req, p) }),
  });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok || !body.id_token) throw new Error(body.error_description || body.error || `token endpoint ${r.status}`);
  // The id_token comes straight from the provider's token endpoint over TLS, so the signature check is optional (OIDC Core 3.1.3.7).
  const claims = jwt.decode(body.id_token) as Claims | null;
  if (!claims?.sub) throw new Error('id_token ไม่ถูกต้อง');
  if (claims.aud !== c.clientId) throw new Error('id_token audience ไม่ตรงกัน');
  if (claims.exp && claims.exp * 1000 < Date.now()) throw new Error('id_token หมดอายุ');
  return claims;
}

router.get(
  '/oauth/:provider/callback',
  ah(async (req, res) => {
    const p = String(req.params.provider);
    if (!isProvider(p) || !enabled(p)) return fail(res, req, 'ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วยบริการนี้');
    res.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' });
    if (req.query.error) return fail(res, req, String(req.query.error_description || req.query.error).slice(0, 200));
    let st: { state: string; nonce: string; p: string; from: string };
    try {
      st = jwt.verify(String(req.cookies?.[STATE_COOKIE] ?? ''), env.jwt.secret) as any;
    } catch {
      return fail(res, req, 'เซสชันการเข้าสู่ระบบหมดอายุ กรุณาลองใหม่');
    }
    if (st.p !== p || st.state !== req.query.state || !req.query.code) return fail(res, req, 'ข้อมูลการยืนยันตัวตนไม่ถูกต้อง', st.from);

    let claims: Claims;
    try {
      claims = await exchange(req, p, String(req.query.code));
      if (claims.nonce !== st.nonce) throw new Error('nonce ไม่ตรงกัน');
    } catch (e: any) {
      logger.warn(`OAuth ${p} failed: ${e?.message}`);
      return fail(res, req, 'ยืนยันตัวตนกับผู้ให้บริการไม่สำเร็จ', st.from);
    }

    const email = (claims.email || claims.preferred_username || '').trim().toLowerCase();
    // Google states verification explicitly. For Microsoft the e-mail claim is only trustworthy in a single-tenant app.
    const specificTenant = !['common', 'organizations', 'consumers'].includes(env.oauth.microsoft.tenant.toLowerCase());
    const emailVerified = p === 'google' ? claims.email_verified === true || claims.email_verified === 'true' : specificTenant;
    const domain = email.split('@')[1] ?? '';
    if (env.oauth.allowedDomains.length && !env.oauth.allowedDomains.includes(domain)) return fail(res, req, `อีเมลโดเมน ${domain || '-'} ไม่ได้รับอนุญาต`);

    // 1) already linked  2) existing account with the same verified e-mail  3) optional auto-create
    let userId: string | null = (await q1(`SELECT user_id FROM OAuthIdentities WHERE provider = @p AND subject = @s`, { p, s: claims.sub }))?.user_id ?? null;
    if (!userId && email && emailVerified) {
      const u = await q1(`SELECT user_id FROM Users WHERE email = @e`, { e: email });
      if (u) {
        userId = u.user_id;
        await q(`INSERT INTO OAuthIdentities (provider, subject, user_id, email) VALUES (@p, @s, @u, @e)`, { p, s: claims.sub, u: T.uuid(userId), e: email });
      }
    }
    if (!userId && !(env.oauth.autoCreate && email && emailVerified)) {
      // no account yet → the sign-up form, filled with this account; an admin approves the request
      if (!email) return fail(res, req, 'บัญชีนี้ไม่มีอีเมล กรุณาขอสร้างบัญชีด้วยชื่อผู้ใช้และรหัสผ่าน', st.from);
      if (await pendingForIdentity(p, claims.sub)) return fail(res, req, 'คำขอสร้างบัญชีของคุณกำลังรอผู้ดูแลระบบอนุมัติ', st.from);
      const token = signSignupToken({ p, sub: claims.sub, email, name: (claims.name || email.split('@')[0]).slice(0, 200), from: st.from });
      return res.redirect(`${baseUrl(req)}/signup?oauth=${encodeURIComponent(token)}`);
    }
    if (!userId) {
      const username = await uniqueUsername(email.split('@')[0]);
      const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
      userId = await withTx(async (tx) => {
        const row = await q1(
          `INSERT INTO Users (username, email, password_hash, display_name, avatar_url) OUTPUT inserted.user_id VALUES (@u, @e, @h, @n, @a)`,
          { u: username, e: email, h: hash, n: (claims.name || username).slice(0, 200), a: T.text(claims.picture?.slice(0, 1000) ?? null) },
          tx,
        );
        await q(`INSERT INTO UserRoles (user_id, role_id) VALUES (@u, @r)`, { u: T.uuid(row!.user_id), r: ROLE_ID.user }, tx);
        await q(`INSERT INTO OAuthIdentities (provider, subject, user_id, email) VALUES (@p, @s, @u, @e)`, { p, s: claims.sub, u: T.uuid(row!.user_id), e: email }, tx);
        await audit({ userId: row!.user_id, action: 'user_create', entityType: 'user', entityId: row!.user_id, newValue: { via: p, email } }, req, tx);
        return row!.user_id as string;
      });
    }
    const user = await q1(`SELECT user_id, is_active FROM Users WHERE user_id = @id`, { id: T.uuid(userId) });
    if (!user?.is_active) return fail(res, req, 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ', st.from);
    await q(`UPDATE Users SET last_login_at = SYSUTCDATETIME() WHERE user_id = @id`, { id: T.uuid(userId) });
    invalidateUserCache(userId);
    await issueRefresh(res, userId, req.headers['user-agent']);
    await audit({ userId, action: 'login', entityType: 'user', entityId: userId, newValue: { via: p } }, req);
    res.redirect(`${baseUrl(req)}${st.from}`);
  }),
);

export default router;
