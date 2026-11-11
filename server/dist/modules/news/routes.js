"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const socket_1 = require("../../socket");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const notify_1 = require("../../shared/notify");
const service_1 = require("../pageAccess/service");
/**
 * News board ("ข่าวสาร"): posts with tags. A post is seen by the users having one of its tags (system tag All = everyone),
 * by its author and by admins. Viewers read only; pinning is for master and up.
 */
const router = (0, express_1.Router)();
router.use('/news', (0, service_1.requirePage)('news'));
const canPin = (u) => auth_1.ROLE_ID[u.role] >= auth_1.ROLE_ID.master;
/** posts the user may see (alias p = NewsPosts) */
const VISIBLE = `p.is_deleted = 0 AND (@admin = 1 OR p.created_by = @me OR EXISTS (
  SELECT 1 FROM NewsPostTags pt JOIN UserTagsAll ut ON ut.tag_id = pt.tag_id WHERE pt.post_id = p.post_id AND ut.user_id = @me))`;
const vis = (u) => ({ me: db_1.T.uuid(u.id), admin: (0, auth_1.isAdminRole)(u.role) ? 1 : 0 });
const POST_SQL = `SELECT p.post_id, p.title, p.body, p.images_json, p.link_url, p.is_pinned, p.created_by, p.created_at, p.updated_at,
    a.display_name AS author_name, a.avatar_url AS author_avatar, ub.display_name AS updated_by_name,
    (SELECT ${auth_1.ROLE_SQL.replace(/u\.user_id/g, 'a.user_id')}) AS author_role
  FROM NewsPosts p LEFT JOIN Users a ON a.user_id = p.created_by LEFT JOIN Users ub ON ub.user_id = p.updated_by`;
