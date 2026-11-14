import crypto from 'crypto';
import { Router } from 'express';
import { isBasicRole } from '../middleware/auth';
import { z } from 'zod';
import { idList, jsonParam, q, q1, T, withTx } from '../config/db';
import { env } from '../config/env';
import { audit } from '../shared/audit';
import { ah, badRequest, conflict, forbidden, notFound, ok, parse, pid, zColor, zId } from '../shared/http';
import { mapFile, mapFolderNode } from '../shared/mappers';
import { invalidateFolders, LV, PermCtx, requireFolder } from '../shared/permissions';

const router = Router();

export const FILES_SQL = `
SELECT f.file_id, f.file_name, f.folder_id, f.description, f.icon, f.color, f.status, f.doc_type, f.created_by, f.created_at, f.updated_at,
  cu.display_name AS created_by_name, fo.folder_name,
  (SELECT COUNT(*) FROM Sheets s WHERE s.file_id = f.file_id AND s.is_deleted = 0) AS sheet_count,
  la.created_at AS last_activity_at, la.action_type AS last_action, la.display_name AS last_activity_by,
  la.avatar_url AS last_activity_avatar
FROM Files f
JOIN Users cu ON cu.user_id = f.created_by
JOIN Folders fo ON fo.folder_id = f.folder_id
OUTER APPLY (
  SELECT TOP 1 a.created_at, a.action_type, u.display_name, u.avatar_url
  FROM AuditLog a JOIN Users u ON u.user_id = a.user_id
  WHERE a.file_id = f.file_id ORDER BY a.created_at DESC
) la`;

export async function favoriteSet(userId: string, type: 'file' | 'folder') {
  const rows = await q(`SELECT entity_id FROM Favorites WHERE user_id = @u AND entity_type = @t`, { u: T.uuid(userId), t: type });
  return new Set(rows.map((r) => r.entity_id as string));
}

async function fileCounts() {
  const rows = await q(`SELECT folder_id, COUNT(*) AS n FROM Files WHERE is_deleted = 0 GROUP BY folder_id`);
  return new Map(rows.map((r) => [r.folder_id as string, Number(r.n)]));
}

function folderOut(ctx: PermCtx, id: string, favs: Set<string>, counts: Map<string, number>, vis: (id: string) => boolean) {
  const f = ctx.index.map.get(id)!;
  return {
    ...mapFolderNode(f),
    level: ctx.folderLevel(id),
    favorite: favs.has(id),
    fileCount: counts.get(id) ?? 0,
    folderCount: (ctx.index.children.get(id) ?? []).filter(vis).length,
  };
}

const byName = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'th');

router.get(
  '/folders/tree',
  ah(async (req, res) => {
    const ctx = await PermCtx.load(req.user!);
    const vis = await ctx.visibility();
    const [favs, counts] = await Promise.all([favoriteSet(req.user!.id, 'folder'), fileCounts()]);
    const list = [...ctx.index.map.keys()].filter(vis).map((id) => folderOut(ctx, id, favs, counts, vis));
    ok(res, list.sort(byName));
  }),
);

router.get(
  '/folders/:id/contents',
  ah(async (req, res) => {
    const u = req.user!;
    const ctx = await PermCtx.load(u);
    const vis = await ctx.visibility();
    const [favFolders, favFiles, counts] = await Promise.all([favoriteSet(u.id, 'folder'), favoriteSet(u.id, 'file'), fileCounts()]);
    const canCreateRoot = !isBasicRole(u.role);

    if (req.params.id === 'root') {
      const subfolders = (ctx.index.children.get(null) ?? []).filter(vis).map((id) => folderOut(ctx, id, favFolders, counts, vis));
      return ok(res, { folder: null, breadcrumb: [], level: canCreateRoot ? LV.write : LV.read, subfolders: subfolders.sort(byName), files: [] });
    }
    const id = pid(req);
    if (!ctx.index.map.has(id)) throw notFound('ไม่พบโฟลเดอร์');
    if (!vis(id)) {
      // opened from a shared link without access: say whose folder it is and let them ask for access
      const pending = await q1(
        `SELECT TOP 1 request_id, permission, created_at FROM AccessRequests
         WHERE folder_id = @f AND requester_id = @u AND status = 'pending' ORDER BY created_at DESC`,
        { f: T.uuid(id), u: T.uuid(u.id) },
      );
      throw forbidden('คุณยังไม่มีสิทธิ์เข้าถึงโฟลเดอร์นี้', 'NO_ACCESS', {
        targetType: 'folder', targetId: id, name: ctx.index.map.get(id)!.name, currentLevel: 'none',
        pending: pending ? { id: pending.request_id, permission: pending.permission, createdAt: pending.created_at } : null,
      });
    }
    const level = ctx.folderLevel(id);
    const subfolders = (ctx.index.children.get(id) ?? []).filter(vis).map((cid) => folderOut(ctx, cid, favFolders, counts, vis));
    const files = await q(`${FILES_SQL} WHERE f.folder_id = @id AND f.is_deleted = 0 ORDER BY f.file_name`, { id: T.uuid(id) });
    const mapped = files
      .map((f) => mapFile(f, ctx.fileLevel(f), favFiles.has(f.file_id)))
      .filter((f) => env.showLockedItems || f.level > 0);
    ok(res, {
      folder: folderOut(ctx, id, favFolders, counts, vis),
      breadcrumb: ctx.path(id).map((n) => ({ id: n.id, name: n.name })),
      level,
      subfolders: subfolders.sort(byName),
      files: mapped,
    });
  }),
);

