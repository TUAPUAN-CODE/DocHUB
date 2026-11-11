"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const notify_1 = require("../../shared/notify");
/**
 * "ขอ Tag": a user asks for a tag and picks who decides (any active master / admin / root). That person (or any admin)
 * approves — the user gets the tag — or rejects with a note. Both sides are notified.
 */
const router = (0, express_1.Router)();
const managers = (0, auth_1.requireRole)('master', 'admin');
const SELECT = `SELECT r.request_id, r.user_id, r.tag_id, r.approver_id, r.note, r.status, r.review_note, r.reviewed_at, r.created_at,
    t.tag_name, t.color, u.display_name AS user_name, u.username, u.avatar_url, ${auth_1.ROLE_SQL} AS user_role,
    a.display_name AS approver_name, rb.display_name AS reviewed_by_name
  FROM TagRequests r
  JOIN Tags t ON t.tag_id = r.tag_id
  JOIN Users u ON u.user_id = r.user_id
  LEFT JOIN Users a ON a.user_id = r.approver_id
  LEFT JOIN Users rb ON rb.user_id = r.reviewed_by`;
const mapReq = (r) => ({
    id: r.request_id,
    status: r.status,
    note: r.note ?? null,
    reviewNote: r.review_note ?? null,
    reviewedAt: r.reviewed_at ?? null,
    reviewedByName: r.reviewed_by_name ?? null,
    createdAt: r.created_at,
    tag: { id: r.tag_id, name: r.tag_name, color: r.color },
    user: { id: r.user_id, displayName: r.user_name, username: r.username, avatarUrl: r.avatar_url ?? null, role: r.user_role ?? 'user' },
    approver: { id: r.approver_id, displayName: r.approver_name ?? '-' },
});
/** Who a request can be sent to */
router.get('/tag-requests/approvers', (0, http_1.ah)(async (_req, res) => {
    const rows = await (0, db_1.q)(`SELECT * FROM (SELECT u.user_id, u.display_name, u.username, u.avatar_url, ${auth_1.ROLE_SQL} AS role FROM Users u WHERE u.is_active = 1) x
     WHERE x.role IN ('master', 'admin', 'root') ORDER BY CASE x.role WHEN 'admin' THEN 0 WHEN 'root' THEN 1 ELSE 2 END, x.display_name`);
    (0, http_1.ok)(res, rows.map((r) => ({ id: r.user_id, displayName: r.display_name, username: r.username, avatarUrl: r.avatar_url ?? null, role: r.role })));
}));
/** My requests (newest first) */
router.get('/tag-requests/mine', (0, http_1.ah)(async (req, res) => {
    const rows = await (0, db_1.q)(`${SELECT} WHERE r.user_id = @u ORDER BY r.created_at DESC`, { u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, rows.map(mapReq));
}));
/** Requests waiting for me (sidebar badge) */
router.get('/tag-requests/pending-count', (0, http_1.ah)(async (req, res) => {
    if (!['master', 'admin', 'root'].includes(req.user.role))
        return (0, http_1.ok)(res, { count: 0 });
    const r = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM TagRequests WHERE status = 'pending' AND approver_id = @u`, { u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { count: Number(r?.n ?? 0) });
}));
/** Requests sent to me · scope=all: every request (admin / root) */
router.get('/tag-requests', managers, (0, http_1.ah)(async (req, res) => {
    const all = req.query.scope === 'all' && (0, auth_1.isAdminRole)(req.user.role);
    const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(String(req.query.status)) ? String(req.query.status) : null;
    const where = [all ? '1 = 1' : 'r.approver_id = @me', status ? 'r.status = @s' : '1 = 1'];
    const rows = await (0, db_1.q)(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
    OFFSET 0 ROWS FETCH NEXT 300 ROWS ONLY`, { me: db_1.T.uuid(req.user.id), s: db_1.T.text(status) });
    (0, http_1.ok)(res, rows.map(mapReq));
}));
router.post('/tag-requests', (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(zod_1.z.object({ tagId: http_1.zId, approverId: http_1.zId, note: zod_1.z.string().trim().max(1000).nullish() }), req.body);
    const me = req.user;
    const tag = await (0, db_1.q1)(`SELECT tag_id, tag_name, is_system FROM Tags WHERE tag_id = @t`, { t: db_1.T.uuid(b.tagId) });
    if (!tag)
        throw (0, http_1.notFound)('ไม่พบ Tag นี้');
    if (tag.is_system)
        throw (0, http_1.badRequest)('ทุกคนมี Tag All อยู่แล้ว');
    if (await (0, db_1.q1)(`SELECT 1 AS x FROM UserTags WHERE user_id = @u AND tag_id = @t`, { u: db_1.T.uuid(me.id), t: db_1.T.uuid(b.tagId) }))
        throw (0, http_1.conflict)(`คุณมี Tag "${tag.tag_name}" อยู่แล้ว`);
    if (await (0, db_1.q1)(`SELECT 1 AS x FROM TagRequests WHERE user_id = @u AND tag_id = @t AND status = 'pending'`, { u: db_1.T.uuid(me.id), t: db_1.T.uuid(b.tagId) }))
        throw (0, http_1.conflict)(`มีคำขอ Tag "${tag.tag_name}" ที่รออนุมัติอยู่แล้ว`);
    const approver = await (0, db_1.q1)(`SELECT u.user_id, u.display_name, ${auth_1.ROLE_SQL} AS role FROM Users u WHERE u.user_id = @a AND u.is_active = 1`, { a: db_1.T.uuid(b.approverId) });
    if (!approver || !['master', 'admin', 'root'].includes(approver.role))
        throw (0, http_1.badRequest)('ผู้อนุมัติต้องเป็น Master หรือ Admin ที่ใช้งานอยู่');
    const row = await (0, db_1.q1)(`INSERT INTO TagRequests (user_id, tag_id, approver_id, note) OUTPUT inserted.request_id VALUES (@u, @t, @a, @n)`, { u: db_1.T.uuid(me.id), t: db_1.T.uuid(b.tagId), a: db_1.T.uuid(b.approverId), n: db_1.T.text(b.note || null) });
    await (0, audit_1.audit)({ userId: me.id, action: 'tag_request', entityType: 'tag', entityId: b.tagId, newValue: { approverId: b.approverId, note: b.note ?? null } }, req);
    await (0, notify_1.notify)([b.approverId], {
        type: 'tag_request',
        title: `คำขอ Tag "${tag.tag_name}"`,
        message: `${me.displayName} ขอเข้า Tag "${tag.tag_name}"${b.note ? ` — ${b.note}` : ''}`,
        link: '/requests?tab=tags',
    });
    (0, http_1.ok)(res, mapReq(await (0, db_1.q1)(`${SELECT} WHERE r.request_id = @id`, { id: db_1.T.uuid(row.request_id) })), 201);
}));
/** The requester takes back a pending request */
router.delete('/tag-requests/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const r = await (0, db_1.q1)(`SELECT user_id, status FROM TagRequests WHERE request_id = @id`, { id: db_1.T.uuid(id) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบคำขอนี้');
    if (String(r.user_id).toLowerCase() !== req.user.id.toLowerCase())
        throw (0, http_1.forbidden)();
    if (r.status !== 'pending')
        throw (0, http_1.badRequest)('คำขอนี้ถูกพิจารณาแล้ว');
    await (0, db_1.q)(`UPDATE TagRequests SET status = 'cancelled', reviewed_at = SYSUTCDATETIME() WHERE request_id = @id`, { id: db_1.T.uuid(id) });
    (0, http_1.ok)(res, { cancelled: true });
}));
router.post('/tag-requests/:id/review', managers, (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const b = (0, http_1.parse)(zod_1.z.object({ approve: zod_1.z.boolean(), note: zod_1.z.string().trim().max(1000).nullish() }), req.body);
    const me = req.user;
    const r = await (0, db_1.q1)(`${SELECT} WHERE r.request_id = @id`, { id: db_1.T.uuid(id) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบคำขอนี้');
    if (String(r.approver_id).toLowerCase() !== me.id.toLowerCase() && !(0, auth_1.isAdminRole)(me.role))
        throw (0, http_1.forbidden)('คำขอนี้ส่งถึงผู้อนุมัติคนอื่น (Admin พิจารณาแทนได้)');
    if (r.status !== 'pending')
        throw (0, http_1.badRequest)('คำขอนี้ถูกพิจารณาแล้ว');
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.q)(`UPDATE TagRequests SET status = @s, reviewed_by = @by, review_note = @n, reviewed_at = SYSUTCDATETIME() WHERE request_id = @id`, { s: b.approve ? 'approved' : 'rejected', by: db_1.T.uuid(me.id), n: db_1.T.text(b.note || null), id: db_1.T.uuid(id) }, tx);
        if (b.approve)
            await (0, db_1.q)(`INSERT INTO UserTags (user_id, tag_id, added_by) SELECT @u, @t, @by WHERE NOT EXISTS (SELECT 1 FROM UserTags WHERE user_id = @u AND tag_id = @t)`, { u: db_1.T.uuid(r.user_id), t: db_1.T.uuid(r.tag_id), by: db_1.T.uuid(me.id) }, tx);
        await (0, audit_1.audit)({ userId: me.id, action: b.approve ? 'tag_request_approve' : 'tag_request_reject', entityType: 'tag', entityId: r.tag_id,
            newValue: { requestId: id, userId: r.user_id, note: b.note ?? null } }, req, tx);
    });
    await (0, notify_1.notify)([r.user_id], {
        type: 'tag_request_done',
        title: b.approve ? `ได้รับ Tag "${r.tag_name}" แล้ว` : `คำขอ Tag "${r.tag_name}" ไม่ผ่าน`,
        message: `${me.displayName} ${b.approve ? 'อนุมัติ' : 'ไม่อนุมัติ'}คำขอของคุณ${b.note ? ` — ${b.note}` : ''}`,
        link: '/tags',
    });
    (0, http_1.ok)(res, mapReq(await (0, db_1.q1)(`${SELECT} WHERE r.request_id = @id`, { id: db_1.T.uuid(id) })));
}));
exports.default = router;
//# sourceMappingURL=requests.js.map