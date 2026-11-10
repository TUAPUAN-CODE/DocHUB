"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAMP_TYPES = void 0;
exports.stampOf = stampOf;
exports.stampValue = stampValue;
const env_1 = require("../../config/env");
const db_1 = require("../../config/db");
const hooks_1 = require("../../services/hooks");
const cellWriter_1 = require("../../services/cellWriter");
const cellValue_1 = require("../../shared/cellValue");
const http_1 = require("../../shared/http");
exports.STAMP_TYPES = { updatedAt: ['date', 'datetime'], updatedBy: ['varchar', 'text'] };
function stampOf(col) {
    const v = typeof col.validation === 'string' ? (0, http_1.safeJson)(col.validation, {}) : col.validation;
    const k = v?.autoStamp;
    return (k === 'updatedAt' || k === 'updatedBy') && exports.STAMP_TYPES[k].includes(col.data_type) ? k : null;
}
/** sources that bring values from elsewhere (or are the stamp itself): they never stamp, and may write the stamp columns */
const PASSIVE = new Set(['import', 'rollback', 'type_change', 'connector', 'formula', 'stamp']);
/** Today in the app's time zone (YYYY-MM-DD), or now for a date-time column */
function stampValue(kind, dataType, user, now = new Date()) {
    if (kind === 'updatedBy')
        return user.displayName;
    if (dataType === 'datetime')
        return now.toISOString();
    return new Date(now.getTime() + env_1.env.tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}
(0, hooks_1.registerColumnGuard)((col, source) => (stampOf(col) && !PASSIVE.has(source) ? 'คอลัมน์นี้ระบบเติมให้อัตโนมัติเมื่อมีการแก้ไขแถว' : null));
(0, hooks_1.registerAfterCellsWritten)(async (ctx) => {
    if (PASSIVE.has(ctx.source) || !ctx.rowIds.length)
        return [];
    const cols = (await (0, cellWriter_1.loadColumns)(ctx.sheetId, ctx.tx)).map(cellValue_1.toColumnDef).filter((c) => stampOf(c));
    if (!cols.length)
        return [];
    const ids = [...new Set(ctx.rowIds.map((r) => r.toLowerCase()))];
    const rows = await (0, db_1.q)(`SELECT row_id, row_order FROM Rows WHERE row_id IN ${(0, db_1.idList)('@ids')} AND is_deleted = 0`, { ids: (0, db_1.jsonParam)(ids) }, ctx.tx);
    const now = new Date();
    const out = [];
    for (const r of rows) {
        for (const col of cols) {
            const n = (0, cellValue_1.normalizeValue)(col, stampValue(stampOf(col), col.data_type, ctx.user, now), { skipRequired: true });
            if (!n.ok)
                continue;
            const w = await (0, cellWriter_1.writeCell)(ctx.tx, { sheetId: ctx.sheetId, rowId: r.row_id, col, value: n.value, userId: ctx.user.id, source: 'stamp' });
            if (w.changed)
                out.push({ rowId: r.row_id, columnId: col.column_id, rowNo: r.row_order, columnName: col.column_name, oldValue: w.oldValue, newValue: w.newValue, historyId: w.historyId, at: w.at });
        }
    }
    return out;
});
exports.default = {};
//# sourceMappingURL=module.js.map