import { Router, Request } from 'express';
import { z } from 'zod';
import { q, q1, T } from '../config/db';
import { isBasicRole, ROLE_SQL } from '../middleware/auth';
import { audit } from '../shared/audit';
import { ah, badRequest, conflict, forbidden, notFound, ok, parse, pid, zId } from '../shared/http';
import { notify } from '../shared/notify';
import { LV, levelName, managersOf, PermCtx, requireFile, requireFolder, toLevel } from '../shared/permissions';

const router = Router();
const permEnum = z.enum(['read', 'write', 'manage']);
const PERM_TH: Record<string, string> = { read: 'ดูข้อมูล', write: 'แก้ไขข้อมูล', manage: 'จัดการ' };

const grantSchema = z.object({
  userId: zId,
  permission: permEnum,
  expiresAt: z.string().datetime({ offset: true }).nullish(),
});

const userCols = `u.user_id, u.username, u.display_name, u.email, u.avatar_url, ${ROLE_SQL} AS role`;
const mapGrant = (r: any, source: string, extra: Record<string, unknown> = {}) => ({
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

async function inheritedFor(ctx: PermCtx, folderId: string) {
  const chain = ctx.path(folderId);
  const out: any[] = [];
  for (const f of chain) {
    const owner = await q1(`SELECT ${userCols} FROM Users u WHERE u.user_id = @u`, { u: T.uuid(f.createdBy) });
    if (owner) out.push(mapGrant({ ...owner, permission: 'manage' }, 'folder_owner', { folderId: f.id, folderName: f.name }));
    const rows = await q(
      `SELECT ${userCols}, fa.permission, fa.granted_at, fa.expires_at, gb.display_name AS granted_by_name
       FROM FolderAccess fa JOIN Users u ON u.user_id = fa.user_id LEFT JOIN Users gb ON gb.user_id = fa.granted_by
       WHERE fa.folder_id = @f`,
      { f: T.uuid(f.id) },
    );
    rows.forEach((r) => out.push(mapGrant(r, 'folder', { folderId: f.id, folderName: f.name })));
  }
  return out;
}

/* ---------------- Tag grants (everyone with the tag) ---------------- */
const tagGrantSchema = z.object({ tagId: zId, permission: permEnum, expiresAt: z.string().datetime({ offset: true }).nullish() });

const mapTagGrant = (r: any, source: string, extra: Record<string, unknown> = {}) => ({
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

async function tagGrants(kind: 'file' | 'folder', id: string) {
  const table = kind === 'file' ? 'FileTagAccess' : 'FolderTagAccess';
  const col = kind === 'file' ? 'file_id' : 'folder_id';
  return q(
    `SELECT t.tag_id, t.tag_name, t.color, ta.permission, ta.granted_at, ta.expires_at, gb.display_name AS granted_by_name,
       (SELECT COUNT(*) FROM UserTagsAll ut JOIN Users u ON u.user_id = ut.user_id AND u.is_active = 1 WHERE ut.tag_id = t.tag_id) AS member_count
     FROM ${table} ta JOIN Tags t ON t.tag_id = ta.tag_id LEFT JOIN Users gb ON gb.user_id = ta.granted_by
     WHERE ta.${col} = @id ORDER BY t.tag_name`,
    { id: T.uuid(id) },
  );
}

async function inheritedTagsFor(ctx: PermCtx, folderId: string) {
  const out: any[] = [];
  for (const f of ctx.path(folderId)) (await tagGrants('folder', f.id)).forEach((r) => out.push(mapTagGrant(r, 'folder', { folderId: f.id, folderName: f.name })));
  return out;
}

async function upsertTagGrant(kind: 'file' | 'folder', targetId: string, g: z.infer<typeof tagGrantSchema>, by: string) {
  const table = kind === 'file' ? 'FileTagAccess' : 'FolderTagAccess';
  const col = kind === 'file' ? 'file_id' : 'folder_id';
  const tag = await q1(`SELECT tag_id, tag_name FROM Tags WHERE tag_id = @t`, { t: T.uuid(g.tagId) });
  if (!tag) throw notFound('ไม่พบ Tag นี้');
  await q(
    `MERGE ${table} AS t USING (SELECT @id AS target_id, @tag AS tag_id) AS s
     ON t.${col} = s.target_id AND t.tag_id = s.tag_id
     WHEN MATCHED THEN UPDATE SET permission = @p, granted_by = @by, granted_at = SYSUTCDATETIME(), expires_at = @e
     WHEN NOT MATCHED THEN INSERT (${col}, tag_id, permission, granted_by, expires_at) VALUES (s.target_id, s.tag_id, @p, @by, @e);`,
    { id: T.uuid(targetId), tag: T.uuid(g.tagId), p: g.permission, by: T.uuid(by), e: T.dt(g.expiresAt ?? null) },
  );
  const members = (await q(`SELECT ut.user_id FROM UserTagsAll ut JOIN Users u ON u.user_id = ut.user_id AND u.is_active = 1 WHERE ut.tag_id = @t`, { t: T.uuid(g.tagId) }))
    .map((r) => r.user_id as string);
  return { name: tag.tag_name as string, members };
}

/* ---------------- File access ---------------- */
router.get(
  '/files/:id/access',
  ah(async (req, res) => {
    const id = pid(req);
    const { file, ctx } = await requireFile(req.user!, id, LV.manage);
    const owner = await q1(`SELECT ${userCols} FROM Users u WHERE u.user_id = @u`, { u: T.uuid(file.created_by) });
    const direct = await q(
      `SELECT ${userCols}, fa.permission, fa.granted_at, fa.expires_at, gb.display_name AS granted_by_name
       FROM FileAccess fa JOIN Users u ON u.user_id = fa.user_id LEFT JOIN Users gb ON gb.user_id = fa.granted_by
       WHERE fa.file_id = @f ORDER BY u.display_name`,
      { f: T.uuid(id) },
    );
    ok(res, {
      owner: owner ? mapGrant({ ...owner, permission: 'manage' }, 'owner') : null,
      direct: direct.map((r) => mapGrant(r, 'file')),
      inherited: await inheritedFor(ctx, file.folder_id),
      tags: (await tagGrants('file', id)).map((r) => mapTagGrant(r, 'file')),
      inheritedTags: await inheritedTagsFor(ctx, file.folder_id),
    });
  }),
);

async function upsertGrant(kind: 'file' | 'folder', targetId: string, g: z.infer<typeof grantSchema>, by: string) {
  const table = kind === 'file' ? 'FileAccess' : 'FolderAccess';
  const col = kind === 'file' ? 'file_id' : 'folder_id';
  const u = await q1(`SELECT u.user_id, u.display_name, ${ROLE_SQL} AS role FROM Users u WHERE u.user_id = @u AND u.is_active = 1`, { u: T.uuid(g.userId) });
  if (!u) throw notFound('ไม่พบผู้ใช้ หรือผู้ใช้ถูกปิดการใช้งาน');
  await q(
    `MERGE ${table} AS t USING (SELECT @id AS target_id, @u AS user_id) AS s
     ON t.${col} = s.target_id AND t.user_id = s.user_id
     WHEN MATCHED THEN UPDATE SET permission = @p, granted_by = @by, granted_at = SYSUTCDATETIME(), expires_at = @e
     WHEN NOT MATCHED THEN INSERT (${col}, user_id, permission, granted_by, expires_at) VALUES (s.target_id, s.user_id, @p, @by, @e);`,
    { id: T.uuid(targetId), u: T.uuid(g.userId), p: g.permission, by: T.uuid(by), e: T.dt(g.expiresAt ?? null) },
  );
  return u;
}

/** Level actually usable by a recipient whose role caps their permission (null = not capped) */
function cappedTo(role: string, perm: string): 'read' | 'write' | null {
  if (role === 'viewer' && perm !== 'read') return 'read';
  if (role === 'user' && perm === 'manage') return 'write';
  return null;
}

router.put(
  '/files/:id/access',
  ah(async (req, res) => {
    const id = pid(req);
    const { file } = await requireFile(req.user!, id, LV.manage);
    const g = parse(grantSchema, req.body);
    if (g.userId === file.created_by) throw badRequest('เจ้าของไฟล์มีสิทธิ์จัดการอยู่แล้ว');
    const target = await upsertGrant('file', id, g, req.user!.id);
    await audit({ userId: req.user!.id, action: 'access_grant', entityType: 'file', entityId: id, fileId: id, newValue: g }, req);
    await notify([g.userId], {
      type: 'access_granted',
      title: 'คุณได้รับสิทธิ์เข้าถึงไฟล์',
      message: `${req.user!.displayName} ให้สิทธิ์ "${PERM_TH[g.permission]}" ในไฟล์ "${file.file_name}"`,
      link: `/files/${id}`,
    });
    ok(res, { granted: true, cappedTo: cappedTo(target.role, g.permission) });
  }),
);

router.delete(
  '/files/:id/access/:userId',
  ah(async (req, res) => {
    const id = pid(req);
    const userId = pid(req, 'userId');
    await requireFile(req.user!, id, LV.manage);
    await q(`DELETE FROM FileAccess WHERE file_id = @f AND user_id = @u`, { f: T.uuid(id), u: T.uuid(userId) });
    await audit({ userId: req.user!.id, action: 'access_revoke', entityType: 'file', entityId: id, fileId: id, oldValue: { userId } }, req);
    ok(res, { revoked: true });
  }),
);

/* ---------------- Folder access ---------------- */
router.get(
  '/folders/:id/access',
  ah(async (req, res) => {
    const id = pid(req);
    const { folder, ctx } = await requireFolder(req.user!, id, LV.manage);
    const owner = await q1(`SELECT ${userCols} FROM Users u WHERE u.user_id = @u`, { u: T.uuid(folder.createdBy) });
    const direct = await q(
      `SELECT ${userCols}, fa.permission, fa.granted_at, fa.expires_at, gb.display_name AS granted_by_name
       FROM FolderAccess fa JOIN Users u ON u.user_id = fa.user_id LEFT JOIN Users gb ON gb.user_id = fa.granted_by
       WHERE fa.folder_id = @f ORDER BY u.display_name`,
      { f: T.uuid(id) },
    );
    const inherited = folder.parentId ? await inheritedFor(ctx, folder.parentId) : [];
    ok(res, {
      owner: owner ? mapGrant({ ...owner, permission: 'manage' }, 'owner') : null,
      direct: direct.map((r) => mapGrant(r, 'folder')),
      inherited,
      tags: (await tagGrants('folder', id)).map((r) => mapTagGrant(r, 'folder')),
      inheritedTags: folder.parentId ? await inheritedTagsFor(ctx, folder.parentId) : [],
    });
  }),
);

router.put(
  '/folders/:id/access',
  ah(async (req, res) => {
    const id = pid(req);
    const { folder } = await requireFolder(req.user!, id, LV.manage);
    const g = parse(grantSchema, req.body);
    const target = await upsertGrant('folder', id, g, req.user!.id);
    await audit({ userId: req.user!.id, action: 'access_grant', entityType: 'folder', entityId: id, newValue: g }, req);
    await notify([g.userId], {
      type: 'access_granted',
      title: 'คุณได้รับสิทธิ์เข้าถึงโฟลเดอร์',
      message: `${req.user!.displayName} ให้สิทธิ์ "${PERM_TH[g.permission]}" ในโฟลเดอร์ "${folder.name}"`,
      link: `/folders/${id}`,
    });
    ok(res, { granted: true, cappedTo: cappedTo(target.role, g.permission) });
  }),
);

router.delete(
  '/folders/:id/access/:userId',
  ah(async (req, res) => {
    const id = pid(req);
    const userId = pid(req, 'userId');
    await requireFolder(req.user!, id, LV.manage);
    await q(`DELETE FROM FolderAccess WHERE folder_id = @f AND user_id = @u`, { f: T.uuid(id), u: T.uuid(userId) });
    await audit({ userId: req.user!.id, action: 'access_revoke', entityType: 'folder', entityId: id, oldValue: { userId } }, req);
    ok(res, { revoked: true });
  }),
);

/* ---------------- Tag access routes ---------------- */
for (const kind of ['file', 'folder'] as const) {
  const what = kind === 'file' ? 'ไฟล์' : 'โฟลเดอร์';
  const load = async (req: Request) => {
    const id = pid(req);
    if (kind === 'file') { const { file } = await requireFile(req.user!, id, LV.manage); return { id, name: file.file_name as string }; }
    const { folder } = await requireFolder(req.user!, id, LV.manage);
    return { id, name: folder.name };
  };
  router.put(
    `/${kind}s/:id/access/tags`,
    ah(async (req, res) => {
      const t = await load(req);
      const g = parse(tagGrantSchema, req.body);
      const r = await upsertTagGrant(kind, t.id, g, req.user!.id);
      await audit({ userId: req.user!.id, action: 'access_grant', entityType: kind, entityId: t.id, ...(kind === 'file' ? { fileId: t.id } : {}), newValue: { ...g, tag: r.name } }, req);
      await notify(r.members.filter((m) => m !== req.user!.id), {
        type: 'access_granted',
        title: `คุณได้รับสิทธิ์เข้าถึง${what}`,
        message: `${req.user!.displayName} ให้สิทธิ์ "${PERM_TH[g.permission]}" ใน${what} "${t.name}" กับ Tag "${r.name}" ที่คุณอยู่`,
        link: `/${kind}s/${t.id}`,
      });
      ok(res, { granted: true, members: r.members.length });
    }),
  );
  router.delete(
    `/${kind}s/:id/access/tags/:tagId`,
    ah(async (req, res) => {
      const t = await load(req);
      const tagId = pid(req, 'tagId');
      await q(`DELETE FROM ${kind === 'file' ? 'FileTagAccess' : 'FolderTagAccess'} WHERE ${kind}_id = @id AND tag_id = @t`, { id: T.uuid(t.id), t: T.uuid(tagId) });
      await audit({ userId: req.user!.id, action: 'access_revoke', entityType: kind, entityId: t.id, ...(kind === 'file' ? { fileId: t.id } : {}), oldValue: { tagId } }, req);
      ok(res, { revoked: true });
    }),
  );
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

const mapRequest = (r: any, canReview = false) => ({
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

function canReview(ctx: PermCtx, r: any) {
  if (r.target_type === 'file') {
    if (!r.file_id || r.file_deleted) return false;
    return ctx.fileLevel({ file_id: r.file_id, folder_id: r.file_folder_id, created_by: r.file_created_by }) >= LV.manage;
  }
  return !!r.folder_id && ctx.folderLevel(r.folder_id) >= LV.manage;
}

router.post(
  '/access-requests',
  ah(async (req, res) => {
    const u = req.user!;
    const body = parse(
      z.object({
        targetType: z.enum(['file', 'folder']),
        targetId: zId,
        permission: permEnum,
        note: z.string().trim().min(10, 'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร').max(2000),
        durationDays: z.number().int().min(1).max(3650).nullish(),
      }),
      req.body,
    );
    if (u.role === 'viewer' && body.permission !== 'read') throw badRequest('บทบาท Viewer ขอสิทธิ์ได้เฉพาะระดับ "ดูข้อมูล"');
    if (u.role === 'user' && body.permission === 'manage') throw badRequest('ผู้ใช้ทั่วไปขอสิทธิ์ได้สูงสุดระดับ "แก้ไขข้อมูล"');
    const ctx = await PermCtx.load(u);
    let name: string;
    let current: number;
    if (body.targetType === 'file') {
      const f = await q1(`SELECT file_id, file_name, folder_id, created_by FROM Files WHERE file_id = @id AND is_deleted = 0`, { id: T.uuid(body.targetId) });
      if (!f) throw notFound('ไม่พบไฟล์');
      name = f.file_name;
      current = ctx.fileLevel(f);
    } else {
      const f = ctx.index.map.get(body.targetId);
      if (!f) throw notFound('ไม่พบโฟลเดอร์');
      name = f.name;
      current = ctx.folderLevel(f.id);
    }
    if (current >= toLevel(body.permission)) throw badRequest(`คุณมีสิทธิ์ระดับ "${PERM_TH[levelName(current)] ?? levelName(current)}" อยู่แล้ว`);
    const pending = await q1(
      `SELECT 1 AS x FROM AccessRequests WHERE requester_id = @u AND status = 'pending' AND target_type = @t
       AND ((@t = 'file' AND file_id = @id) OR (@t = 'folder' AND folder_id = @id))`,
      { u: T.uuid(u.id), t: body.targetType, id: T.uuid(body.targetId) },
    );
    if (pending) throw conflict('คุณมีคำขอที่รอการอนุมัติสำหรับรายการนี้อยู่แล้ว');
    const row = await q1(
      `INSERT INTO AccessRequests (target_type, file_id, folder_id, requester_id, permission, note, duration_days)
       OUTPUT inserted.request_id VALUES (@t, @f, @fo, @u, @p, @n, @d)`,
      {
        t: body.targetType,
        f: T.uuid(body.targetType === 'file' ? body.targetId : null),
        fo: T.uuid(body.targetType === 'folder' ? body.targetId : null),
        u: T.uuid(u.id), p: body.permission, n: body.note, d: T.int(body.durationDays ?? null),
      },
    );
    await audit({ userId: u.id, action: 'access_request', entityType: body.targetType, entityId: body.targetId,
      fileId: body.targetType === 'file' ? body.targetId : null, newValue: body }, req);
    const managers = (await managersOf({ type: body.targetType, id: body.targetId })).filter((m) => m !== u.id);
    await notify(managers, {
      type: 'access_request',
      title: 'มีคำขอสิทธิ์เข้าถึงใหม่',
      message: `${u.displayName} ขอสิทธิ์ "${PERM_TH[body.permission]}" ใน "${name}": ${body.note.slice(0, 120)}`,
      link: `/access-requests?box=review`,
    });
    ok(res, { id: row!.request_id }, 201);
  }),
);

router.get(
  '/access-requests/pending-count',
  ah(async (req, res) => {
    const u = req.user!;
    if (isBasicRole(u.role)) return ok(res, { count: 0 });
    const ctx = await PermCtx.load(u);
    const rows = await q(`${REQ_SQL} WHERE ar.status = 'pending'`);
    ok(res, { count: rows.filter((r) => r.requester_id !== u.id && canReview(ctx, r)).length });
  }),
);

router.get(
  '/access-requests',
  ah(async (req, res) => {
    const u = req.user!;
    const box = req.query.box === 'review' ? 'review' : 'mine';
    const status = String(req.query.status ?? 'all');
    const statusSql = ['pending', 'approved', 'rejected', 'cancelled'].includes(status) ? 'AND ar.status = @st' : '';
    const ctx = await PermCtx.load(u);
    if (box === 'mine') {
      const rows = await q(`${REQ_SQL} WHERE ar.requester_id = @u ${statusSql} ORDER BY ar.created_at DESC`, { u: T.uuid(u.id), st: status });
      return ok(res, rows.map((r) => mapRequest(r, false)));
    }
    const rows = await q(`SELECT TOP 1000 * FROM (${REQ_SQL} WHERE 1 = 1 ${statusSql}) x ORDER BY x.created_at DESC`, { st: status });
    ok(res, rows.filter((r) => r.requester_id !== u.id && canReview(ctx, r)).map((r) => mapRequest(r, r.status === 'pending')));
  }),
);

async function loadRequestForReview(req: Request) {
  const id = pid(req);
  const r = await q1(`${REQ_SQL} WHERE ar.request_id = @id`, { id: T.uuid(id) });
  if (!r) throw notFound('ไม่พบคำขอ');
  if (r.status !== 'pending') throw badRequest('คำขอนี้ได้รับการดำเนินการไปแล้ว');
  const ctx = await PermCtx.load(req.user!);
  if (!canReview(ctx, r)) throw forbidden('คุณไม่มีสิทธิ์อนุมัติคำขอนี้');
  return r;
}

router.post(
  '/access-requests/:id/approve',
  ah(async (req, res) => {
    const r = await loadRequestForReview(req);
    const body = parse(
      z.object({ permission: permEnum.optional(), expiresAt: z.string().datetime({ offset: true }).nullish(), reviewNote: z.string().max(2000).optional() }),
      req.body ?? {},
    );
    const permission = body.permission ?? r.permission;
    const expiresAt = body.expiresAt !== undefined ? body.expiresAt : r.duration_days ? new Date(Date.now() + r.duration_days * 86400_000).toISOString() : null;
    const targetId = r.target_type === 'file' ? r.file_id : r.folder_id;
    await upsertGrant(r.target_type, targetId, { userId: r.requester_id, permission, expiresAt }, req.user!.id);
    await q(
      `UPDATE AccessRequests SET status = 'approved', reviewed_by = @u, review_note = @n, reviewed_at = SYSUTCDATETIME() WHERE request_id = @id`,
      { u: T.uuid(req.user!.id), n: T.text(body.reviewNote ?? null), id: T.uuid(r.request_id) },
    );
    await audit({ userId: req.user!.id, action: 'access_approve', entityType: r.target_type, entityId: targetId,
      fileId: r.target_type === 'file' ? targetId : null, newValue: { requestId: r.request_id, requester: r.requester_id, permission, expiresAt } }, req);
    await notify([r.requester_id], {
      type: 'access_approved',
      title: 'คำขอสิทธิ์ได้รับการอนุมัติ',
      message: `${req.user!.displayName} อนุมัติสิทธิ์ "${PERM_TH[permission]}" ใน "${r.file_name ?? r.folder_name}"${body.reviewNote ? `: ${body.reviewNote}` : ''}`,
      link: r.target_type === 'file' ? `/files/${targetId}` : `/folders/${targetId}`,
    });
    ok(res, { approved: true });
  }),
);

router.post(
  '/access-requests/:id/reject',
  ah(async (req, res) => {
    const r = await loadRequestForReview(req);
    const { reviewNote } = parse(z.object({ reviewNote: z.string().trim().min(3, 'กรุณาระบุเหตุผลที่ปฏิเสธ').max(2000) }), req.body);
    await q(
      `UPDATE AccessRequests SET status = 'rejected', reviewed_by = @u, review_note = @n, reviewed_at = SYSUTCDATETIME() WHERE request_id = @id`,
      { u: T.uuid(req.user!.id), n: reviewNote, id: T.uuid(r.request_id) },
    );
    await audit({ userId: req.user!.id, action: 'access_reject', entityType: r.target_type, entityId: r.file_id ?? r.folder_id,
      fileId: r.file_id, newValue: { requestId: r.request_id, reviewNote } }, req);
    await notify([r.requester_id], {
      type: 'access_rejected',
      title: 'คำขอสิทธิ์ถูกปฏิเสธ',
      message: `${req.user!.displayName} ปฏิเสธคำขอใน "${r.file_name ?? r.folder_name}": ${reviewNote}`,
      link: '/access-requests',
    });
    ok(res, { rejected: true });
  }),
);

router.post(
  '/access-requests/:id/cancel',
  ah(async (req, res) => {
    const id = pid(req);
    const r = await q1(`SELECT * FROM AccessRequests WHERE request_id = @id`, { id: T.uuid(id) });
    if (!r || r.requester_id !== req.user!.id) throw notFound('ไม่พบคำขอ');
    if (r.status !== 'pending') throw badRequest('ยกเลิกได้เฉพาะคำขอที่รออนุมัติ');
    await q(`UPDATE AccessRequests SET status = 'cancelled' WHERE request_id = @id`, { id: T.uuid(id) });
    ok(res, { cancelled: true });
  }),
);

export default router;
