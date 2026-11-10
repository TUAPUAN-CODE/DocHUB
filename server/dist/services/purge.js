"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeFile = purgeFile;
exports.purgeFolder = purgeFolder;
exports.purgeExpiredTrash = purgeExpiredTrash;
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const logger_1 = require("../shared/logger");
const permissions_1 = require("../shared/permissions");
/** Permanently removes a file and everything that belongs to it (explicit order, no cascades). */
async function purgeFile(tx, fileId) {
    const f = { f: db_1.T.uuid(fileId) };
    await (0, db_1.q)(`DECLARE @sheets TABLE (id UNIQUEIDENTIFIER PRIMARY KEY);
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
     DELETE FROM AccessRequests WHERE file_id = @f;
     DELETE FROM Favorites WHERE entity_type = 'file' AND entity_id = @f;
     DELETE FROM RecentFiles WHERE file_id = @f;
     DELETE FROM Files WHERE file_id = @f;`, f, tx);
}
/** Permanently removes a folder subtree including all files inside. */
async function purgeFolder(tx, folderId) {
    const tree = await (0, db_1.q)(`;WITH t AS (
       SELECT folder_id, 0 AS depth FROM Folders WHERE folder_id = @f
       UNION ALL
       SELECT c.folder_id, t.depth + 1 FROM Folders c JOIN t ON c.parent_id = t.folder_id
     ) SELECT folder_id, depth FROM t OPTION (MAXRECURSION 100)`, { f: db_1.T.uuid(folderId) }, tx);
    const ids = tree.map((t) => t.folder_id);
    const files = await (0, db_1.q)(`SELECT file_id FROM Files WHERE folder_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`, { ids: db_1.T.text(JSON.stringify(ids)) }, tx);
    for (const file of files)
        await purgeFile(tx, file.file_id);
    for (const node of tree.sort((a, b) => b.depth - a.depth)) {
        await (0, db_1.q)(`DELETE FROM FolderAccess WHERE folder_id = @f;
       DELETE FROM AccessRequests WHERE folder_id = @f;
       DELETE FROM Favorites WHERE entity_type = 'folder' AND entity_id = @f;
       DELETE FROM Folders WHERE folder_id = @f;`, { f: db_1.T.uuid(node.folder_id) }, tx);
    }
    (0, permissions_1.invalidateFolders)();
}
/** Deletes trash older than TRASH_RETENTION_DAYS. Safe to run repeatedly. */
async function purgeExpiredTrash() {
    try {
        const days = env_1.env.trashRetentionDays;
        const folders = await (0, db_1.q)(`SELECT f.folder_id FROM Folders f
       WHERE f.is_deleted = 1 AND f.deleted_at < DATEADD(DAY, -@d, SYSUTCDATETIME())
         AND (f.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM Folders p WHERE p.folder_id = f.parent_id AND p.is_deleted = 1))`, { d: days });
        for (const f of folders)
            await (0, db_1.withTx)((tx) => purgeFolder(tx, f.folder_id));
        const files = await (0, db_1.q)(`SELECT file_id FROM Files WHERE is_deleted = 1 AND deleted_at < DATEADD(DAY, -@d, SYSUTCDATETIME())`, { d: days });
        for (const f of files)
            await (0, db_1.withTx)((tx) => purgeFile(tx, f.file_id));
        if (folders.length || files.length)
            logger_1.logger.info(`Trash purge: ${folders.length} folders, ${files.length} files removed permanently`);
    }
    catch (e) {
        logger_1.logger.error(`Trash purge failed: ${e?.message}`);
    }
}
//# sourceMappingURL=purge.js.map