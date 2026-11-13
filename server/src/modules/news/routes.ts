import { Router } from 'express';
import { z } from 'zod';
import { idList, jsonParam, q, q1, T, withTx } from '../../config/db';
import { AuthUser, isAdminRole, ROLE_ID, ROLE_SQL } from '../../middleware/auth';
import { emitToAll } from '../../socket';
import { audit } from '../../shared/audit';
import { ah, badRequest, forbidden, likeEscape, notFound, ok, pageParams, parse, pid, safeJson, zId } from '../../shared/http';
import { notify } from '../../shared/notify';
import { requirePage } from '../pageAccess/service';

/**
 * News board ("ข่าวสาร"): posts with tags. A post is seen by the users having one of its tags (system tag All = everyone),
 * by its author and by admins. Viewers read only; pinning is for master and up.
 */
const router = Router();
router.use('/news', requirePage('news'));

const canPin = (u: AuthUser) => ROLE_ID[u.role] >= ROLE_ID.master;

/** posts the user may see (alias p = NewsPosts) */
const VISIBLE = `p.is_deleted = 0 AND (@admin = 1 OR p.created_by = @me OR EXISTS (
  SELECT 1 FROM NewsPostTags pt JOIN UserTagsAll ut ON ut.tag_id = pt.tag_id WHERE pt.post_id = p.post_id AND ut.user_id = @me))`;
const vis = (u: AuthUser) => ({ me: T.uuid(u.id), admin: isAdminRole(u.role) ? 1 : 0 });

const POST_SQL = `SELECT p.post_id, p.title, p.body, p.images_json, p.link_url, p.is_pinned, p.created_by, p.created_at, p.updated_at,
    a.display_name AS author_name, a.avatar_url AS author_avatar, ub.display_name AS updated_by_name,
    (SELECT ${ROLE_SQL.replace(/u\.user_id/g, 'a.user_id')}) AS author_role
  FROM NewsPosts p LEFT JOIN Users a ON a.user_id = p.created_by LEFT JOIN Users ub ON ub.user_id = p.updated_by`;

async function hydrate(rows: any[], u: AuthUser, lastSeen: Date | null) {
  const tags = new Map<string, { id: string; name: string; color: string; isSystem: boolean }[]>();
  if (rows.length) {
    const tr = await q(
      `SELECT pt.post_id, t.tag_id, t.tag_name, t.color, t.is_system FROM NewsPostTags pt JOIN Tags t ON t.tag_id = pt.tag_id
       WHERE pt.post_id IN ${idList('@ids')} ORDER BY t.is_system DESC, t.tag_name`,
      { ids: jsonParam(rows.map((r) => r.post_id)) },
    );
    for (const t of tr) {
      const k = String(t.post_id).toLowerCase();
      if (!tags.has(k)) tags.set(k, []);
      tags.get(k)!.push({ id: t.tag_id, name: t.tag_name, color: t.color, isSystem: !!t.is_system });
    }
  }
  return rows.map((r) => {
    const mine = String(r.created_by).toLowerCase() === u.id.toLowerCase();
    return {
      id: r.post_id,
      title: r.title,
      body: r.body,
      images: safeJson<string[]>(r.images_json, []),
      linkUrl: r.link_url ?? null,
      pinned: !!r.is_pinned,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name ?? null,
      author: { id: r.created_by, displayName: r.author_name ?? '-', avatarUrl: r.author_avatar ?? null, role: r.author_role ?? 'user' },
      tags: tags.get(String(r.post_id).toLowerCase()) ?? [],
      canEdit: mine || isAdminRole(u.role),
      isNew: !mine && (!lastSeen || new Date(r.created_at) > lastSeen),
    };
  });
}

const lastSeenOf = async (userId: string) =>
  ((await q1(`SELECT last_seen_at FROM NewsReads WHERE user_id = @u`, { u: T.uuid(userId) }))?.last_seen_at as Date | undefined) ?? null;

