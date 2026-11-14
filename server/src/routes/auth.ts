import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, q1, T } from '../config/db';
import { env } from '../config/env';
import { authenticate, invalidateUserCache, loadAuthUser, ROLE_SQL, signAccessToken } from '../middleware/auth';
import { audit } from '../shared/audit';
import { ah, AppError, badRequest, isGuid, ok, parse } from '../shared/http';
import { mapUser } from '../shared/mappers';
import { pageLabels, pageOrder, pagesFor } from '../modules/pageAccess/module';

/** + the pages of the left bar (and features) the user's role sees */
const withPages = async <U extends { role: string }>(u: U) => ({ ...u, pages: await pagesFor(u.role as any), pageLabels: await pageLabels(), pageOrder: await pageOrder() });

const router = Router();
const COOKIE = 'dsp_rt';
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่' } },
});

export async function issueRefresh(res: Response, userId: string, ua?: string) {
  const secret = crypto.randomBytes(48).toString('hex');
  const expires = new Date(Date.now() + env.jwt.refreshDays * 86400_000);
  const row = await q1(
    `INSERT INTO RefreshTokens (user_id, token_hash, user_agent, expires_at) OUTPUT inserted.token_id
     VALUES (@u, @h, @ua, @e)`,
    { u: T.uuid(userId), h: sha(secret), ua: T.text(ua?.slice(0, 500) ?? null), e: T.dt(expires) },
  );
  res.cookie(COOKIE, `${row!.token_id}.${secret}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    path: '/api/auth',
    expires,
  });
}

const clearCookie = (res: Response) => res.clearCookie(COOKIE, { path: '/api/auth' });

router.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const { username, password } = parse(
      z.object({ username: z.string().trim().min(1).max(255), password: z.string().min(1).max(200) }),
      req.body,
    );
    const u = await q1(
      `SELECT u.*, ${ROLE_SQL} AS role FROM Users u WHERE u.username = @n OR u.email = @n`,
      { n: username },
    );
    if (!u || !(await bcrypt.compare(password, u.password_hash)))
      throw new AppError(401, 'INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    if (!u.is_active) throw new AppError(403, 'INACTIVE', 'บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    await q(`UPDATE Users SET last_login_at = SYSUTCDATETIME() WHERE user_id = @id`, { id: T.uuid(u.user_id) });
    invalidateUserCache(u.user_id);
    const authUser = await loadAuthUser(u.user_id);
    await issueRefresh(res, u.user_id, req.headers['user-agent']);
    await audit({ userId: u.user_id, action: 'login', entityType: 'user', entityId: u.user_id }, req);
    ok(res, { accessToken: signAccessToken(authUser!), user: await withPages(mapUser(u)) });
  }),
);

router.post(
  '/refresh',
  ah(async (req, res) => {
    const raw: string | undefined = req.cookies?.[COOKIE];
    const [id, secret] = (raw ?? '').split('.');
    if (!isGuid(id) || !secret) {
      clearCookie(res);
      throw new AppError(401, 'NO_SESSION', 'กรุณาเข้าสู่ระบบ');
    }
    const t = await q1(`SELECT * FROM RefreshTokens WHERE token_id = @id`, { id: T.uuid(id) });
    // A token rotated less than 60 s ago is still accepted (parallel tabs / StrictMode double effects).
    const GRACE_MS = 60_000;
    const revokedAgo = t?.revoked_at ? Date.now() - new Date(t.revoked_at).getTime() : null;
    const valid =
      t && t.token_hash === sha(secret) && new Date(t.expires_at) > new Date() && (revokedAgo === null || revokedAgo < GRACE_MS);
    if (!valid) {
      // Reuse of a long-revoked token looks like theft → revoke every session of that user
      if (t && revokedAgo !== null && revokedAgo >= GRACE_MS)
        await q(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE user_id = @u AND revoked_at IS NULL`, { u: T.uuid(t.user_id) });
      clearCookie(res);
      throw new AppError(401, 'NO_SESSION', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
    const user = await loadAuthUser(t.user_id);
    if (!user) {
      clearCookie(res);
      throw new AppError(401, 'INACTIVE', 'บัญชีนี้ไม่สามารถใช้งานได้');
    }
    await q(`UPDATE RefreshTokens SET revoked_at = COALESCE(revoked_at, SYSUTCDATETIME()) WHERE token_id = @id`, { id: T.uuid(id) });
    await issueRefresh(res, user.id, req.headers['user-agent']);
    const full = await q1(`SELECT u.*, ${ROLE_SQL} AS role FROM Users u WHERE u.user_id = @id`, { id: T.uuid(user.id) });
    ok(res, { accessToken: signAccessToken(user), user: await withPages(mapUser(full)) });
  }),
);

router.post(
  '/logout',
  ah(async (req, res) => {
    const raw: string | undefined = req.cookies?.[COOKIE];
    const [id] = (raw ?? '').split('.');
    if (isGuid(id)) await q(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE token_id = @id`, { id: T.uuid(id) });
    clearCookie(res);
    ok(res, { loggedOut: true });
  }),
);

router.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const u = await q1(`SELECT u.*, ${ROLE_SQL} AS role FROM Users u WHERE u.user_id = @id`, { id: T.uuid(req.user!.id) });
    ok(res, await withPages(mapUser(u)));
  }),
);

router.post(
  '/change-password',
  authenticate,
  ah(async (req, res) => {
    const { currentPassword, newPassword } = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(200) }),
      req.body,
    );
    const u = await q1(`SELECT password_hash FROM Users WHERE user_id = @id`, { id: T.uuid(req.user!.id) });
    if (!u || !(await bcrypt.compare(currentPassword, u.password_hash))) throw badRequest('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    const hash = await bcrypt.hash(newPassword, 12);
    await q(`UPDATE Users SET password_hash = @h, updated_at = SYSUTCDATETIME() WHERE user_id = @id`, { h: hash, id: T.uuid(req.user!.id) });
    await audit({ userId: req.user!.id, action: 'password_change', entityType: 'user', entityId: req.user!.id }, req);
    ok(res, { changed: true });
  }),
);

export default router;