async function hydrate(rows, u, lastSeen) {
    const tags = new Map();
    if (rows.length) {
        const tr = await (0, db_1.q)(`SELECT pt.post_id, t.tag_id, t.tag_name, t.color, t.is_system FROM NewsPostTags pt JOIN Tags t ON t.tag_id = pt.tag_id
       WHERE pt.post_id IN ${(0, db_1.idList)('@ids')} ORDER BY t.is_system DESC, t.tag_name`, { ids: (0, db_1.jsonParam)(rows.map((r) => r.post_id)) });
        for (const t of tr) {
            const k = String(t.post_id).toLowerCase();
            if (!tags.has(k))
                tags.set(k, []);
            tags.get(k).push({ id: t.tag_id, name: t.tag_name, color: t.color, isSystem: !!t.is_system });
        }
    }
    return rows.map((r) => {
        const mine = String(r.created_by).toLowerCase() === u.id.toLowerCase();
        return {
            id: r.post_id,
            title: r.title,
            body: r.body,
            images: (0, http_1.safeJson)(r.images_json, []),
            linkUrl: r.link_url ?? null,
            pinned: !!r.is_pinned,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            updatedByName: r.updated_by_name ?? null,
            author: { id: r.created_by, displayName: r.author_name ?? '-', avatarUrl: r.author_avatar ?? null, role: r.author_role ?? 'user' },
            tags: tags.get(String(r.post_id).toLowerCase()) ?? [],
            canEdit: mine || (0, auth_1.isAdminRole)(u.role),
            isNew: !mine && (!lastSeen || new Date(r.created_at) > lastSeen),
        };
    });
}
const lastSeenOf = async (userId) => (await (0, db_1.q1)(`SELECT last_seen_at FROM NewsReads WHERE user_id = @u`, { u: db_1.T.uuid(userId) }))?.last_seen_at ?? null;
async function unreadCount(u) {
    const r = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM NewsPosts p
     WHERE ${VISIBLE} AND p.created_by <> @me
       AND p.created_at > COALESCE((SELECT last_seen_at FROM NewsReads WHERE user_id = @me), '1900-01-01')`, vis(u));
    return Number(r?.n ?? 0);
}
router.get('/news', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const { page, pageSize, offset } = (0, http_1.pageParams)(req.query, 20, 50);
    const where = [VISIBLE];
    const p = vis(u);
    const text = String(req.query.q ?? '').trim().slice(0, 100);
    if (text) {
        where.push('(p.title LIKE @s OR p.body LIKE @s)');
        p.s = `%${(0, http_1.likeEscape)(text)}%`;
    }
    const tag = String(req.query.tag ?? '');
    if (/^[0-9a-f-]{36}$/i.test(tag)) {
        where.push('EXISTS (SELECT 1 FROM NewsPostTags x WHERE x.post_id = p.post_id AND x.tag_id = @tag)');
        p.tag = db_1.T.uuid(tag);
    }
    if (req.query.mine === '1')
        where.push('p.created_by = @me');
    const count = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM NewsPosts p WHERE ${where.join(' AND ')}`, p);
    const rows = await (0, db_1.q)(`${POST_SQL} WHERE ${where.join(' AND ')} ORDER BY p.is_pinned DESC, p.created_at DESC OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`, p);
    const lastSeen = await lastSeenOf(u.id);
    (0, http_1.ok)(res, { items: await hydrate(rows, u, lastSeen), total: Number(count?.n ?? 0), page, pageSize, canPin: canPin(u), canPost: u.role !== 'viewer' });
}));
router.get('/news/unread-count', (0, http_1.ah)(async (req, res) => (0, http_1.ok)(res, { count: await unreadCount(req.user) })));
/** The board was opened: everything up to now is read */
router.post('/news/seen', (0, http_1.ah)(async (req, res) => {
    await (0, db_1.q)(`MERGE NewsReads AS t USING (SELECT @u AS user_id) s ON t.user_id = s.user_id
     WHEN MATCHED THEN UPDATE SET last_seen_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (user_id, last_seen_at) VALUES (@u, SYSUTCDATETIME());`, { u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { count: 0 });
}));
router.get('/news/:id', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const row = await (0, db_1.q1)(`${POST_SQL} WHERE p.post_id = @id AND ${VISIBLE.replace(/\bp\./g, 'p.')}`, { ...vis(u), id: db_1.T.uuid((0, http_1.pid)(req)) });
    if (!row)
        throw (0, http_1.notFound)('ไม่พบข่าวนี้ หรือข่าวนี้ไม่ได้ส่งถึงคุณ');
    (0, http_1.ok)(res, (await hydrate([row], u, await lastSeenOf(u.id)))[0]);
}));
const zUpload = zod_1.z.string().max(300).regex(/^\/uploads\/[A-Za-z0-9._-]+$/, 'รูปไม่ถูกต้อง');
const postBody = zod_1.z.object({
    title: zod_1.z.string().trim().min(1, 'กรุณาใส่หัวข้อ').max(200),
    body: zod_1.z.string().trim().min(1, 'กรุณาพิมพ์รายละเอียด').max(20000),
    tagIds: zod_1.z.array(http_1.zId).min(1, 'กรุณาเลือกอย่างน้อย 1 Tag (เลือก All = ทุกคนเห็น)').max(50),
    images: zod_1.z.array(zUpload).max(10).default([]),
    linkUrl: zod_1.z.string().trim().max(1000).regex(/^(https?:\/\/|\/)/i, 'ลิงก์ต้องขึ้นต้นด้วย http(s):// หรือ /').nullish().or(zod_1.z.literal('')),
    pinned: zod_1.z.boolean().default(false),
});
async function checkTags(ids) {
    const rows = await (0, db_1.q)(`SELECT tag_id, tag_name, is_system FROM Tags WHERE tag_id IN ${(0, db_1.idList)('@ids')}`, { ids: (0, db_1.jsonParam)(ids) });
    if (rows.length !== new Set(ids.map((i) => i.toLowerCase())).size)
        throw (0, http_1.badRequest)('มี Tag ที่ไม่พบในระบบ');
    return rows;
}
async function writeTags(tx, postId, tagIds) {
    await (0, db_1.q)(`DELETE FROM NewsPostTags WHERE post_id = @p`, { p: db_1.T.uuid(postId) }, tx);
    await (0, db_1.q)(`INSERT INTO NewsPostTags (post_id, tag_id) SELECT DISTINCT @p, TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids)`, { p: db_1.T.uuid(postId), ids: (0, db_1.jsonParam)(tagIds) }, tx);
}
/** members of the post's real tags (All is not notified one by one: everyone sees the unread badge) */
async function notifyTagged(postId, title, author, tags) {
    const ids = tags.filter((t) => !t.is_system).map((t) => t.tag_id);
    if (!ids.length)
        return;
    const users = await (0, db_1.q)(`SELECT DISTINCT ut.user_id FROM UserTags ut JOIN Users u ON u.user_id = ut.user_id AND u.is_active = 1 WHERE ut.tag_id IN ${(0, db_1.idList)('@ids')} AND ut.user_id <> @me`, { ids: (0, db_1.jsonParam)(ids), me: db_1.T.uuid(author.id) });
    await (0, notify_1.notify)(users.map((x) => x.user_id), {
        type: 'news',
        title: `ข่าวใหม่: ${title}`,
        message: `${author.displayName} โพสต์ถึง ${tags.map((t) => t.tag_name).join(', ')}`,
        link: `/news?post=${postId}`,
    });
}
router.post('/news', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    if (u.role === 'viewer')
        throw (0, http_1.forbidden)('บทบาท Viewer อ่านข่าวได้อย่างเดียว');
    const b = (0, http_1.parse)(postBody, req.body);
    if (b.pinned && !canPin(u))
        throw (0, http_1.forbidden)('ปักหมุดได้เฉพาะ Master ขึ้นไป');
    const tags = await checkTags(b.tagIds);
    const id = await (0, db_1.withTx)(async (tx) => {
        const row = await (0, db_1.q1)(`INSERT INTO NewsPosts (title, body, images_json, link_url, is_pinned, created_by) OUTPUT inserted.post_id VALUES (@t, @b, @i, @l, @p, @u)`, { t: b.title, b: db_1.T.text(b.body), i: db_1.T.text(JSON.stringify(b.images)), l: db_1.T.text(b.linkUrl || null), p: db_1.T.bit(b.pinned), u: db_1.T.uuid(u.id) }, tx);
        await writeTags(tx, row.post_id, b.tagIds);
        await (0, audit_1.audit)({ userId: u.id, action: 'news_create', entityType: 'news', entityId: row.post_id, newValue: { title: b.title, tags: tags.map((t) => t.tag_name) } }, req, tx);
        return row.post_id;
    });
    await notifyTagged(id, b.title, u, tags);
    (0, socket_1.emitToAll)('news:changed', { id });
    const row = await (0, db_1.q1)(`${POST_SQL} WHERE p.post_id = @id`, { id: db_1.T.uuid(id) });
    (0, http_1.ok)(res, (await hydrate([row], u, await lastSeenOf(u.id)))[0], 201);
}));
async function ownPost(u, id) {
    const p = await (0, db_1.q1)(`SELECT post_id, created_by, is_pinned, title FROM NewsPosts WHERE post_id = @id AND is_deleted = 0`, { id: db_1.T.uuid(id) });
    if (!p)
        throw (0, http_1.notFound)('ไม่พบข่าวนี้');
    if (String(p.created_by).toLowerCase() !== u.id.toLowerCase() && !(0, auth_1.isAdminRole)(u.role))
        throw (0, http_1.forbidden)('แก้ไข / ลบได้เฉพาะผู้โพสต์หรือ Admin');
    return p;
}
router.put('/news/:id', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const id = (0, http_1.pid)(req);
    const before = await ownPost(u, id);
    const b = (0, http_1.parse)(postBody, req.body);
    if (b.pinned !== !!before.is_pinned && !canPin(u))
        throw (0, http_1.forbidden)('ปักหมุดได้เฉพาะ Master ขึ้นไป');
    const tags = await checkTags(b.tagIds);
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.q)(`UPDATE NewsPosts SET title = @t, body = @b, images_json = @i, link_url = @l, is_pinned = @p, updated_by = @u, updated_at = SYSUTCDATETIME() WHERE post_id = @id`, { t: b.title, b: db_1.T.text(b.body), i: db_1.T.text(JSON.stringify(b.images)), l: db_1.T.text(b.linkUrl || null), p: db_1.T.bit(b.pinned), u: db_1.T.uuid(u.id), id: db_1.T.uuid(id) }, tx);
        await writeTags(tx, id, b.tagIds);
        await (0, audit_1.audit)({ userId: u.id, action: 'news_update', entityType: 'news', entityId: id, oldValue: { title: before.title }, newValue: { title: b.title, tags: tags.map((t) => t.tag_name) } }, req, tx);
    });
    (0, socket_1.emitToAll)('news:changed', { id });
    const row = await (0, db_1.q1)(`${POST_SQL} WHERE p.post_id = @id`, { id: db_1.T.uuid(id) });
    (0, http_1.ok)(res, (await hydrate([row], u, await lastSeenOf(u.id)))[0]);
}));
/** Pin / unpin only (master and up) */
router.post('/news/:id/pin', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    if (!canPin(u))
        throw (0, http_1.forbidden)('ปักหมุดได้เฉพาะ Master ขึ้นไป');
    const { pinned } = (0, http_1.parse)(zod_1.z.object({ pinned: zod_1.z.boolean() }), req.body);
    const id = (0, http_1.pid)(req);
    const r = await (0, db_1.q1)(`UPDATE NewsPosts SET is_pinned = @p OUTPUT inserted.post_id WHERE post_id = @id AND is_deleted = 0`, { p: db_1.T.bit(pinned), id: db_1.T.uuid(id) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบข่าวนี้');
    await (0, audit_1.audit)({ userId: u.id, action: pinned ? 'news_pin' : 'news_unpin', entityType: 'news', entityId: id }, req);
    (0, socket_1.emitToAll)('news:changed', { id });
    (0, http_1.ok)(res, { pinned });
}));
router.delete('/news/:id', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const id = (0, http_1.pid)(req);
    const before = await ownPost(u, id);
    await (0, db_1.q)(`UPDATE NewsPosts SET is_deleted = 1, deleted_by = @u, deleted_at = SYSUTCDATETIME() WHERE post_id = @id`, { u: db_1.T.uuid(u.id), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: u.id, action: 'news_delete', entityType: 'news', entityId: id, oldValue: { title: before.title } }, req);
    (0, socket_1.emitToAll)('news:changed', { id });
    (0, http_1.ok)(res, { deleted: true });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map