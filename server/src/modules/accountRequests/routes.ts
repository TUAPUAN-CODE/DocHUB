import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, q1, T, withTx } from '../../config/db';
import { ADMIN_GRANTABLE, requireRole, Role, ROLE_ID } from '../../middleware/auth';
import { audit } from '../../shared/audit';
import { ah, badRequest, conflict, notFound, ok, parse, pid, zId } from '../../shared/http';
import { notify } from '../../shared/notify';
import { setUserTags } from '../tags/routes';
import { notifyAdmins, readSignupToken, uniqueUsername } from './service';

// root is never asked for nor given here (a root gives it on the users page)
const zRole = z.enum(ADMIN_GRANTABLE as [Role, ...Role[]]);
const ROLE_TH: Record<Role, string> = { viewer: 'Viewer (ดูอย่างเดียว)', user: 'User (กรอกข้อมูล)', master: 'Master', admin: 'Admin', root: 'Root' };
const PROVIDER_TH: Record<string, string> = { microsoft: 'Microsoft', google: 'Google' };

/* ---------------- public: ask for an account ---------------- */
export const publicRouter = Router();

const signupLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่' } },
});

/** Name / e-mail of the Microsoft / Google account that is asking (to fill the form) */
publicRouter.get('/signup/oauth', ah(async (req, res) => {
  const t = readSignupToken(String(req.query.token ?? ''));
  if (!t) throw badRequest('ลิงก์ขอสร้างบัญชีหมดอายุ กรุณาเข้าสู่ระบบด้วย Microsoft อีกครั้ง');
  ok(res, { provider: t.p, email: t.email, name: t.name });
}));

const signupSchema = z.object({
  displayName: z.string().trim().min(1, 'กรุณากรอกชื่อ-นามสกุล').max(200),
  // optional: some staff have no e-mail ('' = none)
  email: z.string().trim().toLowerCase().max(255).refine((v) => v === '' || z.string().email().safeParse(v).success, 'อีเมลไม่ถูกต้อง').optional(),
  username: z.string().trim().min(3, 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร').max(100).regex(/^[a-zA-Z0-9._-]+$/, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ -').optional(),
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(200).optional(),
  oauthToken: z.string().max(4000).optional(),
  requestedRole: zRole,
  note: z.string().trim().max(1000).optional(),
});

