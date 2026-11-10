"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planRollback = planRollback;
exports.applyRollback = applyRollback;
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const cellValue_1 = require("../shared/cellValue");
const http_1 = require("../shared/http");
const socket_1 = require("../socket");
const cellWriter_1 = require("./cellWriter");
/**
 * Point-in-time plan: for every cell changed after `at`, the old_value of the first change
 * after `at` is exactly the value it had at `at`. Rows created after `at` are soft-deleted;
 * rows deleted after `at` (that existed at `at`) are restored. Structure (columns) is not changed.
 */
async function planRollback(sheetId, at, rowId, tx) {
    const params = { s: db_1.T.uuid(sheetId), at: db_1.T.dt(at) };
    let rowFilter = '';
    if (rowId) {
        params.r = db_1.T.uuid(rowId);
        rowFilter = 'AND h.row_id = @r';
    }
    const cells = await (0, db_1.q)(`;WITH firstAfter AS (
       SELECT h.row_id, h.column_id, h.old_value,
              ROW_NUMBER() OVER (PARTITION BY h.cell_id ORDER BY h.changed_at ASC, h.history_id ASC) AS rn
       FROM CellHistory h
       WHERE h.sheet_id = @s AND h.changed_at > @at ${rowFilter}
     )
     SELECT fa.row_id, fa.column_id, fa.old_value FROM firstAfter fa
     JOIN Rows r ON r.row_id = fa.row_id
     WHERE fa.rn = 1 AND r.created_at <= @at`, params, tx);
    const rowParams = { s: db_1.T.uuid(sheetId), at: db_1.T.dt(at) };
    let rf = '';
    if (rowId) {
        rowParams.r = db_1.T.uuid(rowId);
        rf = 'AND row_id = @r';
    }
    const toDelete = rowId
        ? []
        : await (0, db_1.q)(`SELECT row_id FROM Rows WHERE sheet_id = @s AND is_deleted = 0 AND created_at > @at`, rowParams, tx);
    const toRestore = await (0, db_1.q)(`SELECT row_id FROM Rows WHERE sheet_id = @s AND is_deleted = 1 AND deleted_at > @at AND created_at <= @at ${rf}`, rowParams, tx);
    return {
        at,
        cellChanges: cells.map((c) => ({
            rowId: c.row_id,
            columnId: c.column_id,
            value: (0, http_1.safeJson)(c.old_value, null),
        })),
        rowsToDelete: toDelete.map((r) => r.row_id),
        rowsToRestore: toRestore.map((r) => r.row_id),
    };
}
async function applyRollback(user, sheet, plan, meta) {
    const cols = await (0, cellWriter_1.loadColumns)(sheet.sheet_id, null, true);
    const colMap = new Map(cols.map((c) => [c.column_id, (0, cellValue_1.toColumnDef)(c)]));
    const result = await (0, db_1.withTx)(async (tx) => {
        let changed = 0;
        for (const id of plan.rowsToRestore) {
            await (0, db_1.q)(`UPDATE Rows SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, updated_at = SYSUTCDATETIME(),
               updated_by = @u WHERE row_id = @r`, { r: db_1.T.uuid(id), u: db_1.T.uuid(user.id) }, tx);
        }
        for (const c of plan.cellChanges) {
            const col = colMap.get(c.columnId);
            if (!col)
                continue;
            const n = (0, cellValue_1.normalizeValue)(col, c.value, { skipRequired: true });
            const value = n.ok ? n.value : null;
            const r = await (0, cellWriter_1.writeCell)(tx, {
                sheetId: sheet.sheet_id,
                rowId: c.rowId,
                col,
                value,
                userId: user.id,
                source: 'rollback',
            });
            if (r.changed)
                changed++;
        }
        for (const id of plan.rowsToDelete) {
            await (0, db_1.q)(`UPDATE Rows SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @u WHERE row_id = @r`, { r: db_1.T.uuid(id), u: db_1.T.uuid(user.id) }, tx);
        }
        await (0, audit_1.auditMany)([
            {
                userId: user.id,
                action: meta.scope === 'sheet' ? 'sheet_rollback' : 'row_rollback',
                entityType: meta.scope,
                entityId: meta.rowId ?? sheet.sheet_id,
                fileId: sheet.file_id,
                sheetId: sheet.sheet_id,
                newValue: {
                    at: plan.at.toISOString(),
                    reason: meta.reason ?? null,
                    cellsChanged: changed,
                    rowsDeleted: plan.rowsToDelete.length,
                    rowsRestored: plan.rowsToRestore.length,
                },
            },
        ], meta.req, tx);
        return { cellsChanged: changed, rowsDeleted: plan.rowsToDelete.length, rowsRestored: plan.rowsToRestore.length };
    });
    (0, socket_1.emitToSheet)(sheet.sheet_id, 'rows:changed', { sheetId: sheet.sheet_id, action: 'rollback', by: user.displayName }, (0, http_1.reqMeta)(meta.req).socketId);
    return result;
}
//# sourceMappingURL=rollback.js.map