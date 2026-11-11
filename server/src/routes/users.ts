import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { jsonParam, q, q1, T, withTx, Tx, idList } from '../config/db';
import { AuthUser, invalidateUserCache, isAdminRole, requireRole, Role, ROLE_ID, ROLE_SQL, ROLES } from '../middleware/auth';
import { audit } from '../shared/audit';
import { ah, badRequest, conflict, forbidden, likeEscape, notFound, ok, pageParams, parse, pid, zId } from '../shared/http';
import { mapUser } from '../shared/mappers';
import { tagsOfUsers } from '../modules/tags/routes';

const router = Router();
/** e-mail is optional (some staff have none): '' → null */
const zEmail = z.string().trim().max(255).transform((v) => v.toLowerCase())
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'อีเมลไม่ถูกต้อง')
  .transform((v) => v || null);
/** sign-in name: editable by the user (profile) and by an admin (users page) */
const zUsername = z.string().trim().min(3, 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร').max(100).regex(/^[a-zA-Z0-9._-]+$/, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ -');
async function assertUsernameFree(username: string, exceptId: string) {
  const taken = await q1(
    `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM Users WHERE username = @u AND user_id <> @id)
       OR EXISTS (SELECT 1 FROM AccountRequests WHERE status = 'pending' AND username = @u)`,
    { u: username, id: T.uuid(exceptId) },
  );
  if (taken) throw conflict(`ชื่อผู้ใช้ "${username}" ถูกใช้แล้ว กรุณาเลือกชื่ออื่น`);
}
const adminOnly = requireRole('admin');
const zRole = z.enum(ROLES as [Role, ...Role[]]);

async function setRole(tx: Tx, userId: string, role: Role, by: string) {
  await q(`DELETE FROM UserRoles WHERE user_id = @u`, { u: T.uuid(userId) }, tx);
  await q(`INSERT INTO UserRoles (user_id, role_id, assigned_by) VALUES (@u, @r, @b)`,
    { u: T.uuid(userId), r: ROLE_ID[role], b: T.uuid(by) }, tx);
}

async function activeAdminCount(excludeIds: string[] = []) {
  const r = await q1(
    `SELECT COUNT(DISTINCT u.user_id) AS n FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id AND ur.role_id >= 3
     WHERE u.is_active = 1 AND u.user_id NOT IN ${idList('@ex')}`,
    { ex: jsonParam(excludeIds) },
  );
  return Number(r?.n ?? 0);
}

/** Root accounts and the root role are handled by a root only */
function assertCanGrant(actor: AuthUser, role: Role | undefined) {
  if (role === 'root' && actor.role !== 'root') throw forbidden('บทบาท Root ให้ได้เฉพาะผู้ใช้ Root เท่านั้น');
}
function assertCanManage(actor: AuthUser, targetRole: string | null | undefined) {
  if (targetRole === 'root' && actor.role !== 'root') throw forbidden('บัญชี Root แก้ไขได้เฉพาะผู้ใช้ Root เท่านั้น');
}

async function getUser(id: string) {
  return q1(`SELECT u.*, ${ROLE_SQL} AS role FROM Users u WHERE u.user_id = @id`, { id: T.uuid(id) });
}

/** Lightweight lookup for share dialogs — available to every signed-in user */
router.get(
  '/users/lookup',
  ah(async (req, res) => {
    const s = String(req.query.q ?? '').trim();
    const rows = await q(
      `SELECT TOP 20 u.user_id, u.username, u.display_name, u.email, u.avatar_url, ${ROLE_SQL} AS role
       FROM Users u WHERE u.is_active = 1
       ${s ? `AND (u.display_name LIKE @s OR u.username LIKE @s OR u.email LIKE @s)` : ''}
       ORDER BY u.display_name`,
      { s: `%${likeEscape(s)}%` },
    );
    ok(res, rows.map(mapUser));
  }),
);

router.put(
  '/users/me/profile',
  ah(async (req, res) => {
    const body = parse(
      z.object({
        displayName: z.string().trim().min(1).max(200),
        email: zEmail.nullish(),
        avatarUrl: z.string().max(1000).nullish(),
        username: zUsername.optional(),
      }),
      req.body,
    );
    if (body.username) await assertUsernameFree(body.username, req.user!.id);
    const email = body.email ?? null;
    if (email && (await q1(`SELECT user_id FROM Users WHERE email = @e AND user_id <> @id`, { e: email, id: T.uuid(req.user!.id) })))
      throw conflict('อีเมลนี้ถูกใช้งานแล้ว');
    await q(
      `UPDATE Users SET display_name = @n, email = @e, avatar_url = @a, username = COALESCE(@un, username), updated_at = SYSUTCDATETIME() WHERE user_id = @id`,
      { n: body.displayName, e: T.text(email), a: T.text(body.avatarUrl ?? null), un: T.text(body.username ?? null), id: T.uuid(req.user!.id) },
    );
    if (body.username && body.username !== req.user!.username)
      await audit({ userId: req.user!.id, action: 'user_update', entityType: 'user', entityId: req.user!.id, oldValue: { username: req.user!.username }, newValue: { username: body.username } }, req);
    invalidateUserCache(req.user!.id);
    ok(res, mapUser(await getUser(req.user!.id)));
  }),
);

