import { Router } from 'express';
import { z } from 'zod';
import { q, q1, T, withTx } from '../../config/db';
import { isAdminRole, requireRole, ROLE_SQL } from '../../middleware/auth';
import { audit } from '../../shared/audit';
import { ah, badRequest, conflict, forbidden, notFound, ok, parse, pid, zId } from '../../shared/http';
import { notify } from '../../shared/notify';

/**
 * "ขอ Tag": a user asks for a tag and picks who decides (any active master / admin / root). That person (or any admin)
 * approves — the user gets the tag — or rejects with a note. Both sides are notified.
 */
const router = Router();
const managers = requireRole('master', 'admin');

const SELECT = `SELECT r.request_id, r.user_id, r.tag_id, r.approver_id, r.note, r.status, r.review_note, r.reviewed_at, r.created_at,
    t.tag_name, t.color, u.display_name AS user_name, u.username, u.avatar_url, ${ROLE_SQL} AS user_role,
    a.display_name AS approver_name, rb.display_name AS reviewed_by_name
  FROM TagRequests r
  JOIN Tags t ON t.tag_id = r.tag_id
  JOIN Users u ON u.user_id = r.user_id
  LEFT JOIN Users a ON a.user_id = r.approver_id
  LEFT JOIN Users rb ON rb.user_id = r.reviewed_by`;