async function unreadCount(u: AuthUser) {
  const r = await q1(
    `SELECT COUNT(*) AS n FROM NewsPosts p
     WHERE ${VISIBLE} AND p.created_by <> @me
       AND p.created_at > COALESCE((SELECT last_seen_at FROM NewsReads WHERE user_id = @me), '1900-01-01')`,
    vis(u),
  );
  return Number(r?.n ?? 0);
}

router.get('/news', ah(async (req, res) => {
  const u = req.user!;
  const { page, pageSize, offset } = pageParams(req.query, 20, 50);
  const where = [VISIBLE];
  const p: Record<string, unknown> = vis(u);
  const text = String(req.query.q ?? '').trim().slice(0, 100);
  if (text) { where.push('(p.title LIKE @s OR p.body LIKE @s)'); p.s = `%${likeEscape(text)}%`; }
  const tag = String(req.query.tag ?? '');
  if (/^[0-9a-f-]{36}$/i.test(tag)) { where.push('EXISTS (SELECT 1 FROM NewsPostTags x WHERE x.post_id = p.post_id AND x.tag_id = @tag)'); p.tag = T.uuid(tag); }
  if (req.query.mine === '1') where.push('p.created_by = @me');
  const count = await q1(`SELECT COUNT(*) AS n FROM NewsPosts p WHERE ${where.join(' AND ')}`, p);
  const rows = await q(`${POST_SQL} WHERE ${where.join(' AND ')} ORDER BY p.is_pinned DESC, p.created_at DESC OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`, p);
  const lastSeen = await lastSeenOf(u.id);
  ok(res, { items: await hydrate(rows, u, lastSeen), total: Number(count?.n ?? 0), page, pageSize, canPin: canPin(u), canPost: u.role !== 'viewer' });
}));

router.get('/news/unread-count', ah(async (req, res) => ok(res, { count: await unreadCount(req.user!) })));

/** The board was opened: everything up to now is read */
router.post('/news/seen', ah(async (req, res) => {
  await q(
    `MERGE NewsReads AS t USING (SELECT @u AS user_id) s ON t.user_id = s.user_id
     WHEN MATCHED THEN UPDATE SET last_seen_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (user_id, last_seen_at) VALUES (@u, SYSUTCDATETIME());`,
    { u: T.uuid(req.user!.id) },
  );
  ok(res, { count: 0 });
}));

router.get('/news/:id', ah(async (req, res) => {
  const u = req.user!;
  const row = await q1(`${POST_SQL} WHERE p.post_id = @id AND ${VISIBLE.replace(/\bp\./g, 'p.')}`, { ...vis(u), id: T.uuid(pid(req)) });
  if (!row) throw notFound('ไม่พบข่าวนี้ หรือข่าวนี้ไม่ได้ส่งถึงคุณ');
  ok(res, (await hydrate([row], u, await lastSeenOf(u.id)))[0]);
}));

const zUpload = z.string().max(300).regex(/^\/uploads\/[A-Za-z0-9._-]+$/, 'รูปไม่ถูกต้อง');
const postBody = z.object({
  title: z.string().trim().min(1, 'กรุณาใส่หัวข้อ').max(200),
  body: z.string().trim().min(1, 'กรุณาพิมพ์รายละเอียด').max(20000),
  tagIds: z.array(zId).min(1, 'กรุณาเลือกอย่างน้อย 1 Tag (เลือก All = ทุกคนเห็น)').max(50),
  images: z.array(zUpload).max(10).default([]),
  linkUrl: z.string().trim().max(1000).regex(/^(https?:\/\/|\/)/i, 'ลิงก์ต้องขึ้นต้นด้วย http(s):// หรือ /').nullish().or(z.literal('')),
  pinned: z.boolean().default(false),
});

