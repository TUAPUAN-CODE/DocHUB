"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const audit_1 = require("../shared/audit");
const crypto_1 = __importDefault(require("crypto"));
const cellValue_1 = require("../shared/cellValue");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const schemas_1 = require("../shared/schemas");
const cellWriter_1 = require("../services/cellWriter");
const hooks_1 = require("../services/hooks");
const rollback_1 = require("../services/rollback");
const rowQuery_1 = require("../services/rowQuery");
const docNumber_1 = require("../services/docNumber");
const lookup_1 = require("../services/lookup");
const socket_1 = require("../socket");
const router = (0, express_1.Router)();
const querySchema = zod_1.z.object({
    page: zod_1.z.number().int().min(1).default(1),
    pageSize: zod_1.z.number().int().min(1).max(1000).default(100),
    sorts: zod_1.z.array(schemas_1.sortSchema).max(5).default([]),
    filters: zod_1.z.array(schemas_1.filterSchema).max(50).default([]),
    search: zod_1.z.string().max(200).optional(),
    searchColumns: zod_1.z.array(http_1.zId).max(20).optional(),
    rowIds: zod_1.z.array(http_1.zId).max(200).optional(),
});
router.post('/sheets/:id/rows/query', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read);
    const body = (0, http_1.parse)(querySchema, req.body ?? {});
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    (0, http_1.ok)(res, await (0, rowQuery_1.queryRows)(sheetId, cols, body));
}));
router.post('/sheets/:id/distinct', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read);
    const body = (0, http_1.parse)(zod_1.z.object({
        columnId: http_1.zId,
        filters: zod_1.z.array(schemas_1.filterSchema).max(50).default([]),
        search: zod_1.z.string().max(200).optional(),
        valueSearch: zod_1.z.string().max(200).optional(),
        limit: zod_1.z.number().int().min(1).max(2000).default(500),
    }), req.body);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    (0, http_1.ok)(res, await (0, rowQuery_1.distinctValues)(sheetId, cols, body.columnId, body));
}));
router.post('/sheets/:id/rows', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const u = req.user;
    const { sheet } = await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.write);
    const { values } = (0, http_1.parse)(zod_1.z.object({ values: zod_1.z.record(zod_1.z.any()).default({}) }), req.body);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const lowered = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
    const fieldErrors = {};
    const toWrite = [];
    const resolve = (0, lookup_1.lookupResolver)();
    const rawAll = Object.fromEntries(cols.map((c) => [c.column_id, c.column_id in lowered ? lowered[c.column_id] : (0, http_1.safeJson)(c.default_value, null)]));
    const docGen = [];
    for (const c of cols) {
        const def = (0, cellValue_1.toColumnDef)(c);
        if ((0, hooks_1.columnWriteBlockedReason)(def, 'create'))
            continue; // computed columns are filled by their module
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
    const rowId = await (0, db_1.withTx)(async (tx) => {
        const o = await (0, db_1.q1)(`SELECT ISNULL(MAX(row_order), 0) + 1 AS o FROM Rows WITH (UPDLOCK, HOLDLOCK) WHERE sheet_id = @s`, { s: db_1.T.uuid(sheetId) }, tx);
        const r = await (0, db_1.q1)(`INSERT INTO Rows (sheet_id, row_order, created_by, updated_by) OUTPUT inserted.row_id VALUES (@s, @o, @u, @u)`, { s: db_1.T.uuid(sheetId), o: db_1.T.int(o.o), u: db_1.T.uuid(u.id) }, tx);
        for (const g of docGen) {
            const [num] = await (0, docNumber_1.nextDocNumbers)(tx, sheetId, g.def, g.cfg, [{ prefix: g.prefix, date: g.date }]);
            toWrite.push({ col: g.def, value: num });
        }
        for (const w of toWrite)
            await (0, cellWriter_1.writeCell)(tx, { sheetId, rowId: r.row_id, col: w.col, value: w.value, userId: u.id, source: 'create' });
        await (0, hooks_1.runAfterCellsWritten)({ tx, user: u, sheetId, rowIds: [r.row_id], source: 'create' });
        await (0, audit_1.audit)({ userId: u.id, action: 'row_create', entityType: 'row', entityId: r.row_id, fileId: sheet.file_id, sheetId,
            newValue: { rowNo: o.o, values: Object.fromEntries(toWrite.map((w) => [w.col.column_name, w.value])) } }, req, tx);
        return r.row_id;
    });
    const rec = await (0, db_1.q)(`SELECT * FROM Rows WHERE row_id = @r`, { r: db_1.T.uuid(rowId) });
    const { rows, userIds } = await (0, rowQuery_1.hydrateRows)(rec, cols);
    (0, socket_1.emitToSheet)(sheetId, 'rows:changed', { sheetId, action: 'create', rowId, by: u.displayName }, (0, http_1.reqMeta)(req).socketId);
    (0, http_1.ok)(res, { row: rows[0], users: await (0, rowQuery_1.userNames)(userIds) }, 201);
}));
/** Options of a relationship column (distinct values of another sheet's column, optionally for one parent value) */
router.post('/sheets/:id/lookup-options', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read);
    const body = (0, http_1.parse)(zod_1.z.object({ columnId: http_1.zId, parentValue: zod_1.z.string().max(500).nullish(), search: zod_1.z.string().max(200).optional(), limit: zod_1.z.number().int().min(1).max(5000).optional() }), req.body);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const col = cols.find((c) => c.column_id === body.columnId);
    const def = col ? (0, cellValue_1.toColumnDef)(col) : null;
    const dc = def ? (0, docNumber_1.getDocCfg)(def) : null;
    if (dc)
        return (0, http_1.ok)(res, { options: await (0, docNumber_1.docPrefixes)(dc), needsParent: false });
    const l = def ? (0, lookup_1.getLookup)(def) : null;
    if (!l)
        throw (0, http_1.badRequest)('คอลัมน์นี้ไม่ได้ดึงตัวเลือกจากตารางอื่น');
    // The list is read with the server's rights on purpose: writers may pick a value without having read access to the source sheet
    // one extra value tells the browser that the list is cut (it then searches on the server while the user types)
    const got = await (0, lookup_1.lookupValues)(l, body.parentValue ?? null, body.search, undefined, body.limit ? body.limit + 1 : undefined);
    (0, http_1.ok)(res, { options: body.limit ? got.slice(0, body.limit) : got, more: !!body.limit && got.length > body.limit, needsParent: !!l.parent });
}));
/** Count / sum / average / min / max of whole columns for the current filter (shown when column headers are selected) */
router.post('/sheets/:id/column-stats', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read);
    const body = (0, http_1.parse)(zod_1.z.object({ columnIds: zod_1.z.array(http_1.zId).min(1).max(40), filters: zod_1.z.array(schemas_1.filterSchema).max(50).default([]), search: zod_1.z.string().max(200).optional() }), req.body);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const colMap = new Map(cols.map((c) => [c.column_id, c]));
    const ids = body.columnIds.filter((id) => colMap.has(id));
    const p = new rowQuery_1.Params();
    const where = (0, rowQuery_1.baseWhere)(sheetId, colMap, p, { filters: body.filters, search: body.search });
    const total = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM Rows r WHERE ${where}`, p.values);
    const rows = ids.length
        ? await (0, db_1.q)(`SELECT wc.column_id,
             SUM(CASE WHEN (wc.value_text IS NOT NULL AND wc.value_text <> N'') OR wc.value_int IS NOT NULL OR wc.value_float IS NOT NULL OR wc.value_date IS NOT NULL
                       OR wc.value_bool IS NOT NULL OR (wc.value_json IS NOT NULL AND wc.value_json <> N'[]') THEN 1 ELSE 0 END) AS filled,
             COUNT(wc.value_int) AS n_int, SUM(CAST(wc.value_int AS FLOAT)) AS s_int, MIN(wc.value_int) AS min_int, MAX(wc.value_int) AS max_int,
             COUNT(wc.value_float) AS n_float, SUM(wc.value_float) AS s_float, MIN(wc.value_float) AS min_float, MAX(wc.value_float) AS max_float,
             SUM(CASE WHEN wc.value_bool = 1 THEN 1 ELSE 0 END) AS n_true
           FROM Cells wc JOIN Rows r ON r.row_id = wc.row_id
           WHERE ${where} AND wc.column_id IN ${(0, db_1.idList)('@scols')} GROUP BY wc.column_id`, { ...p.values, scols: (0, db_1.jsonParam)(ids) })
        : [];
    const byId = new Map(rows.map((r) => [r.column_id, r]));
    (0, http_1.ok)(res, {
        totalRows: Number(total?.n ?? 0),
        columns: ids.map((id) => {
            const r = byId.get(id);
            const t = colMap.get(id).data_type;
            const isInt = t === 'int';
            const isFloat = t === 'float';
            const n = isInt ? Number(r?.n_int ?? 0) : isFloat ? Number(r?.n_float ?? 0) : 0;
            const sum = isInt ? Number(r?.s_int ?? 0) : isFloat ? Number(r?.s_float ?? 0) : null;
            return {
                columnId: id,
                filled: Number(r?.filled ?? 0),
                sum: isInt || isFloat ? sum : null,
                avg: (isInt || isFloat) && n ? sum / n : null,
                min: isInt ? r?.min_int ?? null : isFloat ? r?.min_float ?? null : null,
                max: isInt ? r?.max_int ?? null : isFloat ? r?.max_float ?? null : null,
                trueCount: t === 'boolean' ? Number(r?.n_true ?? 0) : null,
            };
        }),
    });
}));
/** The number a new row would get right now (shown in the form; the final number is assigned when the row is saved) */
router.post('/sheets/:id/doc-number/preview', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read);
    const body = (0, http_1.parse)(zod_1.z.object({ columnId: http_1.zId, prefix: zod_1.z.string().max(100).nullish(), date: zod_1.z.string().max(10).nullish() }), req.body);
    const col = (await (0, cellWriter_1.loadColumns)(sheetId)).find((c) => c.column_id === body.columnId);
    const def = col ? (0, cellValue_1.toColumnDef)(col) : null;
    const dc = def ? (0, docNumber_1.getDocCfg)(def) : null;
    if (!def || !dc)
        throw (0, http_1.badRequest)('คอลัมน์นี้ไม่ใช่เลขที่เอกสารอัตโนมัติ');
    const prefixes = await (0, docNumber_1.docPrefixes)(dc);
    const prefix = body.prefix ? prefixes.find((p) => p.toLowerCase() === body.prefix.toLowerCase()) ?? null : null;
    if ((0, docNumber_1.hasPrefixToken)(dc.template) && !prefix)
        return (0, http_1.ok)(res, { number: null });
    const [number] = await (0, db_1.withTx)((tx) => (0, docNumber_1.nextDocNumbers)(tx, sheetId, def, dc, [{ prefix, date: (0, docNumber_1.dateParts)(body.date ?? null) }]));
    (0, http_1.ok)(res, { number });
}));
/** Bulk insert of rows (file import). `dryRun` only validates. */
router.post('/sheets/:id/rows/import', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const u = req.user;
    const { sheet } = await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.write);
    const body = (0, http_1.parse)(zod_1.z.object({
        rows: zod_1.z.array(zod_1.z.object({ rowNo: zod_1.z.number().int().min(0), values: zod_1.z.record(zod_1.z.any()) })).min(1).max(500),
        skipInvalid: zod_1.z.boolean().default(false),
        dryRun: zod_1.z.boolean().default(false),
    }), req.body);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const defs = cols.map((c) => ({ c, def: (0, cellValue_1.toColumnDef)(c) }));
    const resolve = (0, lookup_1.lookupResolver)();
    const errors = [];
    const valid = [];
    const prefixCache = new Map();
    let skippedEmpty = 0;
    for (const r of body.rows) {
        const lowered = Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k.toLowerCase(), v]));
        if (!Object.values(lowered).some((v) => !(v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length)))) {
            skippedEmpty++;
            continue;
        }
        const rawAll = Object.fromEntries(defs.map(({ c }) => [c.column_id, c.column_id in lowered ? lowered[c.column_id] : (0, http_1.safeJson)(c.default_value, null)]));
        const cells = [];
        const gens = [];
        let bad = false;
        for (const { def } of defs) {
            if ((0, hooks_1.columnWriteBlockedReason)(def, 'import'))
                continue; // computed columns are filled after the rows are inserted
            let raw = rawAll[def.column_id];
            const dc = (0, docNumber_1.getDocCfg)(def);
            if (dc) {
                if (!prefixCache.has(def.column_id))
                    prefixCache.set(def.column_id, await (0, docNumber_1.docPrefixes)(dc));
                const dr = (0, docNumber_1.interpretDocRaw)(def, dc, raw, prefixCache.get(def.column_id), 'create');
                if (!dr.ok) {
                    bad = true;
                    errors.push({ rowNo: r.rowNo, columnId: def.column_id, columnName: def.column_name, message: dr.error });
                    continue;
                }
                if (dr.kind === 'generate') {
                    gens.push({ def, cfg: dc, prefix: dr.prefix, date: (0, docNumber_1.docDate)(dc, rawAll) });
                    continue;
                }
                raw = dr.value;
            }
            const n = await (0, lookup_1.normalizeWithLookup)(def, raw, await (0, lookup_1.parentValueOf)(def, rawAll), resolve);
            if (!n.ok) {
                bad = true;
                errors.push({ rowNo: r.rowNo, columnId: def.column_id, columnName: def.column_name, message: n.error });
            }
            else if (n.value !== null)
                cells.push({ def, value: n.value });
        }
        if (!bad)
            valid.push({ rowNo: r.rowNo, cells, gens });
    }
    const failedRows = new Set(errors.map((e) => e.rowNo)).size;
    if (body.dryRun || (errors.length && !body.skipInvalid) || !valid.length)
        return (0, http_1.ok)(res, { inserted: 0, valid: valid.length, invalid: failedRows, skippedEmpty, errors: errors.slice(0, 200) });
    await (0, db_1.withTx)(async (tx) => {
        const o = await (0, db_1.q1)(`SELECT ISNULL(MAX(row_order), 0) AS o FROM Rows WITH (UPDLOCK, HOLDLOCK) WHERE sheet_id = @s`, { s: db_1.T.uuid(sheetId) }, tx);
        const start = Number(o?.o ?? 0);
        // auto document numbers, in file order, per column
        const byCol = new Map();
        for (const v of valid)
            for (const g of v.gens) {
                if (!byCol.has(g.def.column_id))
                    byCol.set(g.def.column_id, { def: g.def, cfg: g.cfg, items: [] });
                byCol.get(g.def.column_id).items.push({ v, g });
            }
        for (const grp of byCol.values()) {
            const nums = await (0, docNumber_1.nextDocNumbers)(tx, sheetId, grp.def, grp.cfg, grp.items.map((i) => ({ prefix: i.g.prefix, date: i.g.date })));
            grp.items.forEach((i, k) => i.v.cells.push({ def: grp.def, value: nums[k] }));
        }
        const rowsJson = [];
        const cellsJson = [];
        const histJson = [];
        valid.forEach((v, i) => {
            const rowId = crypto_1.default.randomUUID();
            rowsJson.push({ row_id: rowId, ord: start + i + 1 });
            for (const c of v.cells) {
                const st = (0, cellValue_1.toStorage)(c.def.data_type, c.value);
                const cellId = crypto_1.default.randomUUID();
                cellsJson.push({ cell_id: cellId, row_id: rowId, column_id: c.def.column_id, ...st });
                histJson.push({ cell_id: cellId, row_id: rowId, column_id: c.def.column_id, nv: JSON.stringify(c.value) });
            }
        });
        await (0, db_1.q)(`INSERT INTO Rows (row_id, sheet_id, row_order, created_by, updated_by)
               SELECT row_id, @s, ord, @u, @u FROM OPENJSON(@j) WITH (row_id UNIQUEIDENTIFIER, ord INT)`, { s: db_1.T.uuid(sheetId), u: db_1.T.uuid(u.id), j: db_1.T.text(JSON.stringify(rowsJson)) }, tx);
        for (let i = 0; i < cellsJson.length; i += 2000) {
            const chunk = cellsJson.slice(i, i + 2000);
            await (0, db_1.q)(`INSERT INTO Cells (cell_id, row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, updated_by)
                 SELECT cell_id, row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, @u
                 FROM OPENJSON(@j) WITH (cell_id UNIQUEIDENTIFIER, row_id UNIQUEIDENTIFIER, column_id UNIQUEIDENTIFIER, value_text NVARCHAR(MAX),
                   value_int BIGINT, value_float FLOAT, value_date DATETIME2, value_bool BIT, value_json NVARCHAR(MAX))`, { u: db_1.T.uuid(u.id), j: db_1.T.text(JSON.stringify(chunk)) }, tx);
            await (0, db_1.q)(`INSERT INTO CellHistory (cell_id, sheet_id, row_id, column_id, old_value, new_value, change_source, changed_by, version_number)
                 SELECT cell_id, @s, row_id, column_id, NULL, nv, N'import', @u, 1
                 FROM OPENJSON(@j) WITH (cell_id UNIQUEIDENTIFIER, row_id UNIQUEIDENTIFIER, column_id UNIQUEIDENTIFIER, nv NVARCHAR(MAX))`, { s: db_1.T.uuid(sheetId), u: db_1.T.uuid(u.id), j: db_1.T.text(JSON.stringify(histJson.slice(i, i + 2000))) }, tx);
        }
        await (0, hooks_1.runAfterCellsWritten)({ tx, user: u, sheetId, rowIds: rowsJson.map((r) => r.row_id), source: 'import' });
        await (0, audit_1.audit)({ userId: u.id, action: 'rows_import', entityType: 'sheet', entityId: sheetId, fileId: sheet.file_id, sheetId,
            newValue: { rows: valid.length, firstRowNo: start + 1 } }, req, tx);
    });
    (0, socket_1.emitToSheet)(sheetId, 'rows:changed', { sheetId, action: 'import', by: u.displayName }, (0, http_1.reqMeta)(req).socketId);
    (0, http_1.ok)(res, { inserted: valid.length, valid: valid.length, invalid: failedRows, skippedEmpty, errors: errors.slice(0, 200) });
}));
async function deleteRows(req, sheetId, rowIds) {
    const u = req.user;
    const { sheet } = await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.write);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const recs = await (0, db_1.q)(`SELECT * FROM Rows WHERE sheet_id = @s AND is_deleted = 0 AND row_id IN ${(0, db_1.idList)('@ids')}`, { s: db_1.T.uuid(sheetId), ids: (0, db_1.jsonParam)(rowIds) });
    if (!recs.length)
        throw (0, http_1.notFound)('ไม่พบแถวที่ต้องการลบ');
    const { rows } = await (0, rowQuery_1.hydrateRows)(recs, cols);
    const names = new Map(cols.map((c) => [c.column_id, c.column_name]));
    await (0, db_1.withTx)(async (tx) => {
        const snaps = rows.map((r) => ({ row_id: r.id, sheet_id: sheetId, data: JSON.stringify({ rowNo: r.order, values: r.values }) }));
        await (0, db_1.q)(`INSERT INTO RowSnapshots (row_id, sheet_id, snapshot_data, snapshot_type, created_by)
       SELECT row_id, sheet_id, data, N'before_delete', @u FROM OPENJSON(@j) WITH (row_id UNIQUEIDENTIFIER, sheet_id UNIQUEIDENTIFIER, data NVARCHAR(MAX))`, { j: db_1.T.text(JSON.stringify(snaps)), u: db_1.T.uuid(u.id) }, tx);
        await (0, db_1.q)(`UPDATE Rows SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @u WHERE row_id IN ${(0, db_1.idList)('@ids')}`, { u: db_1.T.uuid(u.id), ids: (0, db_1.jsonParam)(rows.map((r) => r.id)) }, tx);
        await (0, audit_1.auditMany)(rows.map((r) => ({
            userId: u.id, action: 'row_delete', entityType: 'row', entityId: r.id, fileId: sheet.file_id, sheetId,
            oldValue: { rowNo: r.order, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [names.get(k) ?? k, v])) },
        })), req, tx);
    });
    (0, socket_1.emitToSheet)(sheetId, 'rows:changed', { sheetId, action: 'delete', rowIds: rows.map((r) => r.id), by: u.displayName }, (0, http_1.reqMeta)(req).socketId);
    return rows.length;
}
router.delete('/rows/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const r = await (0, db_1.q1)(`SELECT sheet_id FROM Rows WHERE row_id = @r`, { r: db_1.T.uuid(id) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบแถว');
    (0, http_1.ok)(res, { deleted: await deleteRows(req, r.sheet_id, [id]) });
}));
router.post('/sheets/:id/rows/delete', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const { rowIds } = (0, http_1.parse)(zod_1.z.object({ rowIds: zod_1.z.array(http_1.zId).min(1).max(5000) }), req.body);
    (0, http_1.ok)(res, { deleted: await deleteRows(req, sheetId, rowIds) });
}));
router.get('/sheets/:id/trash', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.write);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const recs = await (0, db_1.q)(`SELECT TOP 500 * FROM Rows WHERE sheet_id = @s AND is_deleted = 1 ORDER BY deleted_at DESC`, { s: db_1.T.uuid(sheetId) });
    const { rows, userIds } = await (0, rowQuery_1.hydrateRows)(recs, cols);
    (0, http_1.ok)(res, { rows, users: await (0, rowQuery_1.userNames)(userIds) });
}));
router.post('/sheets/:id/rows/restore', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const u = req.user;
    const { sheet } = await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.write);
    const { rowIds } = (0, http_1.parse)(zod_1.z.object({ rowIds: zod_1.z.array(http_1.zId).min(1).max(5000) }), req.body);
    const restored = await (0, db_1.withTx)(async (tx) => {
        const rows = await (0, db_1.q)(`UPDATE Rows SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, updated_at = SYSUTCDATETIME(), updated_by = @u
         OUTPUT inserted.row_id, inserted.row_order
         WHERE sheet_id = @s AND is_deleted = 1 AND row_id IN ${(0, db_1.idList)('@ids')}`, { u: db_1.T.uuid(u.id), s: db_1.T.uuid(sheetId), ids: (0, db_1.jsonParam)(rowIds) }, tx);
        await (0, audit_1.auditMany)(rows.map((r) => ({ userId: u.id, action: 'row_restore', entityType: 'row', entityId: r.row_id, fileId: sheet.file_id, sheetId,
            newValue: { rowNo: r.row_order } })), req, tx);
        return rows.length;
    });
    (0, socket_1.emitToSheet)(sheetId, 'rows:changed', { sheetId, action: 'restore', by: u.displayName }, (0, http_1.reqMeta)(req).socketId);
    (0, http_1.ok)(res, { restored });
}));
router.get('/rows/:id/history', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const r = await (0, db_1.q1)(`SELECT * FROM Rows WHERE row_id = @r`, { r: db_1.T.uuid(id) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบแถว');
    await (0, permissions_1.requireSheet)(req.user, r.sheet_id, permissions_1.LV.read);
    const history = await (0, db_1.q)(`SELECT TOP 500 h.history_id, h.column_id, c.column_name, c.data_type, h.old_value, h.new_value, h.change_source,
         h.changed_by, u.display_name AS changed_by_name, u.avatar_url, h.changed_at, h.version_number
       FROM CellHistory h
       JOIN Columns c ON c.column_id = h.column_id
       JOIN Users u ON u.user_id = h.changed_by
       WHERE h.row_id = @r ORDER BY h.changed_at DESC, h.history_id DESC`, { r: db_1.T.uuid(id) });
    const snapshots = await (0, db_1.q)(`SELECT TOP 50 s.snapshot_id, s.snapshot_type, s.snapshot_data, s.created_at, u.display_name AS created_by_name
       FROM RowSnapshots s JOIN Users u ON u.user_id = s.created_by WHERE s.row_id = @r ORDER BY s.created_at DESC`, { r: db_1.T.uuid(id) });
    (0, http_1.ok)(res, {
        row: { id: r.row_id, order: r.row_order, createdAt: r.created_at, isDeleted: !!r.is_deleted },
        history: history.map((h) => ({
            id: Number(h.history_id), columnId: h.column_id, columnName: h.column_name, dataType: h.data_type,
            oldValue: (0, http_1.safeJson)(h.old_value, null), newValue: (0, http_1.safeJson)(h.new_value, null), source: h.change_source,
            by: h.changed_by, byName: h.changed_by_name, avatarUrl: h.avatar_url, at: h.changed_at, version: h.version_number,
        })),
        snapshots: snapshots.map((s) => ({ id: Number(s.snapshot_id), type: s.snapshot_type, data: (0, http_1.safeJson)(s.snapshot_data, {}), at: s.created_at, byName: s.created_by_name })),
    });
}));
const rollbackBody = zod_1.z.object({ at: zod_1.z.string().datetime({ offset: true }), reason: zod_1.z.string().trim().max(1000).optional(), preview: zod_1.z.boolean().default(false) });
router.post('/rows/:id/rollback', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const r = await (0, db_1.q1)(`SELECT sheet_id FROM Rows WHERE row_id = @r`, { r: db_1.T.uuid(id) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบแถว');
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, r.sheet_id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(rollbackBody, req.body);
    const plan = await (0, rollback_1.planRollback)(r.sheet_id, new Date(body.at), id);
    if (body.preview)
        return (0, http_1.ok)(res, { preview: true, cells: plan.cellChanges.length, rowsToRestore: plan.rowsToRestore.length, rowsToDelete: 0 });
    (0, http_1.ok)(res, await (0, rollback_1.applyRollback)(req.user, sheet, plan, { req, reason: body.reason, scope: 'row', rowId: id }));
}));
router.post('/sheets/:id/rollback', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    if (!(0, auth_1.isAdminRole)(req.user.role))
        throw (0, http_1.forbidden)('การย้อนข้อมูลทั้งชีตทำได้เฉพาะ Admin');
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const body = (0, http_1.parse)(rollbackBody, req.body);
    const at = new Date(body.at);
    if (at > new Date())
        throw (0, http_1.badRequest)('เวลาที่ต้องการย้อนต้องเป็นอดีต');
    const plan = await (0, rollback_1.planRollback)(sheetId, at);
    if (body.preview)
        return (0, http_1.ok)(res, { preview: true, cells: plan.cellChanges.length, rowsToDelete: plan.rowsToDelete.length, rowsToRestore: plan.rowsToRestore.length });
    if (!body.reason || body.reason.length < 5)
        throw (0, http_1.badRequest)('กรุณาระบุเหตุผลในการย้อนข้อมูล (อย่างน้อย 5 ตัวอักษร)');
    (0, http_1.ok)(res, await (0, rollback_1.applyRollback)(req.user, sheet, plan, { req, reason: body.reason, scope: 'sheet' }));
}));
exports.default = router;
//# sourceMappingURL=rows.js.map