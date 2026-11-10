"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const notify_1 = require("../shared/notify");
const permissions_1 = require("../shared/permissions");
const router = (0, express_1.Router)();
const permEnum = zod_1.z.enum(['read', 'write', 'manage']);
const PERM_TH = { read: 'ดูข้อมูล', write: 'แก้ไขข้อมูล', manage: 'จัดการ' };
const grantSchema = zod_1.z.object({
    userId: http_1.zId,
    permission: permEnum,
    expiresAt: zod_1.z.string().datetime({ offset: true }).nullish(),
});
const userCols = `u.user_id, u.username, u.display_name, u.email, u.avatar_url, ${auth_1.ROLE_SQL} AS role`;
const mapGrant = (r, source, extra = {}) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    email: r.email,
    avatarUrl: r.avatar_url,
    role: r.role ?? 'user',
    permission: r.permission,
    grantedAt: r.granted_at ?? null,
    grantedByName: r.granted_by_name ?? null,
    expiresAt: r.expires_at ?? null,
    expired: r.expires_at ? new Date(r.expires_at) < new Date() : false,
    source,
    ...extra,
});
async function inheritedFor(ctx, folderId) {
    const chain = ctx.path(folderId);
    const out = [];
    for (const f of chain) {
        const owner = await (0, db_1.q1)(`SELECT ${userCols} FROM Users u WHERE u.user_id = @u`, { u: db_1.T.uuid(f.createdBy) });
        if (owner)
            out.push(mapGrant({ ...owner, permission: 'manage' }, 'folder_owner', { folderId: f.id, folderName: f.name }));
        const rows = await (0, db_1.q)(`SELECT ${userCols}, fa.permission, fa.granted_at, fa.expires_at, gb.display_name AS granted_by_name
       FROM FolderAccess fa JOIN Users u ON u.user_id = fa.user_id LEFT JOIN Users gb ON gb.user_id = fa.granted_by
       WHERE fa.folder_id = @f`, { f: db_1.T.uuid(f.id) });
        rows.forEach((r) => out.push(mapGrant(r, 'folder', { folderId: f.id, folderName: f.name })));
    }
    return out;
}
/* ---------------- Tag grants (everyone with the tag) ---------------- */
const tagGrantSchema = zod_1.z.object({ tagId: http_1.zId, permission: permEnum, expiresAt: zod_1.z.string().datetime({ offset: true }).nullish() });
const mapTagGrant = (r, source, extra = {}) => ({
    tagId: r.tag_id,
    name: r.tag_name,
    color: r.color,
    memberCount: Number(r.member_count ?? 0),
    permission: r.permission,
    grantedAt: r.granted_at ?? null,
    grantedByName: r.granted_by_name ?? null,
    expiresAt: r.expires_at ?? null,
    expired: r.expires_at ? new Date(r.expires_at) < new Date() : false,
    source,
    ...extra,
});
async function tagGrants(kind, id) {
    const table = kind === 'file' ? 'FileTagAccess' : 'FolderTagAccess';
    const col = kind === 'file' ? 'file_id' : 'folder_id';
    return (0, db_1.q)(`SELECT t.tag_id, t.tag_name, t.color, ta.permission, ta.granted_at, ta.expires_at, gb.display_name AS granted_by_name,
       (SELECT COUNT(*) FROM UserTags ut JOIN Users u ON u.user_id = ut.user_id AND u.is_active = 1 WHERE ut.tag_id = t.tag_id) AS member_count
     FROM ${table} ta JOIN Tags t ON t.tag_id = ta.tag_id LEFT JOIN Users gb ON gb.user_id = ta.granted_by
     WHERE ta.${col} = @id ORDER BY t.tag_name`, { id: db_1.T.uuid(id) });
}
async function inheritedTagsFor(ctx, folderId) {
    const out = [];
    for (const f of ctx.path(folderId))
        (await tagGrants('folder', f.id)).forEach((r) => out.push(mapTagGrant(r, 'folder', { folderId: f.id, folderName: f.name })));
    return out;
}
async function upsertTagGrant(kind, targetId, g, by) {
    const table = kind === 'file' ? 'FileTagAccess' : 'FolderTagAccess';
    const col = kind === 'file' ? 'file_id' : 'folder_id';
    const tag = await (0, db_1.q1)(`SELECT tag_id, tag_name FROM Tags WHERE tag_id = @t`, { t: db_1.T.uuid(g.tagId) });
    if (!tag)
        throw (0, http_1.notFound)('ไม่พบ Tag นี้');
    await (0, db_1.q)(`MERGE ${table} AS t USING (SELECT @id AS target_id, @tag AS tag_id) AS s
     ON t.${col} = s.target_id AND t.tag_id = s.tag_id
     WHEN MATCHED THEN UPDATE SET permission = @p, granted_by = @by, granted_at = SYSUTCDATETIME(), expires_at = @e
     WHEN NOT MATCHED THEN INSERT (${col}, tag_id, permission, granted_by, expires_at) VALUES (s.target_id, s.tag_id, @p, @by, @e);`, { id: db_1.T.uuid(targetId), tag: db_1.T.uuid(g.tagId), p: g.permission, by: db_1.T.uuid(by), e: db_1.T.dt(g.expiresAt ?? null) });
    const members = (await (0, db_1.q)(`SELECT ut.user_id FROM UserTags ut JOIN Users u ON u.user_id = ut.user_id AND u.is_active = 1 WHERE ut.tag_id = @t`, { t: db_1.T.uuid(g.tagId) }))
        .map((r) => r.user_id);
    return { name: tag.tag_name, members };
}
/* ---------------- File access ---------------- */
router.get('/files/:id/access', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file, ctx } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    const owner = await (0, db_1.q1)(`SELECT ${userCols} FROM Users u WHERE u.user_id = @u`, { u: db_1.T.uuid(file.created_by) });
    const direct = await (0, db_1.q)(`SELECT ${userCols}, fa.permission, fa.granted_at, fa.expires_at, gb.display_name AS granted_by_name
       FROM FileAccess fa JOIN Users u ON u.user_id = fa.user_id LEFT JOIN Users gb ON gb.user_id = fa.granted_by
       WHERE fa.file_id = @f ORDER BY u.display_name`, { f: db_1.T.uuid(id) });
    (0, http_1.ok)(res, {
        owner: owner ? mapGrant({ ...owner, permission: 'manage' }, 'owner') : null,
        direct: direct.map((r) => mapGrant(r, 'file')),
        inherited: await inheritedFor(ctx, file.folder_id),
        tags: (await tagGrants('file', id)).map((r) => mapTagGrant(r, 'file')),
        inheritedTags: await inheritedTagsFor(ctx, file.folder_id),
    });
}));
async function upsertGrant(kind, targetId, g, by) {
    const table = kind === 'file' ? 'FileAccess' : 'FolderAccess';
    const col = kind === 'file' ? 'file_id' : 'folder_id';
    const u = await (0, db_1.q1)(`SELECT u.user_id, u.display_name, ${auth_1.ROLE_SQL} AS role FROM Users u WHERE u.user_id = @u AND u.is_active = 1`, { u: db_1.T.uuid(g.userId) });
    if (!u)
        throw (0, http_1.notFound)('ไม่พบผู้ใช้ หรือผู้ใช้ถูกปิดการใช้งาน');
    await (0, db_1.q)(`MERGE ${table} AS t USING (SELECT @id AS target_id, @u AS user_id) AS s
     ON t.${col} = s.target_id AND t.user_id = s.user_id
     WHEN MATCHED THEN UPDATE SET permission = @p, granted_by = @by, granted_at = SYSUTCDATETIME(), expires_at = @e
     WHEN NOT MATCHED THEN INSERT (${col}, user_id, permission, granted_by, expires_at) VALUES (s.target_id, s.user_id, @p, @by, @e);`, { id: db_1.T.uuid(targetId), u: db_1.T.uuid(g.userId), p: g.permission, by: db_1.T.uuid(by), e: db_1.T.dt(g.expiresAt ?? null) });
    return u;
}
/** Level actually usable by a recipient whose role caps their permission (null = not capped) */
function cappedTo(role, perm) {
    if (role === 'viewer' && perm !== 'read')
        return 'read';
    if (role === 'user' && perm === 'manage')
        return 'write';
    return null;
}
router.put('/files/:id/access', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    const g = (0, http_1.parse)(grantSchema, req.body);
    if (g.userId === file.created_by)
        throw (0, http_1.badRequest)('เจ้าของไฟล์มีสิทธิ์จัดการอยู่แล้ว');
    const target = await upsertGrant('file', id, g, req.user.id);
    await (0, audit_1.audit)({ userId: req.user.id, action: 'access_grant', entityType: 'file', entityId: id, fileId: id, newValue: g }, req);
    await (0, notify_1.notify)([g.userId], {
        type: 'access_granted',
        title: 'คุณได้รับสิทธิ์เข้าถึงไฟล์',
        message: `${req.user.displayName} ให้สิทธิ์ "${PERM_TH[g.permission]}" ในไฟล์ "${file.file_name}"`,
        link: `/files/${id}`,
    });
    (0, http_1.ok)(res, { granted: true, cappedTo: cappedTo(target.role, g.permission) });
}));
router.delete('/files/:id/access/:userId', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const userId = (0, http_1.pid)(req, 'userId');
    await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    await (0, db_1.q)(`DELETE FROM FileAccess WHERE file_id = @f AND user_id = @u`, { f: db_1.T.uuid(id), u: db_1.T.uuid(userId) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'access_revoke', entityType: 'file', entityId: id, fileId: id, oldValue: { userId } }, req);
    (0, http_1.ok)(res, { revoked: true });
}));
/* ---------------- Folder access ---------------- */
router.get('/folders/:id/access', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { folder, ctx } = await (0, permissions_1.requireFolder)(req.user, id, permissions_1.LV.manage);
    const owner = await (0, db_1.q1)(`SELECT ${userCols} FROM Users u WHERE u.user_id = @u`, { u: db_1.T.uuid(folder.createdBy) });
    const direct = await (0, db_1.q)(`SELECT ${userCols}, fa.permission, fa.granted_at, fa.expires_at, gb.display_name AS granted_by_name
       FROM FolderAccess fa JOIN Users u ON u.user_id = fa.user_id LEFT JOIN Users gb ON gb.user_id = fa.granted_by
       WHERE fa.folder_id = @f ORDER BY u.display_name`, { f: db_1.T.uuid(id) });
    const inherited = folder.parentId ? await inheritedFor(ctx, folder.parentId) : [];
    (0, http_1.ok)(res, {
        owner: owner ? mapGrant({ ...owner, permission: 'manage' }, 'owner') : null,
        direct: direct.map((r) => mapGrant(r, 'folder')),
        inherited,
        tags: (await tagGrants('folder', id)).map((r) => mapTagGrant(r, 'folder')),
        inheritedTags: folder.parentId ? await inheritedTagsFor(ctx, folder.parentId) : [],
    });
}));
router.put('/folders/:id/access', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { folder } = await (0, permissions_1.requireFolder)(req.user, id, permissions_1.LV.manage);
    const g = (0, http_1.parse)(grantSchema, req.body);
    const target = await upsertGrant('folder', id, g, req.user.id);
    await (0, audit_1.audit)({ userId: req.user.id, action: 'access_grant', entityType: 'folder', entityId: id, newValue: g }, req);
    await (0, notify_1.notify)([g.userId], {
        type: 'access_granted',
        title: 'คุณได้รับสิทธิ์เข้าถึงโฟลเดอร์',
        message: `${req.user.displayName} ให้สิทธิ์ "${PERM_TH[g.permission]}" ในโฟลเดอร์ "${folder.name}"`,
        link: `/folders/${id}`,
    });
    (0, http_1.ok)(res, { granted: true, cappedTo: cappedTo(target.role, g.permission) });
}));
router.delete('/folders/:id/access/:userId', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const userId = (0, http_1.pid)(req, 'userId');
    await (0, permissions_1.requireFolder)(req.user, id, permissions_1.LV.manage);
    await (0, db_1.q)(`DELETE FROM FolderAccess WHERE folder_id = @f AND user_id = @u`, { f: db_1.T.uuid(id), u: db_1.T.uuid(userId) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'access_revoke', entityType: 'folder', entityId: id, oldValue: { userId } }, req);
    (0, http_1.ok)(res, { revoked: true });
}));
/* ---------------- Tag access routes ---------------- */
for (const kind of ['file', 'folder']) {
    const what = kind === 'file' ? 'ไฟล์' : 'โฟลเดอร์';
    const load = async (req) => {
        const id = (0, http_1.pid)(req);
        if (kind === 'file') {
            const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
            return { id, name: file.file_name };
        }
        const { folder } = await (0, permissions_1.requireFolder)(req.user, id, permissions_1.LV.manage);
        return { id, name: folder.name };
    };
    router.put(`/${kind}s/:id/access/tags`, (0, http_1.ah)(async (req, res) => {
        const t = await load(req);
        const g = (0, http_1.parse)(tagGrantSchema, req.body);
        const r = await upsertTagGrant(kind, t.id, g, req.user.id);
        await (0, audit_1.audit)({ userId: req.user.id, action: 'access_grant', entityType: kind, entityId: t.id, ...(kind === 'file' ? { fileId: t.id } : {}), newValue: { ...g, tag: r.name } }, req);
        await (0, notify_1.notify)(r.members.filter((m) => m !== req.user.id), {
            type: 'access_granted',
            title: `คุณได้รับสิทธิ์เข้าถึง${what}`,
            message: `${req.user.displayName} ให้สิทธิ์ "${PERM_TH[g.permission]}" ใน${what} "${t.name}" กับ Tag "${r.name}" ที่คุณอยู่`,
            link: `/${kind}s/${t.id}`,
        });
        (0, http_1.ok)(res, { granted: true, members: r.members.length });
    }));
    router.delete(`/${kind}s/:id/access/tags/:tagId`, (0, http_1.ah)(async (req, res) => {
        const t = await load(req);
        const tagId = (0, http_1.pid)(req, 'tagId');
        await (0, db_1.q)(`DELETE FROM ${kind === 'file' ? 'FileTagAccess' : 'FolderTagAccess'} WHERE ${kind}_id = @id AND tag_id = @t`, { id: db_1.T.uuid(t.id), t: db_1.T.uuid(tagId) });
        await (0, audit_1.audit)({ userId: req.user.id, action: 'access_revoke', entityType: kind, entityId: t.id, ...(kind === 'file' ? { fileId: t.id } : {}), oldValue: { tagId } }, req);
        (0, http_1.ok)(res, { revoked: true });
    }));
}
/* ---------------- Access requests ---------------- */
const REQ_SQL = `
SELECT ar.*, ru.display_name AS requester_name, ru.username AS requester_username, ru.avatar_url AS requester_avatar,
  rv.display_name AS reviewer_name, f.file_name, f.folder_id AS file_folder_id, f.created_by AS file_created_by,
  f.is_deleted AS file_deleted, fo.folder_name
FROM AccessRequests ar
JOIN Users ru ON ru.user_id = ar.requester_id
LEFT JOIN Users rv ON rv.user_id = ar.reviewed_by
LEFT JOIN Files f ON f.file_id = ar.file_id
LEFT JOIN Folders fo ON fo.folder_id = ar.folder_id`;
const mapRequest = (r, canReview = false) => ({
    id: r.request_id,
    targetType: r.target_type,
    targetId: r.target_type === 'file' ? r.file_id : r.folder_id,
    targetName: r.target_type === 'file' ? r.file_name : r.folder_name,
    permission: r.permission,
    note: r.note,
    durationDays: r.duration_days,
    status: r.status,
    requester: { id: r.requester_id, displayName: r.requester_name, username: r.requester_username, avatarUrl: r.requester_avatar },
    reviewerName: r.reviewer_name ?? null,
    reviewNote: r.review_note ?? null,
    reviewedAt: r.reviewed_at ?? null,
    createdAt: r.created_at,
    canReview,
});
function canReview(ctx, r) {
    if (r.target_type === 'file') {
        if (!r.file_id || r.file_deleted)
            return false;
        return ctx.fileLevel({ file_id: r.file_id, folder_id: r.file_folder_id, created_by: r.file_created_by }) >= permissions_1.LV.manage;
    }
    return !!r.folder_id && ctx.folderLevel(r.folder_id) >= permissions_1.LV.manage;
}
router.post('/access-requests', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const body = (0, http_1.parse)(zod_1.z.object({
        targetType: zod_1.z.enum(['file', 'folder']),
        targetId: http_1.zId,
        permission: permEnum,
        note: zod_1.z.string().trim().min(10, 'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร').max(2000),
        durationDays: zod_1.z.number().int().min(1).max(3650).nullish(),
    }), req.body);
    if (u.role === 'viewer' && body.permission !== 'read')
        throw (0, http_1.badRequest)('บทบาท Viewer ขอสิทธิ์ได้เฉพาะระดับ "ดูข้อมูล"');
    if (u.role === 'user' && body.permission === 'manage')
        throw (0, http_1.badRequest)('ผู้ใช้ทั่วไปขอสิทธิ์ได้สูงสุดระดับ "แก้ไขข้อมูล"');
    const ctx = await permissions_1.PermCtx.load(u);
    let name;
    let current;
    if (body.targetType === 'file') {
        const f = await (0, db_1.q1)(`SELECT file_id, file_name, folder_id, created_by FROM Files WHERE file_id = @id AND is_deleted = 0`, { id: db_1.T.uuid(body.targetId) });
        if (!f)
            throw (0, http_1.notFound)('ไม่พบไฟล์');
        name = f.file_name;
        current = ctx.fileLevel(f);
    }
    else {
        const f = ctx.index.map.get(body.targetId);
        if (!f)
            throw (0, http_1.notFound)('ไม่พบโฟลเดอร์');
        name = f.name;
        current = ctx.folderLevel(f.id);
    }
    if (current >= (0, permissions_1.toLevel)(body.permission))
        throw (0, http_1.badRequest)(`คุณมีสิทธิ์ระดับ "${PERM_TH[(0, permissions_1.levelName)(current)] ?? (0, permissions_1.levelName)(current)}" อยู่แล้ว`);
    const pending = await (0, db_1.q1)(`SELECT 1 AS x FROM AccessRequests WHERE requester_id = @u AND status = 'pending' AND target_type = @t
       AND ((@t = 'file' AND file_id = @id) OR (@t = 'folder' AND folder_id = @id))`, { u: db_1.T.uuid(u.id), t: body.targetType, id: db_1.T.uuid(body.targetId) });
    if (pending)
        throw (0, http_1.conflict)('คุณมีคำขอที่รอการอนุมัติสำหรับรายการนี้อยู่แล้ว');
    const row = await (0, db_1.q1)(`INSERT INTO AccessRequests (target_type, file_id, folder_id, requester_id, permission, note, duration_days)
       OUTPUT inserted.request_id VALUES (@t, @f, @fo, @u, @p, @n, @d)`, {
        t: body.targetType,
        f: db_1.T.uuid(body.targetType === 'file' ? body.targetId : null),
        fo: db_1.T.uuid(body.targetType === 'folder' ? body.targetId : null),
        u: db_1.T.uuid(u.id), p: body.permission, n: body.note, d: db_1.T.int(body.durationDays ?? null),
    });
    await (0, audit_1.audit)({ userId: u.id, action: 'access_request', entityType: body.targetType, entityId: body.targetId,
        fileId: body.targetType === 'file' ? body.targetId : null, newValue: body }, req);
    const managers = (await (0, permissions_1.managersOf)({ type: body.targetType, id: body.targetId })).filter((m) => m !== u.id);
    await (0, notify_1.notify)(managers, {
        type: 'access_request',
        title: 'มีคำขอสิทธิ์เข้าถึงใหม่',
        message: `${u.displayName} ขอสิทธิ์ "${PERM_TH[body.permission]}" ใน "${name}": ${body.note.slice(0, 120)}`,
        link: `/access-requests?box=review`,
    });
    (0, http_1.ok)(res, { id: row.request_id }, 201);
}));
router.get('/access-requests/pending-count', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    if ((0, auth_1.isBasicRole)(u.role))
        return (0, http_1.ok)(res, { count: 0 });
    const ctx = await permissions_1.PermCtx.load(u);
    const rows = await (0, db_1.q)(`${REQ_SQL} WHERE ar.status = 'pending'`);
    (0, http_1.ok)(res, { count: rows.filter((r) => r.requester_id !== u.id && canReview(ctx, r)).length });
}));
router.get('/access-requests', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const box = req.query.box === 'review' ? 'review' : 'mine';
    const status = String(req.query.status ?? 'all');
    const statusSql = ['pending', 'approved', 'rejected', 'cancelled'].includes(status) ? 'AND ar.status = @st' : '';
    const ctx = await permissions_1.PermCtx.load(u);
    if (box === 'mine') {
        const rows = await (0, db_1.q)(`${REQ_SQL} WHERE ar.requester_id = @u ${statusSql} ORDER BY ar.created_at DESC`, { u: db_1.T.uuid(u.id), st: status });
        return (0, http_1.ok)(res, rows.map((r) => mapRequest(r, false)));
    }
    const rows = await (0, db_1.q)(`SELECT TOP 1000 * FROM (${REQ_SQL} WHERE 1 = 1 ${statusSql}) x ORDER BY x.created_at DESC`, { st: status });
    (0, http_1.ok)(res, rows.filter((r) => r.requester_id !== u.id && canReview(ctx, r)).map((r) => mapRequest(r, r.status === 'pending')));
}));
async function loadRequestForReview(req) {
    const id = (0, http_1.pid)(req);
    const r = await (0, db_1.q1)(`${REQ_SQL} WHERE ar.request_id = @id`, { id: db_1.T.uuid(id) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบคำขอ');
    if (r.status !== 'pending')
        throw (0, http_1.badRequest)('คำขอนี้ได้รับการดำเนินการไปแล้ว');
    const ctx = await permissions_1.PermCtx.load(req.user);
    if (!canReview(ctx, r))
        throw (0, http_1.forbidden)('คุณไม่มีสิทธิ์อนุมัติคำขอนี้');
    return r;
}
router.post('/access-requests/:id/approve', (0, http_1.ah)(async (req, res) => {
    const r = await loadRequestForReview(req);
    const body = (0, http_1.parse)(zod_1.z.object({ permission: permEnum.optional(), expiresAt: zod_1.z.string().datetime({ offset: true }).nullish(), reviewNote: zod_1.z.string().max(2000).optional() }), req.body ?? {});
    const permission = body.permission ?? r.permission;
    const expiresAt = body.expiresAt !== undefined ? body.expiresAt : r.duration_days ? new Date(Date.now() + r.duration_days * 86400_000).toISOString() : null;
    const targetId = r.target_type === 'file' ? r.file_id : r.folder_id;
    await upsertGrant(r.target_type, targetId, { userId: r.requester_id, permission, expiresAt }, req.user.id);
    await (0, db_1.q)(`UPDATE AccessRequests SET status = 'approved', reviewed_by = @u, review_note = @n, reviewed_at = SYSUTCDATETIME() WHERE request_id = @id`, { u: db_1.T.uuid(req.user.id), n: db_1.T.text(body.reviewNote ?? null), id: db_1.T.uuid(r.request_id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'access_approve', entityType: r.target_type, entityId: targetId,
        fileId: r.target_type === 'file' ? targetId : null, newValue: { requestId: r.request_id, requester: r.requester_id, permission, expiresAt } }, req);
    await (0, notify_1.notify)([r.requester_id], {
        type: 'access_approved',
        title: 'คำขอสิทธิ์ได้รับการอนุมัติ',
        message: `${req.user.displayName} อนุมัติสิทธิ์ "${PERM_TH[permission]}" ใน "${r.file_name ?? r.folder_name}"${body.reviewNote ? `: ${body.reviewNote}` : ''}`,
        link: r.target_type === 'file' ? `/files/${targetId}` : `/folders/${targetId}`,
    });
    (0, http_1.ok)(res, { approved: true });
}));
router.post('/access-requests/:id/reject', (0, http_1.ah)(async (req, res) => {
    const r = await loadRequestForReview(req);
    const { reviewNote } = (0, http_1.parse)(zod_1.z.object({ reviewNote: zod_1.z.string().trim().min(3, 'กรุณาระบุเหตุผลที่ปฏิเสธ').max(2000) }), req.body);
    await (0, db_1.q)(`UPDATE AccessRequests SET status = 'rejected', reviewed_by = @u, review_note = @n, reviewed_at = SYSUTCDATETIME() WHERE request_id = @id`, { u: db_1.T.uuid(req.user.id), n: reviewNote, id: db_1.T.uuid(r.request_id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'access_reject', entityType: r.target_type, entityId: r.file_id ?? r.folder_id,
        fileId: r.file_id, newValue: { requestId: r.request_id, reviewNote } }, req);
    await (0, notify_1.notify)([r.requester_id], {
        type: 'access_rejected',
        title: 'คำขอสิทธิ์ถูกปฏิเสธ',
        message: `${req.user.displayName} ปฏิเสธคำขอใน "${r.file_name ?? r.folder_name}": ${reviewNote}`,
        link: '/access-requests',
    });
    (0, http_1.ok)(res, { rejected: true });
}));
router.post('/access-requests/:id/cancel', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const r = await (0, db_1.q1)(`SELECT * FROM AccessRequests WHERE request_id = @id`, { id: db_1.T.uuid(id) });
    if (!r || r.requester_id !== req.user.id)
        throw (0, http_1.notFound)('ไม่พบคำขอ');
    if (r.status !== 'pending')
        throw (0, http_1.badRequest)('ยกเลิกได้เฉพาะคำขอที่รออนุมัติ');
    await (0, db_1.q)(`UPDATE AccessRequests SET status = 'cancelled' WHERE request_id = @id`, { id: db_1.T.uuid(id) });
    (0, http_1.ok)(res, { cancelled: true });
}));
exports.default = router;
//# sourceMappingURL=access.js.map