async function checkTags(ids: string[]) {
  const rows = await q(`SELECT tag_id, tag_name, is_system FROM Tags WHERE tag_id IN ${idList('@ids')}`, { ids: jsonParam(ids) });
  if (rows.length !== new Set(ids.map((i) => i.toLowerCase())).size) throw badRequest('มี Tag ที่ไม่พบในระบบ');
  return rows;
}

async function writeTags(tx: any, postId: string, tagIds: string[]) {
  await q(`DELETE FROM NewsPostTags WHERE post_id = @p`, { p: T.uuid(postId) }, tx);
  await q(`INSERT INTO NewsPostTags (post_id, tag_id) SELECT DISTINCT @p, TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids)`, { p: T.uuid(postId), ids: jsonParam(tagIds) }, tx);
}

/** members of the post's real tags (All is not notified one by one: everyone sees the unread badge) */
async function notifyTagged(postId: string, title: string, author: AuthUser, tags: any[]) {
  const ids = tags.filter((t) => !t.is_system).map((t) => t.tag_id);
  if (!ids.length) return;
  const users = await q(
    `SELECT DISTINCT ut.user_id FROM UserTags ut JOIN Users u ON u.user_id = ut.user_id AND u.is_active = 1 WHERE ut.tag_id IN ${idList('@ids')} AND ut.user_id <> @me`,
    { ids: jsonParam(ids), me: T.uuid(author.id) },
  );
  await notify(users.map((x) => x.user_id), {
    type: 'news',
    title: `ข่าวใหม่: ${title}`,
    message: `${author.displayName} โพสต์ถึง ${tags.map((t) => t.tag_name).join(', ')}`,
    link: `/news?post=${postId}`,
  });
}

router.post('/news', ah(async (req, res) => {
  const u = req.user!;
  if (u.role === 'viewer') throw forbidden('บทบาท Viewer อ่านข่าวได้อย่างเดียว');
  const b = parse(postBody, req.body);
  if (b.pinned && !canPin(u)) throw forbidden('ปักหมุดได้เฉพาะ Master ขึ้นไป');
  const tags = await checkTags(b.tagIds);
  const id = await withTx(async (tx) => {
    const row = await q1(
      `INSERT INTO NewsPosts (title, body, images_json, link_url, is_pinned, created_by) OUTPUT inserted.post_id VALUES (@t, @b, @i, @l, @p, @u)`,
      { t: b.title, b: T.text(b.body), i: T.text(JSON.stringify(b.images)), l: T.text(b.linkUrl || null), p: T.bit(b.pinned), u: T.uuid(u.id) },
      tx,
    );
    await writeTags(tx, row!.post_id, b.tagIds);
    await audit({ userId: u.id, action: 'news_create', entityType: 'news', entityId: row!.post_id, newValue: { title: b.title, tags: tags.map((t) => t.tag_name) } }, req, tx);
    return row!.post_id as string;
  });
  await notifyTagged(id, b.title, u, tags);
  emitToAll('news:changed', { id });
  const row = await q1(`${POST_SQL} WHERE p.post_id = @id`, { id: T.uuid(id) });
  ok(res, (await hydrate([row], u, await lastSeenOf(u.id)))[0], 201);
}));

async function ownPost(u: AuthUser, id: string) {
  const p = await q1(`SELECT post_id, created_by, is_pinned, title FROM NewsPosts WHERE post_id = @id AND is_deleted = 0`, { id: T.uuid(id) });
  if (!p) throw notFound('ไม่พบข่าวนี้');
  if (String(p.created_by).toLowerCase() !== u.id.toLowerCase() && !isAdminRole(u.role)) throw forbidden('แก้ไข / ลบได้เฉพาะผู้โพสต์หรือ Admin');
  return p;
}