const folderBody = z.object({
  name: z.string().trim().min(1, 'กรุณาตั้งชื่อโฟลเดอร์').max(300),
  description: z.string().max(1000).nullish(),
  color: zColor.nullish(),
  icon: z.string().max(100).nullish(),
});

router.post(
  '/folders',
  ah(async (req, res) => {
    const u = req.user!;
    if (isBasicRole(u.role)) throw forbidden('เฉพาะ Master หรือ Admin เท่านั้นที่สร้างโฟลเดอร์ได้');
    const body = parse(folderBody.extend({ parentId: zId.nullish() }), req.body);
    if (body.parentId) await requireFolder(u, body.parentId, LV.write);
    const dup = await q1(
      `SELECT 1 AS x FROM Folders WHERE is_deleted = 0 AND folder_name = @n AND
         ((@p IS NULL AND parent_id IS NULL) OR parent_id = @p)`,
      { n: body.name, p: T.uuid(body.parentId ?? null) },
    );
    if (dup) throw conflict('มีโฟลเดอร์ชื่อนี้อยู่แล้วในตำแหน่งเดียวกัน');
    const row = await q1(
      `INSERT INTO Folders (folder_name, parent_id, description, color, icon, created_by) OUTPUT inserted.folder_id
       VALUES (@n, @p, @d, COALESCE(@c, N'#1552F0'), COALESCE(@i, N'folder'), @u)`,
      { n: body.name, p: T.uuid(body.parentId ?? null), d: T.text(body.description ?? null), c: T.text(body.color ?? null), i: T.text(body.icon ?? null), u: T.uuid(u.id) },
    );
    invalidateFolders();
    await audit({ userId: u.id, action: 'folder_create', entityType: 'folder', entityId: row!.folder_id, newValue: body }, req);
    const ctx = await PermCtx.load(u);
    ok(res, { ...mapFolderNode(ctx.index.map.get(row!.folder_id)!), level: ctx.folderLevel(row!.folder_id), favorite: false, fileCount: 0, folderCount: 0 }, 201);
  }),
);

router.put(
  '/folders/:id',
  ah(async (req, res) => {
    const id = pid(req);
    const { folder } = await requireFolder(req.user!, id, LV.manage);
    const body = parse(folderBody.partial(), req.body);
    await q(
      `UPDATE Folders SET folder_name = COALESCE(@n, folder_name), description = CASE WHEN @hasD = 1 THEN @d ELSE description END,
         color = COALESCE(@c, color), icon = COALESCE(@i, icon), updated_at = SYSUTCDATETIME() WHERE folder_id = @id`,
      { n: T.text(body.name ?? null), hasD: body.description !== undefined, d: T.text(body.description ?? null), c: T.text(body.color ?? null), i: T.text(body.icon ?? null), id: T.uuid(id) },
    );
    invalidateFolders();
    await audit({ userId: req.user!.id, action: 'folder_update', entityType: 'folder', entityId: id,
      oldValue: { name: folder.name, color: folder.color }, newValue: body }, req);
    ok(res, { updated: true });
  }),
);