const mapReq = (r: any) => ({
  id: r.request_id,
  status: r.status as 'pending' | 'approved' | 'rejected' | 'cancelled',
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
router.get('/tag-requests/approvers', ah(async (_req, res) => {
  const rows = await q(
    `SELECT * FROM (SELECT u.user_id, u.display_name, u.username, u.avatar_url, ${ROLE_SQL} AS role FROM Users u WHERE u.is_active = 1) x
     WHERE x.role IN ('master', 'admin', 'root') ORDER BY CASE x.role WHEN 'admin' THEN 0 WHEN 'root' THEN 1 ELSE 2 END, x.display_name`,
  );
  ok(res, rows.map((r) => ({ id: r.user_id, displayName: r.display_name, username: r.username, avatarUrl: r.avatar_url ?? null, role: r.role })));
}));

/** My requests (newest first) */
router.get('/tag-requests/mine', ah(async (req, res) => {
  const rows = await q(`${SELECT} WHERE r.user_id = @u ORDER BY r.created_at DESC`, { u: T.uuid(req.user!.id) });
  ok(res, rows.map(mapReq));
}));

/** Requests waiting for me (sidebar badge) */
router.get('/tag-requests/pending-count', ah(async (req, res) => {
  if (!['master', 'admin', 'root'].includes(req.user!.role)) return ok(res, { count: 0 });
  const r = await q1(`SELECT COUNT(*) AS n FROM TagRequests WHERE status = 'pending' AND approver_id = @u`, { u: T.uuid(req.user!.id) });
  ok(res, { count: Number(r?.n ?? 0) });
}));

/** Requests sent to me · scope=all: every request (admin / root) */
router.get('/tag-requests', managers, ah(async (req, res) => {
  const all = req.query.scope === 'all' && isAdminRole(req.user!.role);
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(String(req.query.status)) ? String(req.query.status) : null;
  const where = [all ? '1 = 1' : 'r.approver_id = @me', status ? 'r.status = @s' : '1 = 1'];
  const rows = await q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
    OFFSET 0 ROWS FETCH NEXT 300 ROWS ONLY`, { me: T.uuid(req.user!.id), s: T.text(status) });
  ok(res, rows.map(mapReq));
}));

router.post('/tag-requests', ah(async (req, res) => {
  const b = parse(z.object({ tagId: zId, approverId: zId, note: z.string().trim().max(1000).nullish() }), req.body);
  const me = req.user!;
  const tag = await q1(`SELECT tag_id, tag_name, is_system FROM Tags WHERE tag_id = @t`, { t: T.uuid(b.tagId) });
  if (!tag) throw notFound('ไม่พบ Tag นี้');
  if (tag.is_system) throw badRequest('ทุกคนมี Tag All อยู่แล้ว');
  if (await q1(`SELECT 1 AS x FROM UserTags WHERE user_id = @u AND tag_id = @t`, { u: T.uuid(me.id), t: T.uuid(b.tagId) }))
    throw conflict(`คุณมี Tag "${tag.tag_name}" อยู่แล้ว`);
  if (await q1(`SELECT 1 AS x FROM TagRequests WHERE user_id = @u AND tag_id = @t AND status = 'pending'`, { u: T.uuid(me.id), t: T.uuid(b.tagId) }))
    throw conflict(`มีคำขอ Tag "${tag.tag_name}" ที่รออนุมัติอยู่แล้ว`);
  const approver = await q1(`SELECT u.user_id, u.display_name, ${ROLE_SQL} AS role FROM Users u WHERE u.user_id = @a AND u.is_active = 1`, { a: T.uuid(b.approverId) });
  if (!approver || !['master', 'admin', 'root'].includes(approver.role)) throw badRequest('ผู้อนุมัติต้องเป็น Master หรือ Admin ที่ใช้งานอยู่');
  const row = await q1(
    `INSERT INTO TagRequests (user_id, tag_id, approver_id, note) OUTPUT inserted.request_id VALUES (@u, @t, @a, @n)`,
    { u: T.uuid(me.id), t: T.uuid(b.tagId), a: T.uuid(b.approverId), n: T.text(b.note || null) },
  );
  await audit({ userId: me.id, action: 'tag_request', entityType: 'tag', entityId: b.tagId, newValue: { approverId: b.approverId, note: b.note ?? null } }, req);
  await notify([b.approverId], {
    type: 'tag_request',
    title: `คำขอ Tag "${tag.tag_name}"`,
    message: `${me.displayName} ขอเข้า Tag "${tag.tag_name}"${b.note ? ` — ${b.note}` : ''}`,
    link: '/requests?tab=tags',
  });
  ok(res, mapReq(await q1(`${SELECT} WHERE r.request_id = @id`, { id: T.uuid(row!.request_id) })), 201);
}));

/** The requester takes back a pending request */
router.delete('/tag-requests/:id', ah(async (req, res) => {
  const id = pid(req);
  const r = await q1(`SELECT user_id, status FROM TagRequests WHERE request_id = @id`, { id: T.uuid(id) });
  if (!r) throw notFound('ไม่พบคำขอนี้');
  if (String(r.user_id).toLowerCase() !== req.user!.id.toLowerCase()) throw forbidden();
  if (r.status !== 'pending') throw badRequest('คำขอนี้ถูกพิจารณาแล้ว');
  await q(`UPDATE TagRequests SET status = 'cancelled', reviewed_at = SYSUTCDATETIME() WHERE request_id = @id`, { id: T.uuid(id) });
  ok(res, { cancelled: true });
}));

router.post('/tag-requests/:id/review', managers, ah(async (req, res) => {
  const id = pid(req);
  const b = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(1000).nullish() }), req.body);
  const me = req.user!;
  const r = await q1(`${SELECT} WHERE r.request_id = @id`, { id: T.uuid(id) });
  if (!r) throw notFound('ไม่พบคำขอนี้');
  if (String(r.approver_id).toLowerCase() !== me.id.toLowerCase() && !isAdminRole(me.role))
    throw forbidden('คำขอนี้ส่งถึงผู้อนุมัติคนอื่น (Admin พิจารณาแทนได้)');
  if (r.status !== 'pending') throw badRequest('คำขอนี้ถูกพิจารณาแล้ว');
  await withTx(async (tx) => {
    await q(`UPDATE TagRequests SET status = @s, reviewed_by = @by, review_note = @n, reviewed_at = SYSUTCDATETIME() WHERE request_id = @id`,
      { s: b.approve ? 'approved' : 'rejected', by: T.uuid(me.id), n: T.text(b.note || null), id: T.uuid(id) }, tx);
    if (b.approve)
      await q(`INSERT INTO UserTags (user_id, tag_id, added_by) SELECT @u, @t, @by WHERE NOT EXISTS (SELECT 1 FROM UserTags WHERE user_id = @u AND tag_id = @t)`,
        { u: T.uuid(r.user_id), t: T.uuid(r.tag_id), by: T.uuid(me.id) }, tx);
    await audit({ userId: me.id, action: b.approve ? 'tag_request_approve' : 'tag_request_reject', entityType: 'tag', entityId: r.tag_id,
      newValue: { requestId: id, userId: r.user_id, note: b.note ?? null } }, req, tx);
  });
  await notify([r.user_id], {
    type: 'tag_request_done',
    title: b.approve ? `ได้รับ Tag "${r.tag_name}" แล้ว` : `คำขอ Tag "${r.tag_name}" ไม่ผ่าน`,
    message: `${me.displayName} ${b.approve ? 'อนุมัติ' : 'ไม่อนุมัติ'}คำขอของคุณ${b.note ? ` — ${b.note}` : ''}`,
    link: '/tags',
  });
  ok(res, mapReq(await q1(`${SELECT} WHERE r.request_id = @id`, { id: T.uuid(id) })));
}));

export default router;
