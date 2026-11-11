import { Router } from 'express';
import { z } from 'zod';
import { jsonParam, idList, q, q1, T, withTx } from '../../config/db';
import { requireRole, ROLE_SQL } from '../../middleware/auth';
import { audit } from '../../shared/audit';
import { ah, badRequest, conflict, notFound, ok, parse, pid, zColor, zId } from '../../shared/http';
import { mapUser } from '../../shared/mappers';

/**
 * User tags: an admin or a master defines them and puts users in them (others ask with a tag request, ./requests.ts);
 * files, folders and news posts can be shared with a tag. The system tag "All" (is_system) is everyone: it has no UserTags
 * rows — read memberships through the view UserTagsAll — and cannot be renamed, deleted or given members.
 */
const router = Router();
const adminOnly = requireRole('admin');
const managers = requireRole('master', 'admin');

const mapTag = (r: any) => ({
  id: r.tag_id,
  name: r.tag_name,
  color: r.color,
  description: r.description ?? null,
  memberCount: Number(r.member_count ?? 0),
  isSystem: !!r.is_system,
  grantCount: r.grant_count === undefined ? undefined : Number(r.grant_count),
  createdAt: r.created_at,
});

const TAG_SQL = `SELECT t.tag_id, t.tag_name, t.color, t.description, t.created_at, t.is_system,
  (SELECT COUNT(*) FROM UserTagsAll ut JOIN Users u ON u.user_id = ut.user_id AND u.is_active = 1 WHERE ut.tag_id = t.tag_id) AS member_count,
  (SELECT COUNT(*) FROM FileTagAccess a WHERE a.tag_id = t.tag_id) + (SELECT COUNT(*) FROM FolderTagAccess a WHERE a.tag_id = t.tag_id) AS grant_count
  FROM Tags t`;

/** Every signed-in user: the share dialog lists tags to share with */
router.get('/tags', ah(async (_req, res) => ok(res, (await q(`${TAG_SQL} ORDER BY t.is_system DESC, t.tag_name`)).map(mapTag))));

/** My tags (with All) — "Tag ของฉัน" */
router.get('/tags/mine', ah(async (req, res) =>
  ok(res, (await q(`${TAG_SQL} WHERE t.tag_id IN (SELECT tag_id FROM UserTagsAll WHERE user_id = @u) ORDER BY t.is_system DESC, t.tag_name`, { u: T.uuid(req.user!.id) })).map(mapTag))));

/** The system tag (All) cannot be renamed, deleted or given members */
async function assertNotSystem(id: string, what: string) {
  const t = await q1(`SELECT is_system FROM Tags WHERE tag_id = @id`, { id: T.uuid(id) });
  if (!t) throw notFound('ไม่พบ Tag นี้');
  if (t.is_system) throw badRequest(`Tag All เป็น Tag ของระบบ (ทุกคนมีอยู่แล้ว) — ${what}ไม่ได้`);
}

const tagBody = z.object({
  name: z.string().trim().min(1, 'กรุณาตั้งชื่อ Tag').max(100),
  color: zColor.nullish(),
  description: z.string().trim().max(500).nullish(),
});

async function checkName(name: string, exceptId?: string) {
  const dup = await q1(`SELECT tag_id FROM Tags WHERE tag_name = @n ${exceptId ? 'AND tag_id <> @id' : ''}`, { n: name, id: T.uuid(exceptId ?? null) });
  if (dup) throw conflict(`มี Tag ชื่อ "${name}" อยู่แล้ว`);
}

router.post(
  '/tags',
  managers,
  ah(async (req, res) => {
    const b = parse(tagBody, req.body);
    await checkName(b.name);
    const row = await q1(
      `INSERT INTO Tags (tag_name, color, description, created_by) OUTPUT inserted.tag_id VALUES (@n, @c, @d, @by)`,
      { n: b.name, c: b.color ?? '#1552F0', d: T.text(b.description || null), by: T.uuid(req.user!.id) },
    );
    await audit({ userId: req.user!.id, action: 'tag_create', entityType: 'tag', entityId: row!.tag_id, newValue: b }, req);
    ok(res, mapTag((await q1(`${TAG_SQL} WHERE t.tag_id = @id`, { id: T.uuid(row!.tag_id) }))!), 201);
  }),
);

router.put(
  '/tags/:id',
  managers,
  ah(async (req, res) => {
    const id = pid(req);
    const b = parse(tagBody, req.body);
    const before = await q1(`SELECT tag_name, color, description, is_system FROM Tags WHERE tag_id = @id`, { id: T.uuid(id) });
    if (!before) throw notFound('ไม่พบ Tag นี้');
    if (before.is_system && b.name !== before.tag_name) throw badRequest('Tag All เป็น Tag ของระบบ — เปลี่ยนชื่อไม่ได้ (เปลี่ยนสี / คำอธิบายได้)');
    await checkName(b.name, id);
    await q(`UPDATE Tags SET tag_name = @n, color = @c, description = @d, updated_at = SYSUTCDATETIME() WHERE tag_id = @id`,
      { n: b.name, c: b.color ?? before.color, d: T.text(b.description || null), id: T.uuid(id) });
    await audit({ userId: req.user!.id, action: 'tag_update', entityType: 'tag', entityId: id, oldValue: before, newValue: b }, req);
    ok(res, mapTag((await q1(`${TAG_SQL} WHERE t.tag_id = @id`, { id: T.uuid(id) }))!));
  }),
);