router.post(
  '/folders/:id/move',
  ah(async (req, res) => {
    const id = pid(req);
    const u = req.user!;
    const { folder, ctx } = await requireFolder(u, id, LV.manage);
    const { parentId } = parse(z.object({ parentId: zId.nullable() }), req.body);
    if (parentId) {
      if (ctx.descendants(id).includes(parentId)) throw badRequest('ไม่สามารถย้ายโฟลเดอร์ไปไว้ในโฟลเดอร์ย่อยของตัวเองได้');
      await requireFolder(u, parentId, LV.write);
    } else if (isBasicRole(u.role)) throw forbidden();
    await q(`UPDATE Folders SET parent_id = @p, updated_at = SYSUTCDATETIME() WHERE folder_id = @id`, { p: T.uuid(parentId), id: T.uuid(id) });
    invalidateFolders();
    await audit({ userId: u.id, action: 'folder_move', entityType: 'folder', entityId: id, oldValue: { parentId: folder.parentId }, newValue: { parentId } }, req);
    ok(res, { moved: true });
  }),
);

router.delete(
  '/folders/:id',
  ah(async (req, res) => {
    const id = pid(req);
    const u = req.user!;
    const { folder, ctx } = await requireFolder(u, id, LV.manage);
    const ids = ctx.descendants(id);
    const batch = crypto.randomUUID();
    await withTx(async (tx) => {
      const p = { ids: jsonParam(ids), u: T.uuid(u.id), b: T.uuid(batch) };
      await q(`UPDATE Folders SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @u, delete_batch = @b
               WHERE is_deleted = 0 AND folder_id IN ${idList('@ids')}`, p, tx);
      await q(`UPDATE Files SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @u, delete_batch = @b
               WHERE is_deleted = 0 AND folder_id IN ${idList('@ids')}`, p, tx);
      await audit({ userId: u.id, action: 'folder_delete', entityType: 'folder', entityId: id, oldValue: { name: folder.name, subfolders: ids.length - 1 } }, req, tx);
    });
    invalidateFolders();
    ok(res, { deleted: true, batch });
  }),
);

/**
 * "สร้างโฟลเดอร์ ปี/เดือน/วัน": under this folder, <year> / "01 มกราคม" … "12 ธันวาคม" / "01" … "31" (real days of each month).
 * Only missing folders are made (nothing renamed or removed), so it can be run again or for the next year.
 */
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
router.post(
  '/folders/:id/date-tree',
  ah(async (req, res) => {
    const id = pid(req);
    const u = req.user!;
    if (isBasicRole(u.role)) throw forbidden('เฉพาะ Master หรือ Admin เท่านั้นที่สร้างโฟลเดอร์ได้');
    const { folder } = await requireFolder(u, id, LV.write);
    const b = parse(z.object({ year: z.number().int().min(2000).max(2100), days: z.boolean().default(true), months: z.array(z.number().int().min(1).max(12)).max(12).optional() }), req.body);
    const p2 = (n: number) => String(n).padStart(2, '0');
    let made = 0;
    await withTx(async (tx) => {
      const ensure = async (parent: string, name: string): Promise<string> => {
        const have = await q1(`SELECT folder_id FROM Folders WHERE is_deleted = 0 AND parent_id = @p AND folder_name = @n`, { p: T.uuid(parent), n: name }, tx);
        if (have) return have.folder_id as string;
        made++;
        const row = await q1(`INSERT INTO Folders (folder_name, parent_id, color, icon, created_by) OUTPUT inserted.folder_id VALUES (@n, @p, @c, N'folder', @u)`,
          { n: name, p: T.uuid(parent), c: folder.color ?? '#1552F0', u: T.uuid(u.id) }, tx);
        return row!.folder_id as string;
      };
      const yearId = await ensure(id, String(b.year));
      for (const m of b.months?.length ? [...new Set(b.months)].sort((x, y) => x - y) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
        const monthId = await ensure(yearId, `${p2(m)} ${THAI_MONTHS[m - 1]}`);
        if (b.days) for (let d = 1; d <= new Date(b.year, m, 0).getDate(); d++) await ensure(monthId, p2(d));
      }
      await audit({ userId: u.id, action: 'folder_create', entityType: 'folder', entityId: id, newValue: { dateTree: b.year, days: b.days, made } }, req, tx);
    });
    invalidateFolders();
    ok(res, { made });
  }),
);

export default router;
