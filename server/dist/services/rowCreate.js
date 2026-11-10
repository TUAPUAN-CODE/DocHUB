"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRowTx = createRowTx;
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const cellValue_1 = require("../shared/cellValue");
const http_1 = require("../shared/http");
const cellWriter_1 = require("./cellWriter");
const docNumber_1 = require("./docNumber");
const hooks_1 = require("./hooks");
const lookup_1 = require("./lookup");
void cellValue_1.normalizeValue;
void lookup_1.getLookup;
/**
 * Creates one row inside the caller's transaction, with the same rules as POST /sheets/:id/rows
 * (validation, relationship lists, auto document numbers, formula columns). Used by modules that make rows as a side effect
 * (scan, mix). `values` is keyed by column id.
 */
async function createRowTx(tx, user, sheet, sheetId, values, source, req) {
    const cols = await (0, cellWriter_1.loadColumns)(sheetId, tx);
    const lowered = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
    const fieldErrors = {};
    const toWrite = [];
    const resolve = (0, lookup_1.lookupResolver)();
    const rawAll = Object.fromEntries(cols.map((c) => [c.column_id, c.column_id in lowered ? lowered[c.column_id] : (0, http_1.safeJson)(c.default_value, null)]));
    const docGen = [];
    for (const c of cols) {
        const def = (0, cellValue_1.toColumnDef)(c);
        if ((0, hooks_1.columnWriteBlockedReason)(def, 'create'))
            continue;
        let raw = rawAll[c.column_id];
        const dc = (0, docNumber_1.getDocCfg)(def);
        if (dc) {
            const r = (0, docNumber_1.interpretDocRaw)(def, dc, raw, await (0, docNumber_1.docPrefixes)(dc), 'create');
            if (!r.ok) {
                fieldErrors[c.column_id] = r.error;
                continue;
            }
            if (r.kind === 'generate') {
                docGen.push({ def, cfg: dc, prefix: r.prefix, date: (0, docNumber_1.docDate)(dc, rawAll) });
                continue;
            }
            raw = r.value;
        }
        const n = await (0, lookup_1.normalizeWithLookup)(def, raw, await (0, lookup_1.parentValueOf)(def, rawAll), resolve);
        if (!n.ok)
            fieldErrors[c.column_id] = n.error;
        else if (n.value !== null)
            toWrite.push({ col: def, value: n.value });
    }
    if (Object.keys(fieldErrors).length)
        throw (0, http_1.badRequest)(Object.values(fieldErrors)[0], { fields: fieldErrors });
    const o = await (0, db_1.q1)(`SELECT ISNULL(MAX(row_order), 0) + 1 AS o FROM Rows WITH (UPDLOCK, HOLDLOCK) WHERE sheet_id = @s`, { s: db_1.T.uuid(sheetId) }, tx);
    const r = await (0, db_1.q1)(`INSERT INTO Rows (sheet_id, row_order, created_by, updated_by) OUTPUT inserted.row_id VALUES (@s, @o, @u, @u)`, { s: db_1.T.uuid(sheetId), o: db_1.T.int(o.o), u: db_1.T.uuid(user.id) }, tx);
    for (const g of docGen) {
        const [num] = await (0, docNumber_1.nextDocNumbers)(tx, sheetId, g.def, g.cfg, [{ prefix: g.prefix, date: g.date }]);
        toWrite.push({ col: g.def, value: num });
    }
    for (const w of toWrite)
        await (0, cellWriter_1.writeCell)(tx, { sheetId, rowId: r.row_id, col: w.col, value: w.value, userId: user.id, source });
    await (0, hooks_1.runAfterCellsWritten)({ tx, user, sheetId, rowIds: [r.row_id], source });
    await (0, audit_1.audit)({ userId: user.id, action: 'row_create', entityType: 'row', entityId: r.row_id, fileId: sheet.file_id, sheetId,
        newValue: { rowNo: o.o, via: source, values: Object.fromEntries(toWrite.map((w) => [w.col.column_name, w.value])) } }, req, tx);
    return { rowId: r.row_id, rowNo: Number(o.o) };
}
//# sourceMappingURL=rowCreate.js.map