/** Removes the tag from every user and every share made to it */
router.delete(
  '/tags/:id',
  adminOnly,
  ah(async (req, res) => {
    const id = pid(req);
    await assertNotSystem(id, 'ลบ');
    const before = await q1(`SELECT tag_name FROM Tags WHERE tag_id = @id`, { id: T.uuid(id) });
    if (!before) throw notFound('ไม่พบ Tag นี้');
    await q(`DELETE FROM Tags WHERE tag_id = @id`, { id: T.uuid(id) }); // UserTags / FileTagAccess / FolderTagAccess cascade
    await audit({ userId: req.user!.id, action: 'tag_delete', entityType: 'tag', entityId: id, oldValue: before }, req);
    ok(res, { deleted: true });
  }),
);

router.get(
  '/tags/:id/members',
  managers,
  ah(async (req, res) => {
    const rows = await q(
      `SELECT u.user_id, u.username, u.display_name, u.email, u.avatar_url, u.is_active, ${ROLE_SQL} AS role
       FROM UserTagsAll ut JOIN Users u ON u.user_id = ut.user_id WHERE ut.tag_id = @id ORDER BY u.display_name`,
      { id: T.uuid(pid(req)) },
    );
    ok(res, rows.map(mapUser));
  }),
);

router.post(
  '/tags/:id/members',
  managers,
  ah(async (req, res) => {
    const id = pid(req);
    const { userIds } = parse(z.object({ userIds: z.array(zId).min(1).max(500) }), req.body);
    await assertNotSystem(id, 'เพิ่มสมาชิก');
    await q(
      `INSERT INTO UserTags (user_id, tag_id, added_by)
       SELECT u.user_id, @t, @by FROM Users u
       WHERE u.user_id IN ${idList('@ids')} AND NOT EXISTS (SELECT 1 FROM UserTags x WHERE x.user_id = u.user_id AND x.tag_id = @t)`,
      { t: T.uuid(id), by: T.uuid(req.user!.id), ids: jsonParam(userIds) },
    );
    await audit({ userId: req.user!.id, action: 'tag_members_add', entityType: 'tag', entityId: id, newValue: { userIds } }, req);
    ok(res, { added: true });
  }),
);

router.delete(
  '/tags/:id/members/:userId',
  managers,
  ah(async (req, res) => {
    const id = pid(req);
    const userId = pid(req, 'userId');
    await assertNotSystem(id, 'นำสมาชิกออก');
    await q(`DELETE FROM UserTags WHERE tag_id = @t AND user_id = @u`, { t: T.uuid(id), u: T.uuid(userId) });
    await audit({ userId: req.user!.id, action: 'tag_members_remove', entityType: 'tag', entityId: id, oldValue: { userId } }, req);
    ok(res, { removed: true });
  }),
);

/** Replace a user's tags (user dialog on the users page) */
router.put(
  '/users/:id/tags',
  adminOnly,
  ah(async (req, res) => {
    const id = pid(req);
    const { tagIds } = parse(z.object({ tagIds: z.array(zId).max(200) }), req.body);
    if (!(await q1(`SELECT 1 AS x FROM Users WHERE user_id = @id`, { id: T.uuid(id) }))) throw notFound('ไม่พบผู้ใช้');
    await withTx(async (tx) => setUserTags(tx, id, tagIds, req.user!.id));
    await audit({ userId: req.user!.id, action: 'user_tags', entityType: 'user', entityId: id, newValue: { tagIds } }, req);
    ok(res, { tags: await tagsOfUsers([id]).then((m) => m.get(id.toLowerCase()) ?? []) });
  }),
);

export async function setUserTags(tx: any, userId: string, tagIds: string[], by: string) {
  await q(`DELETE FROM UserTags WHERE user_id = @u AND tag_id NOT IN ${idList('@ids')}`, { u: T.uuid(userId), ids: jsonParam(tagIds) }, tx);
  await q(
    `INSERT INTO UserTags (user_id, tag_id, added_by)
     SELECT @u, t.tag_id, @by FROM Tags t
     WHERE t.is_system = 0 AND t.tag_id IN ${idList('@ids')} AND NOT EXISTS (SELECT 1 FROM UserTags x WHERE x.user_id = @u AND x.tag_id = t.tag_id)`,
    { u: T.uuid(userId), by: T.uuid(by), ids: jsonParam(tagIds) },
    tx,
  );
}

/** userId (lower case) → its tags, for the users list */
export async function tagsOfUsers(ids: string[]) {
  const m = new Map<string, { id: string; name: string; color: string }[]>();
  if (!ids.length) return m;
  const rows = await q(
    `SELECT ut.user_id, t.tag_id, t.tag_name, t.color FROM UserTags ut JOIN Tags t ON t.tag_id = ut.tag_id AND t.is_system = 0
     WHERE ut.user_id IN ${idList('@ids')} ORDER BY t.tag_name`,
    { ids: jsonParam(ids) },
  );
  for (const r of rows) {
    const k = String(r.user_id).toLowerCase();
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push({ id: r.tag_id, name: r.tag_name, color: r.color });
  }
  return m;
}

export default router;
