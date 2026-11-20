"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bulkSupported = bulkSupported;
exports.bulkCreateRowsTx = bulkCreateRowsTx;
const sheetSettings_1 = require("./sheetSettings");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const cellValue_1 = require("../shared/cellValue");
const http_1 = require("../shared/http");
const cellWriter_1 = require("./cellWriter");
const docNumber_1 = require("./docNumber");
const hooks_1 = require("./hooks");
const lookup_1 = require("./lookup");
/**
 * Many new rows in one go (same insert as the file import POST /sheets/:id/rows/import: rows, cells and their first history in a few
 * statements, then the formula / after-write hooks once). For big automatic pulls (connectors); one row at a time is ~40 statements.
 * Rows that do not pass validation are returned in `invalid` (not inserted). Sheets with auto document-number columns are not handled
 * here (`supported` = false): the caller creates those rows one by one.
 */
async function bulkSupported(sheetId, tx) {
    const cols = await (0, cellWriter_1.loadColumns)(sheetId, tx);
    return !cols.some((c) => (0, docNumber_1.getDocCfg)((0, cellValue_1.toColumnDef)(c)));
}
async function bulkCreateRowsTx(tx, user, sheet, sheetId, list, source) {
    const cols = await (0, cellWriter_1.loadColumns)(sheetId, tx);
    const resolve = (0, lookup_1.lookupResolver)();
    const valid = [];
    const invalid = [];
    for (const [index, values] of list.entries()) {
        const lowered = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
        const rawAll = Object.fromEntries(cols.map((c) => [c.column_id, c.column_id in lowered ? lowered[c.column_id] : (0, http_1.safeJson)(c.default_value, null)]));
        const cells = [];
        let bad = null;
        for (const c of cols) {
            const def = (0, cellValue_1.toColumnDef)(c);
            if ((0, hooks_1.columnWriteBlockedReason)(def, 'create'))
                continue;
            const n = await (0, lookup_1.normalizeWithLookup)(def, rawAll[def.column_id], await (0, lookup_1.parentValueOf)(def, rawAll), resolve);
            if (!n.ok) {
                bad = `${def.column_name}: ${n.error}`;
                break;
            }
            if (n.value !== null)
                cells.push({ def, value: n.value });
        }
        if (bad)
            invalid.push({ index, message: bad });
        else
            valid.push({ cells });
    }
    if (!valid.length)
        return { inserted: 0, invalid };
    const o = await (0, db_1.q1)(`SELECT ISNULL(MAX(row_order), 0) AS o FROM Rows WITH (UPDLOCK, HOLDLOCK) WHERE sheet_id = @s`, { s: db_1.T.uuid(sheetId) }, tx);
    const start = Number(o?.o ?? 0);
    const rowsJson = [];
    const cellsJson = [];
    const histJson = [];
    valid.forEach((v, i) => {
        const rowId = crypto_1.default.randomUUID();
        rowsJson.push({ row_id: rowId, ord: start + i + 1 });
        for (const c of v.cells) {
            const cellId = crypto_1.default.randomUUID();
            cellsJson.push({ cell_id: cellId, row_id: rowId, column_id: c.def.column_id, ...(0, cellValue_1.toStorage)(c.def.data_type, c.value) });
            histJson.push({ cell_id: cellId, row_id: rowId, column_id: c.def.column_id, nv: JSON.stringify(c.value) });
        }
    });
    await (0, sheetSettings_1.assertRowRoom)(sheetId, valid.length, tx);
    await (0, db_1.q)(`INSERT INTO Rows (row_id, sheet_id, row_order, created_by, updated_by)
           SELECT row_id, @s, ord, @u, @u FROM OPENJSON(@j) WITH (row_id UNIQUEIDENTIFIER, ord INT)`, { s: db_1.T.uuid(sheetId), u: db_1.T.uuid(user.id), j: db_1.T.text(JSON.stringify(rowsJson)) }, tx);
    for (let i = 0; i < cellsJson.length; i += 2000) {
        await (0, db_1.q)(`INSERT INTO Cells (cell_id, row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, updated_by)
             SELECT cell_id, row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, @u
             FROM OPENJSON(@j) WITH (cell_id UNIQUEIDENTIFIER, row_id UNIQUEIDENTIFIER, column_id UNIQUEIDENTIFIER, value_text NVARCHAR(MAX),
               value_int BIGINT, value_float FLOAT, value_date DATETIME2, value_bool BIT, value_json NVARCHAR(MAX))`, { u: db_1.T.uuid(user.id), j: db_1.T.text(JSON.stringify(cellsJson.slice(i, i + 2000))) }, tx);
        await (0, db_1.q)(`INSERT INTO CellHistory (cell_id, sheet_id, row_id, column_id, old_value, new_value, change_source, changed_by, version_number)
             SELECT cell_id, @s, row_id, column_id, NULL, nv, @src, @u, 1
             FROM OPENJSON(@j) WITH (cell_id UNIQUEIDENTIFIER, row_id UNIQUEIDENTIFIER, column_id UNIQUEIDENTIFIER, nv NVARCHAR(MAX))`, { s: db_1.T.uuid(sheetId), u: db_1.T.uuid(user.id), src: db_1.T.text(source), j: db_1.T.text(JSON.stringify(histJson.slice(i, i + 2000))) }, tx);
    }
    await (0, hooks_1.runAfterCellsWritten)({ tx, user, sheetId, rowIds: rowsJson.map((r) => r.row_id), source });
    await (0, audit_1.audit)({ userId: user.id, action: 'rows_import', entityType: 'sheet', entityId: sheetId, fileId: sheet.file_id, sheetId,
        newValue: { rows: valid.length, firstRowNo: start + 1, via: source } }, undefined, tx);
    return { inserted: valid.length, invalid };
}
//# sourceMappingURL=rowBulk.js.map