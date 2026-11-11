"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setUserTags = setUserTags;
exports.tagsOfUsers = tagsOfUsers;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const mappers_1 = require("../../shared/mappers");
/**
 * User tags: an admin or a master defines them and puts users in them (others ask with a tag request, ./requests.ts);
 * files, folders and news posts can be shared with a tag. The system tag "All" (is_system) is everyone: it has no UserTags
 * rows — read memberships through the view UserTagsAll — and cannot be renamed, deleted or given members.
 */
const router = (0, express_1.Router)();
const adminOnly = (0, auth_1.requireRole)('admin');
const managers = (0, auth_1.requireRole)('master', 'admin');
const mapTag = (r) => ({
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
router.get('/tags', (0, http_1.ah)(async (_req, res) => (0, http_1.ok)(res, (await (0, db_1.q)(`${TAG_SQL} ORDER BY t.is_system DESC, t.tag_name`)).map(mapTag))));
/** My tags (with All) — "Tag ของฉัน" */
router.get('/tags/mine', (0, http_1.ah)(async (req, res) => (0, http_1.ok)(res, (await (0, db_1.q)(`${TAG_SQL} WHERE t.tag_id IN (SELECT tag_id FROM UserTagsAll WHERE user_id = @u) ORDER BY t.is_system DESC, t.tag_name`, { u: db_1.T.uuid(req.user.id) })).map(mapTag))));
/** The system tag (All) cannot be renamed, deleted or given members */
async function assertNotSystem(id, what) {
    const t = await (0, db_1.q1)(`SELECT is_system FROM Tags WHERE tag_id = @id`, { id: db_1.T.uuid(id) });
    if (!t)
        throw (0, http_1.notFound)('ไม่พบ Tag นี้');
    if (t.is_system)
        throw (0, http_1.badRequest)(`Tag All เป็น Tag ของระบบ (ทุกคนมีอยู่แล้ว) — ${what}ไม่ได้`);
}
const tagBody = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'กรุณาตั้งชื่อ Tag').max(100),
    color: http_1.zColor.nullish(),
    description: zod_1.z.string().trim().max(500).nullish(),
});
async function checkName(name, exceptId) {
    const dup = await (0, db_1.q1)(`SELECT tag_id FROM Tags WHERE tag_name = @n ${exceptId ? 'AND tag_id <> @id' : ''}`, { n: name, id: db_1.T.uuid(exceptId ?? null) });
    if (dup)
        throw (0, http_1.conflict)(`มี Tag ชื่อ "${name}" อยู่แล้ว`);
}
router.post('/tags', managers, (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(tagBody, req.body);
    await checkName(b.name);
    const row = await (0, db_1.q1)(`INSERT INTO Tags (tag_name, color, description, created_by) OUTPUT inserted.tag_id VALUES (@n, @c, @d, @by)`, { n: b.name, c: b.color ?? '#1552F0', d: db_1.T.text(b.description || null), by: db_1.T.uuid(req.user.id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'tag_create', entityType: 'tag', entityId: row.tag_id, newValue: b }, req);
    (0, http_1.ok)(res, mapTag((await (0, db_1.q1)(`${TAG_SQL} WHERE t.tag_id = @id`, { id: db_1.T.uuid(row.tag_id) }))), 201);
}));
router.put('/tags/:id', managers, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const b = (0, http_1.parse)(tagBody, req.body);
    const before = await (0, db_1.q1)(`SELECT tag_name, color, description, is_system FROM Tags WHERE tag_id = @id`, { id: db_1.T.uuid(id) });
    if (!before)
        throw (0, http_1.notFound)('ไม่พบ Tag นี้');
    if (before.is_system && b.name !== before.tag_name)
        throw (0, http_1.badRequest)('Tag All เป็น Tag ของระบบ — เปลี่ยนชื่อไม่ได้ (เปลี่ยนสี / คำอธิบายได้)');
    await checkName(b.name, id);
    await (0, db_1.q)(`UPDATE Tags SET tag_name = @n, color = @c, description = @d, updated_at = SYSUTCDATETIME() WHERE tag_id = @id`, { n: b.name, c: b.color ?? before.color, d: db_1.T.text(b.description || null), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'tag_update', entityType: 'tag', entityId: id, oldValue: before, newValue: b }, req);
    (0, http_1.ok)(res, mapTag((await (0, db_1.q1)(`${TAG_SQL} WHERE t.tag_id = @id`, { id: db_1.T.uuid(id) }))));
}));
/** Removes the tag from every user and every share made to it */
router.delete('/tags/:id', adminOnly, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    await assertNotSystem(id, 'ลบ');
    const before = await (0, db_1.q1)(`SELECT tag_name FROM Tags WHERE tag_id = @id`, { id: db_1.T.uuid(id) });
    if (!before)
        throw (0, http_1.notFound)('ไม่พบ Tag นี้');
    await (0, db_1.q)(`DELETE FROM Tags WHERE tag_id = @id`, { id: db_1.T.uuid(id) }); // UserTags / FileTagAccess / FolderTagAccess cascade
    await (0, audit_1.audit)({ userId: req.user.id, action: 'tag_delete', entityType: 'tag', entityId: id, oldValue: before }, req);
    (0, http_1.ok)(res, { deleted: true });
}));
router.get('/tags/:id/members', managers, (0, http_1.ah)(async (req, res) => {
    const rows = await (0, db_1.q)(`SELECT u.user_id, u.username, u.display_name, u.email, u.avatar_url, u.is_active, ${auth_1.ROLE_SQL} AS role
       FROM UserTagsAll ut JOIN Users u ON u.user_id = ut.user_id WHERE ut.tag_id = @id ORDER BY u.display_name`, { id: db_1.T.uuid((0, http_1.pid)(req)) });
    (0, http_1.ok)(res, rows.map(mappers_1.mapUser));
}));
router.post('/tags/:id/members', managers, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { userIds } = (0, http_1.parse)(zod_1.z.object({ userIds: zod_1.z.array(http_1.zId).min(1).max(500) }), req.body);
    await assertNotSystem(id, 'เพิ่มสมาชิก');
    await (0, db_1.q)(`INSERT INTO UserTags (user_id, tag_id, added_by)
       SELECT u.user_id, @t, @by FROM Users u
       WHERE u.user_id IN ${(0, db_1.idList)('@ids')} AND NOT EXISTS (SELECT 1 FROM UserTags x WHERE x.user_id = u.user_id AND x.tag_id = @t)`, { t: db_1.T.uuid(id), by: db_1.T.uuid(req.user.id), ids: (0, db_1.jsonParam)(userIds) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'tag_members_add', entityType: 'tag', entityId: id, newValue: { userIds } }, req);
    (0, http_1.ok)(res, { added: true });
}));
router.delete('/tags/:id/members/:userId', managers, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const userId = (0, http_1.pid)(req, 'userId');
    await assertNotSystem(id, 'นำสมาชิกออก');
    await (0, db_1.q)(`DELETE FROM UserTags WHERE tag_id = @t AND user_id = @u`, { t: db_1.T.uuid(id), u: db_1.T.uuid(userId) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'tag_members_remove', entityType: 'tag', entityId: id, oldValue: { userId } }, req);
    (0, http_1.ok)(res, { removed: true });
}));
/** Replace a user's tags (user dialog on the users page) */
router.put('/users/:id/tags', adminOnly, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { tagIds } = (0, http_1.parse)(zod_1.z.object({ tagIds: zod_1.z.array(http_1.zId).max(200) }), req.body);
    if (!(await (0, db_1.q1)(`SELECT 1 AS x FROM Users WHERE user_id = @id`, { id: db_1.T.uuid(id) })))
        throw (0, http_1.notFound)('ไม่พบผู้ใช้');
    await (0, db_1.withTx)(async (tx) => setUserTags(tx, id, tagIds, req.user.id));
    await (0, audit_1.audit)({ userId: req.user.id, action: 'user_tags', entityType: 'user', entityId: id, newValue: { tagIds } }, req);
    (0, http_1.ok)(res, { tags: await tagsOfUsers([id]).then((m) => m.get(id.toLowerCase()) ?? []) });
}));
async function setUserTags(tx, userId, tagIds, by) {
    await (0, db_1.q)(`DELETE FROM UserTags WHERE user_id = @u AND tag_id NOT IN ${(0, db_1.idList)('@ids')}`, { u: db_1.T.uuid(userId), ids: (0, db_1.jsonParam)(tagIds) }, tx);
    await (0, db_1.q)(`INSERT INTO UserTags (user_id, tag_id, added_by)
     SELECT @u, t.tag_id, @by FROM Tags t
     WHERE t.is_system = 0 AND t.tag_id IN ${(0, db_1.idList)('@ids')} AND NOT EXISTS (SELECT 1 FROM UserTags x WHERE x.user_id = @u AND x.tag_id = t.tag_id)`, { u: db_1.T.uuid(userId), by: db_1.T.uuid(by), ids: (0, db_1.jsonParam)(tagIds) }, tx);
}
/** userId (lower case) → its tags, for the users list */
async function tagsOfUsers(ids) {
    const m = new Map();
    if (!ids.length)
        return m;
    const rows = await (0, db_1.q)(`SELECT ut.user_id, t.tag_id, t.tag_name, t.color FROM UserTags ut JOIN Tags t ON t.tag_id = ut.tag_id AND t.is_system = 0
     WHERE ut.user_id IN ${(0, db_1.idList)('@ids')} ORDER BY t.tag_name`, { ids: (0, db_1.jsonParam)(ids) });
    for (const r of rows) {
        const k = String(r.user_id).toLowerCase();
        if (!m.has(k))
            m.set(k, []);
        m.get(k).push({ id: r.tag_id, name: r.tag_name, color: r.color });
    }
    return m;
}
exports.default = router;
//# sourceMappingURL=routes.js.map