publicRouter.post(
  '/signup',
  signupLimiter,
  ah(async (req, res) => {
    const b = parse(signupSchema, req.body);
    const oauth = b.oauthToken ? readSignupToken(b.oauthToken) : null;
    if (b.oauthToken && !oauth) throw badRequest('ลิงก์ขอสร้างบัญชีหมดอายุ กรุณาเข้าสู่ระบบด้วย Microsoft อีกครั้ง');
    const email = (oauth?.email ?? b.email ?? '').toLowerCase() || null;
    if (!oauth && (!b.username || !b.password)) throw badRequest('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

    if (email && (await q1(`SELECT 1 AS x FROM Users WHERE email = @e`, { e: email })))
      throw conflict('อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ (ลืมรหัสผ่านติดต่อผู้ดูแลระบบ)');
    if (b.username && !oauth && (await q1(`SELECT 1 AS x FROM Users WHERE username = @u`, { u: b.username })))
      throw conflict('ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น');
    const pending = await q1(
      `SELECT TOP 1 request_id FROM AccountRequests WHERE status = 'pending'
       AND ((@e IS NOT NULL AND email = @e) ${b.username && !oauth ? 'OR username = @u' : ''} ${oauth ? 'OR (provider = @p AND provider_subject = @s)' : ''})`,
      { e: T.text(email), u: T.text(b.username ?? null), p: T.text(oauth?.p ?? null), s: T.text(oauth?.sub ?? null) },
    );
    if (pending) throw conflict('มีคำขอสร้างบัญชีนี้รอการอนุมัติอยู่แล้ว');

    const hash = oauth ? null : await bcrypt.hash(b.password!, 12);
    // User / Viewer: the account is made at once (no waiting for an admin); Master / Admin still need an admin's approval
    const auto = AUTO_ROLES.includes(b.requestedRole);
    const created = await withTx(async (tx) => {
      const row = await q1(
        `INSERT INTO AccountRequests (username, email, display_name, password_hash, provider, provider_subject, requested_role, note)
         OUTPUT inserted.request_id VALUES (@u, @e, @n, @h, @p, @s, @r, @note)`,
        {
          u: T.text(oauth ? null : b.username!), e: T.text(email), n: b.displayName, h: T.text(hash),
          p: T.text(oauth?.p ?? null), s: T.text(oauth?.sub ?? null), r: b.requestedRole, note: T.text(b.note || null),
        },
        tx,
      );
      return auto ? approveRequest(tx, row!.request_id, b.requestedRole, undefined, null, 'สร้างบัญชีอัตโนมัติตอนสมัคร (User / Viewer)', req) : null;
    });
    if (created) {
      await notifyAdmins('มีบัญชีใหม่', `${b.displayName} (${email ?? b.username ?? '-'}${oauth ? ` · ${PROVIDER_TH[oauth.p]}` : ''}) สมัครเป็น ${ROLE_TH[b.requestedRole]} — สร้างบัญชีให้อัตโนมัติแล้ว (เปลี่ยนระดับ / ปิดบัญชีได้ที่ จัดการผู้ใช้)`);
      return ok(res, { requested: true, created: true, via: oauth?.p ?? null }, 201);
    }
    await notifyAdmins('คำขอสร้างบัญชีใหม่', `${b.displayName} (${email ?? b.username ?? '-'}${oauth ? ` · ${PROVIDER_TH[oauth.p]}` : ''}) ขอบัญชีระดับ ${ROLE_TH[b.requestedRole]}`);
    ok(res, { requested: true, via: oauth?.p ?? null }, 201);
  }),
);

/**
 * Turns a pending request into an account (approve). `by` = the admin, or null when the account is made by itself at sign-up
 * (roles User / Viewer: no waiting). Runs inside the caller's transaction.
 */
async function approveRequest(tx: any, id: string, role: z.infer<typeof zRole>, tagIds: string[] | undefined, by: string | null, reviewNote: string | undefined, req: any): Promise<string> {
      const r = await q1(`SELECT * FROM AccountRequests WITH (UPDLOCK, ROWLOCK) WHERE request_id = @id`, { id: T.uuid(id) }, tx);
      if (!r) throw notFound('ไม่พบคำขอ');
      if (r.status !== 'pending') throw conflict('คำขอนี้ได้รับการพิจารณาไปแล้ว');
      if (r.email && (await q1(`SELECT 1 AS x FROM Users WHERE email = @e`, { e: r.email }, tx))) throw conflict(`อีเมล ${r.email} มีบัญชีอยู่แล้ว — ปฏิเสธคำขอนี้แทน`);
      let username: string = r.username;
      if (username && (await q1(`SELECT 1 AS x FROM Users WHERE username = @u`, { u: username }, tx))) throw conflict(`ชื่อผู้ใช้ ${username} ถูกใช้แล้ว — ปฏิเสธคำขอนี้แทน`);
      if (!username) username = await uniqueUsername(String(r.email).split('@')[0]);
      const hash = r.password_hash ?? (await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)); // Microsoft / Google: signs in there
      const u = await q1(
        `INSERT INTO Users (username, email, password_hash, display_name, created_by) OUTPUT inserted.user_id VALUES (@u, @e, @h, @n, @by)`,
        { u: username, e: T.text(r.email ?? null), h: hash, n: r.display_name, by: T.uuid(by) },
        tx,
      );
      const newId = u!.user_id as string;
      await q(`INSERT INTO UserRoles (user_id, role_id, assigned_by) VALUES (@u, @r, @by)`, { u: T.uuid(newId), r: ROLE_ID[role], by: T.uuid(by) }, tx);
      if (r.provider && r.provider_subject && !(await q1(`SELECT 1 AS x FROM OAuthIdentities WHERE provider = @p AND subject = @s`, { p: r.provider, s: r.provider_subject }, tx)))
        await q(`INSERT INTO OAuthIdentities (provider, subject, user_id, email) VALUES (@p, @s, @u, @e)`, { p: r.provider, s: r.provider_subject, u: T.uuid(newId), e: r.email }, tx);
      if (tagIds?.length) await setUserTags(tx, newId, tagIds, by ?? newId);
      await q(
        `UPDATE AccountRequests SET status = 'approved', granted_role = @g, user_id = @u, reviewed_by = @by, review_note = @n, reviewed_at = SYSUTCDATETIME(), password_hash = NULL
         WHERE request_id = @id`,
        { g: role, u: T.uuid(newId), by: T.uuid(by), n: T.text(reviewNote || null), id: T.uuid(id) },
        tx,
      );
      await audit({ userId: by ?? newId, action: 'user_create', entityType: 'user', entityId: newId,
        newValue: { username, role: role, requestedRole: r.requested_role, via: r.provider ?? 'signup', requestId: id } }, req, tx);
      return newId;
}