router.get(
  '/users',
  adminOnly,
  ah(async (req, res) => {
    const { page, pageSize, offset } = pageParams(req.query, 20, 200);
    const s = String(req.query.search ?? '').trim();
    const role = String(req.query.role ?? '');
    const status = String(req.query.status ?? '');
    const where: string[] = ['1 = 1'];
    const p: Record<string, unknown> = {};
    if (s) {
      where.push('(u.display_name LIKE @s OR u.username LIKE @s OR u.email LIKE @s)');
      p.s = `%${likeEscape(s)}%`;
    }
    const tag = String(req.query.tag ?? '');
    if (/^[0-9a-f-]{36}$/i.test(tag)) {
      where.push('EXISTS (SELECT 1 FROM UserTagsAll ut WHERE ut.user_id = u.user_id AND ut.tag_id = @tag)'); // view: + the system tag All
      p.tag = T.uuid(tag);
    }
    if (status === 'active') where.push('u.is_active = 1');
    if (status === 'inactive') where.push('u.is_active = 0');
    const roleFilter = ROLES.includes(role as Role) ? `WHERE x.role = @role` : '';
    if (roleFilter) p.role = role;
    const base = `SELECT u.user_id, u.username, u.email, u.display_name, u.avatar_url, u.is_active, u.last_login_at,
                  u.created_at, ${ROLE_SQL} AS role FROM Users u WHERE ${where.join(' AND ')}`;
    const count = await q1(`SELECT COUNT(*) AS n FROM (${base}) x ${roleFilter}`, p);
    const rows = await q(
      `SELECT * FROM (${base}) x ${roleFilter} ORDER BY x.created_at DESC
       OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`,
      p,
    );
    const stats = await q1(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM Users`,
    );
    const tags = await tagsOfUsers(rows.map((r) => r.user_id));
    ok(res, {
      items: rows.map((r) => ({ ...mapUser(r), tags: tags.get(String(r.user_id).toLowerCase()) ?? [] })),
      total: Number(count?.n ?? 0),
      page,
      pageSize,
      stats: { total: Number(stats?.total ?? 0), active: Number(stats?.active ?? 0) },
    });
  }),
);

const createSchema = z.object({
  username: z.string().trim().min(3, 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร').max(100).regex(/^[a-zA-Z0-9._-]+$/, 'ใช้ได้เฉพาะ a-z 0-9 . _ -'),
  email: zEmail.nullish(),
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(200),
  role: zRole.default('user'),
});

router.post(
  '/users',
  adminOnly,
  ah(async (req, res) => {
    const body = parse(createSchema, req.body);
    assertCanGrant(req.user!, body.role);
    const dup = await q1(`SELECT username, email FROM Users WHERE username = @u OR (@e IS NOT NULL AND email = @e)`, { u: body.username, e: T.text(body.email ?? null) });
    if (dup) throw conflict(dup.username?.toLowerCase() === body.username.toLowerCase() ? 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' : 'อีเมลนี้ถูกใช้แล้ว');
    const hash = await bcrypt.hash(body.password, 12);
    const id = await withTx(async (tx) => {
      const row = await q1(
        `INSERT INTO Users (username, email, password_hash, display_name, created_by) OUTPUT inserted.user_id
         VALUES (@u, @e, @h, @n, @by)`,
        { u: body.username, e: T.text(body.email ?? null), h: hash, n: body.displayName, by: T.uuid(req.user!.id) },
        tx,
      );
      await setRole(tx, row!.user_id, body.role, req.user!.id);
      await audit({ userId: req.user!.id, action: 'user_create', entityType: 'user', entityId: row!.user_id,
        newValue: { username: body.username, role: body.role } }, req, tx);
      return row!.user_id as string;
    });
    ok(res, mapUser(await getUser(id)), 201);
  }),
);

router.put(
  '/users/:id',
  adminOnly,
  ah(async (req, res) => {
    const id = pid(req);
    const body = parse(
      z.object({
        email: zEmail.nullish(), // '' clears it
        username: zUsername.optional(),
        displayName: z.string().trim().min(1).max(200).optional(),
        role: zRole.optional(),
        isActive: z.boolean().optional(),
      }),
      req.body,
    );
    const before = await getUser(id);
    if (!before) throw notFound('ไม่พบผู้ใช้');
    assertCanManage(req.user!, before.role);
    assertCanGrant(req.user!, body.role);
    const self = id === req.user!.id;
    if (self && body.isActive === false) throw badRequest('ไม่สามารถปิดการใช้งานบัญชีของตัวเองได้');
    if (self && body.role && ROLE_ID[body.role] < ROLE_ID[before.role as Role]) throw badRequest('ไม่สามารถลดสิทธิ์ของตัวเองได้');
    const losingAdmin = isAdminRole(before.role) && ((body.role && !isAdminRole(body.role)) || body.isActive === false);
    if (losingAdmin && (await activeAdminCount([id])) === 0) throw badRequest('ระบบต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน');
    if (body.username) await assertUsernameFree(body.username, id);
    if (body.email) {
      const dup = await q1(`SELECT 1 AS x FROM Users WHERE email = @e AND user_id <> @id`, { e: body.email, id: T.uuid(id) });
      if (dup) throw conflict('อีเมลนี้ถูกใช้แล้ว');
    }
    await withTx(async (tx) => {
      await q(
        `UPDATE Users SET email = CASE WHEN @setE = 1 THEN @e ELSE email END, display_name = COALESCE(@n, display_name), username = COALESCE(@un, username),
           is_active = COALESCE(@a, is_active), updated_at = SYSUTCDATETIME() WHERE user_id = @id`,
        { setE: T.bit(body.email !== undefined), un: T.text(body.username ?? null), e: T.text(body.email ?? null), n: T.text(body.displayName ?? null), a: T.bit(body.isActive ?? null), id: T.uuid(id) },
        tx,
      );
      if (body.role && body.role !== before.role) await setRole(tx, id, body.role, req.user!.id);
      if (body.isActive === false) await q(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE user_id = @id AND revoked_at IS NULL`, { id: T.uuid(id) }, tx);
      await audit({ userId: req.user!.id, action: 'user_update', entityType: 'user', entityId: id,
        oldValue: { role: before.role, isActive: !!before.is_active, email: before.email, displayName: before.display_name, username: before.username },
        newValue: body }, req, tx);
    });
    invalidateUserCache(id);
    ok(res, mapUser(await getUser(id)));
  }),
);

