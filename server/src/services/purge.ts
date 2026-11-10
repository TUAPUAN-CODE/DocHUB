import { q, T, Tx, withTx } from '../config/db';
import { env } from '../config/env';
import { logger } from '../shared/logger';
import { invalidateFolders } from '../shared/permissions';

/** Permanently removes a file and everything that belongs to it (explicit order, no cascades). */
export async function purgeFile(tx: Tx, fileId: string) {
  const f = { f: T.uuid(fileId) };
  await q(
    `DECLARE @sheets TABLE (id UNIQUEIDENTIFIER PRIMARY KEY);
     INSERT INTO @sheets SELECT sheet_id FROM Sheets WHERE file_id = @f;
     DELETE FROM CellHistory WHERE sheet_id IN (SELECT id FROM @sheets);
     DELETE c FROM Cells c JOIN Rows r ON r.row_id = c.row_id WHERE r.sheet_id IN (SELECT id FROM @sheets);
     DELETE FROM RowSnapshots WHERE sheet_id IN (SELECT id FROM @sheets);
     DELETE FROM Rows WHERE sheet_id IN (SELECT id FROM @sheets);
     DELETE FROM Columns WHERE sheet_id IN (SELECT id FROM @sheets);
     DELETE FROM UserSheetPrefs WHERE sheet_id IN (SELECT id FROM @sheets);
     DELETE FROM Sheets WHERE file_id = @f;
     DELETE w FROM DashboardWidgets w JOIN Dashboards d ON d.dashboard_id = w.dashboard_id WHERE d.file_id = @f;
     DELETE FROM Dashboards WHERE file_id = @f;
     DELETE FROM FileAccess WHERE file_id = @f;
     DELETE FROM FileTagAccess WHERE file_id = @f;
     DELETE FROM AccessRequests WHERE file_id = @f;
     DELETE FROM Favorites WHERE entity_type = 'file' AND entity_id = @f;
     DELETE FROM RecentFiles WHERE file_id = @f;
     DELETE FROM Files WHERE file_id = @f;`,
    f,
    tx,
  );
}

/** Permanently removes a folder subtree including all files inside. */
export async function purgeFolder(tx: Tx, folderId: string) {
  const tree = await q(
    `;WITH t AS (
       SELECT folder_id, 0 AS depth FROM Folders WHERE folder_id = @f
       UNION ALL
       SELECT c.folder_id, t.depth + 1 FROM Folders c JOIN t ON c.parent_id = t.folder_id
     ) SELECT folder_id, depth FROM t OPTION (MAXRECURSION 100)`,
    { f: T.uuid(folderId) },
    tx,
  );
  const ids = tree.map((t) => t.folder_id);
  const files = await q(
    `SELECT file_id FROM Files WHERE folder_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`,
    { ids: T.text(JSON.stringify(ids)) },
    tx,
  );
  for (const file of files) await purgeFile(tx, file.file_id);
  for (const node of tree.sort((a, b) => b.depth - a.depth)) {
    await q(
      `DELETE FROM FolderAccess WHERE folder_id = @f;
       DELETE FROM FolderTagAccess WHERE folder_id = @f;
       DELETE FROM AccessRequests WHERE folder_id = @f;
       DELETE FROM Favorites WHERE entity_type = 'folder' AND entity_id = @f;
       DELETE FROM Folders WHERE folder_id = @f;`,
      { f: T.uuid(node.folder_id) },
      tx,
    );
  }
  invalidateFolders();
}

/** Deletes trash older than TRASH_RETENTION_DAYS. Safe to run repeatedly. */
export async function purgeExpiredTrash() {
  try {
    const days = env.trashRetentionDays;
    const folders = await q(
      `SELECT f.folder_id FROM Folders f
       WHERE f.is_deleted = 1 AND f.deleted_at < DATEADD(DAY, -@d, SYSUTCDATETIME())
         AND (f.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM Folders p WHERE p.folder_id = f.parent_id AND p.is_deleted = 1))`,
      { d: days },
    );
    for (const f of folders) await withTx((tx) => purgeFolder(tx, f.folder_id));
    const files = await q(
      `SELECT file_id FROM Files WHERE is_deleted = 1 AND deleted_at < DATEADD(DAY, -@d, SYSUTCDATETIME())`,
      { d: days },
    );
    for (const f of files) await withTx((tx) => purgeFile(tx, f.file_id));
    if (folders.length || files.length)
      logger.info(`Trash purge: ${folders.length} folders, ${files.length} files removed permanently`);
  } catch (e: any) {
    logger.error(`Trash purge failed: ${e?.message}`);
  }
}
