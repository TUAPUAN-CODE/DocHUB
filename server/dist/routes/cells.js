"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const cellWriter_1 = require("../services/cellWriter");
const router = (0, express_1.Router)();
router.put('/rows/:rowId/cells/:columnId', (0, http_1.ah)(async (req, res) => {
    const rowId = (0, http_1.pid)(req, 'rowId');
    const columnId = (0, http_1.pid)(req, 'columnId');
    const { value } = (0, http_1.parse)(zod_1.z.object({ value: zod_1.z.any() }), req.body);
    const row = await (0, db_1.q1)(`SELECT sheet_id FROM Rows WHERE row_id = @r AND is_deleted = 0`, { r: db_1.T.uuid(rowId) });
    if (!row)
        throw (0, http_1.notFound)('ไม่พบแถว (อาจถูกลบแล้ว)');
    const result = await (0, cellWriter_1.applyCellUpdates)(req.user, row.sheet_id, [{ rowId, columnId, value }], { req });
    const mine = result.updated.find((u) => u.rowId === rowId && u.columnId === columnId);
    // `derived` = cells a module (e.g. formula columns) recalculated because of this edit
    const derived = result.updated.filter((u) => u !== mine);
    (0, http_1.ok)(res, { ...(mine ?? { rowId, columnId, unchanged: true }), ...(derived.length ? { derived } : {}) });
}));
router.post('/sheets/:id/cells/bulk', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const body = (0, http_1.parse)(zod_1.z.object({
        updates: zod_1.z.array(zod_1.z.object({ rowId: http_1.zId, columnId: http_1.zId, value: zod_1.z.any() })).min(1).max(5000),
        partial: zod_1.z.boolean().default(false),
        source: zod_1.z.enum(['edit', 'paste', 'undo', 'fill']).default('edit'),
    }), req.body);
    (0, http_1.ok)(res, await (0, cellWriter_1.applyCellUpdates)(req.user, sheetId, body.updates, { req, partial: body.partial, source: body.source }));
}));
router.get('/cells/history', (0, http_1.ah)(async (req, res) => {
    const { rowId, columnId } = (0, http_1.parse)(zod_1.z.object({ rowId: http_1.zId, columnId: http_1.zId }), req.query);
    const row = await (0, db_1.q1)(`SELECT sheet_id, row_order FROM Rows WHERE row_id = @r`, { r: db_1.T.uuid(rowId) });
    if (!row)
        throw (0, http_1.notFound)('ไม่พบแถว');
    const { level } = await (0, permissions_1.requireSheet)(req.user, row.sheet_id, permissions_1.LV.read);
    const col = await (0, db_1.q1)(`SELECT column_name, data_type, select_options FROM Columns WHERE column_id = @c`, { c: db_1.T.uuid(columnId) });
    const rows = await (0, db_1.q)(`SELECT TOP 200 h.history_id, h.old_value, h.new_value, h.change_source, h.changed_by, u.display_name, u.avatar_url,
         h.changed_at, h.version_number
       FROM CellHistory h JOIN Users u ON u.user_id = h.changed_by
       WHERE h.row_id = @r AND h.column_id = @c ORDER BY h.history_id DESC`, { r: db_1.T.uuid(rowId), c: db_1.T.uuid(columnId) });
    (0, http_1.ok)(res, {
        column: col ? { name: col.column_name, dataType: col.data_type, options: (0, http_1.safeJson)(col.select_options, []) } : null,
        rowNo: row.row_order,
        canRollback: level >= permissions_1.LV.manage,
        versions: rows.map((h) => ({
            id: Number(h.history_id), oldValue: (0, http_1.safeJson)(h.old_value, null), newValue: (0, http_1.safeJson)(h.new_value, null),
            source: h.change_source, by: h.changed_by, byName: h.display_name, avatarUrl: h.avatar_url, at: h.changed_at, version: h.version_number,
        })),
    });
}));
router.post('/cells/rollback', (0, http_1.ah)(async (req, res) => {
    const { historyId, target } = (0, http_1.parse)(zod_1.z.object({ historyId: zod_1.z.number().int().positive(), target: zod_1.z.enum(['new', 'old']).default('new') }), req.body);
    const h = await (0, db_1.q1)(`SELECT h.*, r.is_deleted AS row_deleted FROM CellHistory h JOIN Rows r ON r.row_id = h.row_id WHERE h.history_id = @h`, { h: db_1.T.bigint(historyId) });
    if (!h)
        throw (0, http_1.notFound)('ไม่พบประวัติเวอร์ชันนี้');
    if (h.row_deleted)
        throw (0, http_1.badRequest)('แถวนี้ถูกลบแล้ว กรุณากู้คืนแถวก่อน');
    const value = (0, http_1.safeJson)(target === 'new' ? h.new_value : h.old_value, null);
    const result = await (0, cellWriter_1.applyCellUpdates)(req.user, h.sheet_id, [{ rowId: h.row_id, columnId: h.column_id, value }], {
        req, source: 'rollback', skipRequired: true, minLevel: permissions_1.LV.manage, auditAction: 'cell_rollback',
    });
    (0, http_1.ok)(res, result.updated[0] ?? { rowId: h.row_id, columnId: h.column_id, value, unchanged: true });
}));
exports.default = router;
//# sourceMappingURL=cells.js.map