router.post(
  '/users/:id/reset-password',
  adminOnly,
  ah(async (req, res) => {
    const id = pid(req);
    const { password } = parse(z.object({ password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(200) }), req.body);
    const u = await getUser(id);
    if (!u) throw notFound('ไม่พบผู้ใช้');
    assertCanManage(req.user!, u.role);
    await q(`UPDATE Users SET password_hash = @h, updated_at = SYSUTCDATETIME() WHERE user_id = @id`, { h: await bcrypt.hash(password, 12), id: T.uuid(id) });
    await q(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE user_id = @id AND revoked_at IS NULL`, { id: T.uuid(id) });
    await audit({ userId: req.user!.id, action: 'password_reset', entityType: 'user', entityId: id }, req);
    ok(res, { reset: true });
  }),
);

router.post(
  '/users/bulk',
  adminOnly,
  ah(async (req, res) => {
    const body = parse(
      z.object({ ids: z.array(zId).min(1).max(500), action: z.enum(['activate', 'deactivate', 'set_role']), role: zRole.optional() }),
      req.body,
    );
    const ids = body.ids.filter((i) => i !== req.user!.id);
    if (!ids.length) throw badRequest('ไม่สามารถเปลี่ยนแปลงบัญชีของตัวเองแบบกลุ่มได้');
    if (body.action === 'set_role' && !body.role) throw badRequest('กรุณาเลือกบทบาท');
    if (body.action === 'set_role') assertCanGrant(req.user!, body.role);
    if (req.user!.role !== 'root') {
      const roots = await q1(`SELECT COUNT(*) AS n FROM Users u WHERE u.user_id IN ${idList('@ids')} AND ${ROLE_SQL} = 'root'`, { ids: jsonParam(ids) });
      if (Number(roots?.n ?? 0) > 0) throw forbidden('รายการที่เลือกมีบัญชี Root ซึ่งแก้ไขได้เฉพาะผู้ใช้ Root เท่านั้น');
    }
    if ((body.action === 'deactivate' || (body.action === 'set_role' && !isAdminRole(body.role))) && (await activeAdminCount(ids)) === 0)
      throw badRequest('ระบบต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน');
    await withTx(async (tx) => {
      if (body.action === 'set_role') for (const id of ids) await setRole(tx, id, body.role!, req.user!.id);
      else {
        await q(`UPDATE Users SET is_active = @a, updated_at = SYSUTCDATETIME() WHERE user_id IN ${idList('@ids')}`,
          { a: body.action === 'activate', ids: jsonParam(ids) }, tx);
        if (body.action === 'deactivate')
          await q(`UPDATE RefreshTokens SET revoked_at = SYSUTCDATETIME() WHERE revoked_at IS NULL AND user_id IN ${idList('@ids')}`, { ids: jsonParam(ids) }, tx);
      }
      await audit({ userId: req.user!.id, action: 'user_bulk_update', entityType: 'user', entityId: 'bulk', newValue: { ...body, ids } }, req, tx);
    });
    ids.forEach((i) => invalidateUserCache(i));
    ok(res, { updated: ids.length });
  }),
);

export default router;
