import { Router } from 'express';
import { z } from 'zod';
import { q, q1, T, withTx } from '../config/db';
import { isAdminRole, requireRole } from '../middleware/auth';
import { audit } from '../shared/audit';
import { ah, badRequest, forbidden, notFound, ok, parse, pid, zId } from '../shared/http';
import { invalidateFolders } from '../shared/permissions';
import { purgeFile, purgeFolder } from '../services/purge';
import { env } from '../config/env';

const router = Router();

router.get(
  '/trash',
  ah(async (req, res) => {
    const u = req.user!;
    const mine = isAdminRole(u.role) ? '' : 'AND (x.deleted_by = @u OR x.created_by = @u)';
    const folders = await q(
      `SELECT x.folder_id, x.folder_name, x.color, x.deleted_at, x.created_by, d.display_name AS deleted_by_name,
         (SELECT COUNT(*) FROM Files fi WHERE fi.delete_batch = x.delete_batch) AS file_count
       FROM Folders x LEFT JOIN Users d ON d.user_id = x.deleted_by
       WHERE x.is_deleted = 1 ${mine}
         AND NOT EXISTS (SELECT 1 FROM Folders p WHERE p.folder_id = x.parent_id AND p.is_deleted = 1 AND p.delete_batch = x.delete_batch)
       ORDER BY x.deleted_at DESC`,
      { u: T.uuid(u.id) },
    );
    const files = await q(
      `SELECT x.file_id, x.file_name, x.color, x.deleted_at, x.created_by, fo.folder_name, fo.is_deleted AS folder_deleted,
         d.display_name AS deleted_by_name
       FROM Files x JOIN Folders fo ON fo.folder_id = x.folder_id LEFT JOIN Users d ON d.user_id = x.deleted_by
       WHERE x.is_deleted = 1 ${mine}
         AND NOT (fo.is_deleted = 1 AND fo.delete_batch = x.delete_batch)
       ORDER BY x.deleted_at DESC`,
      { u: T.uuid(u.id) },
    );
    const purgeAt = (d: Date) => new Date(new Date(d).getTime() + env.trashRetentionDays * 86400_000);
    ok(res, {
      retentionDays: env.trashRetentionDays,
      items: [
        ...folders.map((f) => ({ type: 'folder', id: f.folder_id, name: f.folder_name, color: f.color, deletedAt: f.deleted_at,
          deletedByName: f.deleted_by_name, purgeAt: purgeAt(f.deleted_at), detail: `${Number(f.file_count)} ไฟล์ภายใน` })),
        ...files.map((f) => ({ type: 'file', id: f.file_id, name: f.file_name, color: f.color, deletedAt: f.deleted_at,
          deletedByName: f.deleted_by_name, purgeAt: purgeAt(f.deleted_at), detail: `จากโฟลเดอร์ ${f.folder_name}`, blocked: !!f.folder_deleted })),
      ].sort((a, b) => +new Date(b.deletedAt) - +new Date(a.deletedAt)),
    });
  }),
);

router.post(
  '/trash/restore',
  ah(async (req, res) => {
    const u = req.user!;
    const { type, id } = parse(z.object({ type: z.enum(['file', 'folder']), id: zId }), req.body);
    if (type === 'folder') {
      const f = await q1(`SELECT * FROM Folders WHERE folder_id = @id AND is_deleted = 1`, { id: T.uuid(id) });
      if (!f) throw notFound('ไม่พบรายการในถังขยะ');
      if (!isAdminRole(u.role) && f.deleted_by !== u.id && f.created_by !== u.id) throw forbidden();
      await withTx(async (tx) => {
        const parent = f.parent_id ? await q1(`SELECT is_deleted FROM Folders WHERE folder_id = @p`, { p: T.uuid(f.parent_id) }, tx) : null;
        if (parent?.is_deleted) await q(`UPDATE Folders SET parent_id = NULL WHERE folder_id = @id`, { id: T.uuid(id) }, tx);
        await q(`UPDATE Folders SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, delete_batch = NULL WHERE delete_batch = @b`, { b: T.uuid(f.delete_batch) }, tx);
        await q(`UPDATE Files SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, delete_batch = NULL WHERE delete_batch = @b`, { b: T.uuid(f.delete_batch) }, tx);
        await audit({ userId: u.id, action: 'folder_restore', entityType: 'folder', entityId: id, newValue: { name: f.folder_name, movedToRoot: !!parent?.is_deleted } }, req, tx);
      });
      invalidateFolders();
    } else {
      const f = await q1(`SELECT x.*, fo.is_deleted AS folder_deleted, fo.folder_name FROM Files x JOIN Folders fo ON fo.folder_id = x.folder_id
        WHERE x.file_id = @id AND x.is_deleted = 1`, { id: T.uuid(id) });
      if (!f) throw notFound('ไม่พบรายการในถังขยะ');
      if (!isAdminRole(u.role) && f.deleted_by !== u.id && f.created_by !== u.id) throw forbidden();
      if (f.folder_deleted) throw badRequest(`โฟลเดอร์ "${f.folder_name}" ถูกลบอยู่ กรุณากู้คืนโฟลเดอร์ก่อน`);
      await q(`UPDATE Files SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, delete_batch = NULL WHERE file_id = @id`, { id: T.uuid(id) });
      await audit({ userId: u.id, action: 'file_restore', entityType: 'file', entityId: id, fileId: id, newValue: { name: f.file_name } }, req);
    }
    ok(res, { restored: true });
  }),
);

router.delete(
  '/trash/:type/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = pid(req);
    const type = req.params.type;
    if (type !== 'file' && type !== 'folder') throw badRequest('ชนิดรายการไม่ถูกต้อง');
    const row = type === 'file'
      ? await q1(`SELECT file_name AS name FROM Files WHERE file_id = @id AND is_deleted = 1`, { id: T.uuid(id) })
      : await q1(`SELECT folder_name AS name FROM Folders WHERE folder_id = @id AND is_deleted = 1`, { id: T.uuid(id) });
    if (!row) throw notFound('ไม่พบรายการในถังขยะ');
    await withTx((tx) => (type === 'file' ? purgeFile(tx, id) : purgeFolder(tx, id)));
    await audit({ userId: req.user!.id, action: `${type}_purge`, entityType: type, entityId: id, oldValue: { name: row.name } }, req);
    ok(res, { purged: true });
  }),
);

export default router;