/** roles whose sign-up makes the account at once */
const AUTO_ROLES: string[] = ['user', 'viewer'];

/* ---------------- admin: review ---------------- */
const router = Router();
const adminOnly = requireRole('admin');

const mapRequest = (r: any) => ({
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

router.get('/account-requests', adminOnly, ah(async (req, res) => {
  const status = String(req.query.status ?? 'pending');
  const rows = await q(
    `SELECT TOP 300 ar.request_id, ar.username, ar.email, ar.display_name, ar.provider, ar.requested_role, ar.note, ar.status,
       ar.granted_role, ar.user_id, ar.review_note, ar.reviewed_at, ar.created_at, rv.display_name AS reviewer_name
     FROM AccountRequests ar LEFT JOIN Users rv ON rv.user_id = ar.reviewed_by
     ${['pending', 'approved', 'rejected'].includes(status) ? 'WHERE ar.status = @s' : ''}
     ORDER BY CASE WHEN ar.status = 'pending' THEN 0 ELSE 1 END, ar.created_at DESC`,
    { s: status },
  );
  ok(res, rows.map(mapRequest));
}));

router.get('/account-requests/pending-count', adminOnly, ah(async (_req, res) => {
  const r = await q1(`SELECT COUNT(*) AS n FROM AccountRequests WHERE status = 'pending'`);
  ok(res, { count: Number(r?.n ?? 0) });
}));

router.post(
  '/account-requests/:id/approve',
  adminOnly,
  ah(async (req, res) => {
    const id = pid(req);
    const b = parse(z.object({ role: zRole, tagIds: z.array(zId).max(200).optional(), reviewNote: z.string().trim().max(1000).optional() }), req.body);
    const userId = await withTx((tx) => approveRequest(tx, id, b.role, b.tagIds, req.user!.id, b.reviewNote, req));
    await notify([userId], { type: 'welcome', title: 'ยินดีต้อนรับสู่ DataSheet Pro', message: `บัญชีของคุณได้รับอนุมัติแล้ว ระดับ ${ROLE_TH[b.role]}`, link: '/' });
    ok(res, { approved: true, userId });
  }),
);

router.post(
  '/account-requests/:id/reject',
  adminOnly,
  ah(async (req, res) => {
    const id = pid(req);
    const { reviewNote } = parse(z.object({ reviewNote: z.string().trim().max(1000).optional() }), req.body);
    const r = await q(
      `UPDATE AccountRequests SET status = 'rejected', reviewed_by = @by, review_note = @n, reviewed_at = SYSUTCDATETIME(), password_hash = NULL
       OUTPUT inserted.email WHERE request_id = @id AND status = 'pending'`,
      { by: T.uuid(req.user!.id), n: T.text(reviewNote || null), id: T.uuid(id) },
    );
    if (!r.length) throw conflict('คำขอนี้ได้รับการพิจารณาไปแล้ว หรือไม่พบคำขอ');
    await audit({ userId: req.user!.id, action: 'account_request_reject', entityType: 'account_request', entityId: id, newValue: { email: r[0].email, reviewNote } }, req);
    ok(res, { rejected: true });
  }),
);

export default router;