router.put('/news/:id', ah(async (req, res) => {
  const u = req.user!;
  const id = pid(req);
  const before = await ownPost(u, id);
  const b = parse(postBody, req.body);
  if (b.pinned !== !!before.is_pinned && !canPin(u)) throw forbidden('ปักหมุดได้เฉพาะ Master ขึ้นไป');
  const tags = await checkTags(b.tagIds);
  await withTx(async (tx) => {
    await q(
      `UPDATE NewsPosts SET title = @t, body = @b, images_json = @i, link_url = @l, is_pinned = @p, updated_by = @u, updated_at = SYSUTCDATETIME() WHERE post_id = @id`,
      { t: b.title, b: T.text(b.body), i: T.text(JSON.stringify(b.images)), l: T.text(b.linkUrl || null), p: T.bit(b.pinned), u: T.uuid(u.id), id: T.uuid(id) },
      tx,
    );
    await writeTags(tx, id, b.tagIds);
    await audit({ userId: u.id, action: 'news_update', entityType: 'news', entityId: id, oldValue: { title: before.title }, newValue: { title: b.title, tags: tags.map((t) => t.tag_name) } }, req, tx);
  });
  emitToAll('news:changed', { id });
  const row = await q1(`${POST_SQL} WHERE p.post_id = @id`, { id: T.uuid(id) });
  ok(res, (await hydrate([row], u, await lastSeenOf(u.id)))[0]);
}));

/** Pin / unpin only (master and up) */
router.post('/news/:id/pin', ah(async (req, res) => {
  const u = req.user!;
  if (!canPin(u)) throw forbidden('ปักหมุดได้เฉพาะ Master ขึ้นไป');
  const { pinned } = parse(z.object({ pinned: z.boolean() }), req.body);
  const id = pid(req);
  const r = await q1(`UPDATE NewsPosts SET is_pinned = @p OUTPUT inserted.post_id WHERE post_id = @id AND is_deleted = 0`, { p: T.bit(pinned), id: T.uuid(id) });
  if (!r) throw notFound('ไม่พบข่าวนี้');
  await audit({ userId: u.id, action: pinned ? 'news_pin' : 'news_unpin', entityType: 'news', entityId: id }, req);
  emitToAll('news:changed', { id });
  ok(res, { pinned });
}));

router.delete('/news/:id', ah(async (req, res) => {
  const u = req.user!;
  const id = pid(req);
  const before = await ownPost(u, id);
  await q(`UPDATE NewsPosts SET is_deleted = 1, deleted_by = @u, deleted_at = SYSUTCDATETIME() WHERE post_id = @id`, { u: T.uuid(u.id), id: T.uuid(id) });
  await audit({ userId: u.id, action: 'news_delete', entityType: 'news', entityId: id, oldValue: { title: before.title } }, req);
  emitToAll('news:changed', { id });
  ok(res, { deleted: true });
}));

export default router;

/**
 * A post written by the system on behalf of a user (e.g. the InkCode plan import: "New Code ตรวจ 100%"), to the given tags.
 * Same visibility, unread badge and bell notification as a post from the page. Returns the post id.
 */
export async function createSystemPost(author: AuthUser, p: { title: string; body: string; tagIds: string[]; linkUrl?: string | null }): Promise<string | null> {
  if (!p.tagIds.length) return null;
  const tags = await q(`SELECT tag_id, tag_name, is_system FROM Tags WHERE tag_id IN ${idList('@ids')}`, { ids: jsonParam(p.tagIds) });
  if (!tags.length) return null;
  const id = await withTx(async (tx) => {
    const row = await q1(`INSERT INTO NewsPosts (title, body, link_url, is_pinned, created_by) OUTPUT inserted.post_id VALUES (@t, @b, @l, 0, @u)`,
      { t: p.title.slice(0, 200), b: T.text(p.body.slice(0, 20000)), l: T.text(p.linkUrl ?? null), u: T.uuid(author.id) }, tx);
    await writeTags(tx, row!.post_id, tags.map((t: any) => t.tag_id));
    return row!.post_id as string;
  });
  await notifyTagged(id, p.title, author, tags);
  emitToAll('news:changed', { id });
  return id;
}
