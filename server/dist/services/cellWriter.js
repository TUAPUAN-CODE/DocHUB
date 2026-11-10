"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadColumns = loadColumns;
exports.writeCell = writeCell;
exports.applyCellUpdates = applyCellUpdates;
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const cellValue_1 = require("../shared/cellValue");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const lookup_1 = require("./lookup");
const docNumber_1 = require("./docNumber");
const socket_1 = require("../socket");
const hooks_1 = require("./hooks");
async function loadColumns(sheetId, tx, includeDeleted = false) {
    return (0, db_1.q)(`SELECT * FROM Columns WHERE sheet_id = @s ${includeDeleted ? '' : 'AND is_deleted = 0'}
     ORDER BY display_order, created_at`, { s: sheetId }, tx);
}
/** Upserts one cell and appends a CellHistory version. Must run inside a transaction. */
async function writeCell(tx, a) {
    const existing = await (0, db_1.q1)(`SELECT cell_id, value_text, value_int, value_float, value_date, value_bool, value_json
     FROM Cells WITH (UPDLOCK, HOLDLOCK) WHERE row_id = @r AND column_id = @c`, { r: db_1.T.uuid(a.rowId), c: db_1.T.uuid(a.col.column_id) }, tx);
    const oldValue = existing ? (0, cellValue_1.fromStorage)(a.readType ?? a.col.data_type, existing) : null;
    const typeChanged = !!a.readType && a.readType !== a.col.data_type;
    if (!typeChanged && (0, cellValue_1.valuesEqual)(oldValue, a.value)) {
        return { changed: false, oldValue, newValue: a.value, historyId: null, at: null };
    }
    if (!existing && a.value === null) {
        return { changed: false, oldValue, newValue: null, historyId: null, at: null };
    }
    const st = (0, cellValue_1.toStorage)(a.col.data_type, a.value);
    const p = {
        r: db_1.T.uuid(a.rowId),
        c: db_1.T.uuid(a.col.column_id),
        u: db_1.T.uuid(a.userId),
        vt: db_1.T.text(st.value_text),
        vi: db_1.T.bigint(st.value_int),
        vf: db_1.T.float(st.value_float),
        vd: db_1.T.dt(st.value_date),
        vb: db_1.T.bit(st.value_bool),
        vj: db_1.T.text(st.value_json),
    };
    let cellId;
    if (existing) {
        cellId = existing.cell_id;
        await (0, db_1.q)(`UPDATE Cells SET value_text = @vt, value_int = @vi, value_float = @vf, value_date = @vd, value_bool = @vb,
         value_json = @vj, updated_by = @u, updated_at = SYSUTCDATETIME()
       WHERE cell_id = @id`, { ...p, id: db_1.T.uuid(cellId) }, tx);
    }
    else {
        const ins = await (0, db_1.q1)(`INSERT INTO Cells (row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, updated_by)
       OUTPUT inserted.cell_id
       VALUES (@r, @c, @vt, @vi, @vf, @vd, @vb, @vj, @u)`, p, tx);
        cellId = ins.cell_id;
    }
    const h = await (0, db_1.q1)(`INSERT INTO CellHistory (cell_id, sheet_id, row_id, column_id, old_value, new_value, change_source, changed_by, version_number)
     OUTPUT inserted.history_id, inserted.changed_at
     SELECT @cell, @s, @r, @c, @ov, @nv, @src, @u, ISNULL(MAX(version_number), 0) + 1
     FROM CellHistory WHERE cell_id = @cell`, {
        cell: db_1.T.uuid(cellId),
        s: db_1.T.uuid(a.sheetId),
        r: db_1.T.uuid(a.rowId),
        c: db_1.T.uuid(a.col.column_id),
        ov: db_1.T.text(existing ? JSON.stringify(oldValue) : null),
        nv: db_1.T.text(JSON.stringify(a.value)),
        src: a.source,
        u: db_1.T.uuid(a.userId),
    }, tx);
    await (0, db_1.q)(`UPDATE Rows SET updated_at = SYSUTCDATETIME(), updated_by = @u WHERE row_id = @r`, { r: db_1.T.uuid(a.rowId), u: db_1.T.uuid(a.userId) }, tx);
    return { changed: true, oldValue, newValue: a.value, historyId: Number(h.history_id), at: h.changed_at };
}
/** Validates + writes a batch of cell updates in one transaction, audits, and broadcasts. */
async function applyCellUpdates(user, sheetId, updates, opts = {}) {
    if (updates.length > 5000)
        throw (0, http_1.badRequest)('อัปเดตได้สูงสุด 5,000 เซลล์ต่อครั้ง');
    const { sheet } = await (0, permissions_1.requireSheet)(user, sheetId, opts.minLevel ?? permissions_1.LV.write);
    const cols = await loadColumns(sheetId);
    const colMap = new Map(cols.map((c) => [c.column_id, (0, cellValue_1.toColumnDef)(c)]));
    const rowIds = [...new Set(updates.map((u) => u.rowId.toLowerCase()))];
    const rows = rowIds.length
        ? await (0, db_1.q)(`SELECT row_id, row_order FROM Rows WHERE sheet_id = @s AND is_deleted = 0 AND row_id IN ${(0, db_1.idList)('@ids')}`, { s: db_1.T.uuid(sheetId), ids: (0, db_1.jsonParam)(rowIds) })
        : [];
    const rowMap = new Map(rows.map((r) => [r.row_id, r]));
    // Parent values of dependent drop-downs: this batch wins over what is stored
    const resolve = (0, lookup_1.lookupResolver)();
    const parentCols = new Set();
    for (const c of colMap.values()) {
        const l = (0, lookup_1.getLookup)(c);
        if (l?.parent)
            parentCols.add(l.parent.localColumnId);
    }
    const stored = new Map();
    if (parentCols.size && rowIds.length) {
        const cells = await (0, db_1.q)(`SELECT row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json FROM Cells
       WHERE row_id IN ${(0, db_1.idList)('@ids')} AND column_id IN ${(0, db_1.idList)('@cc')}`, { ids: (0, db_1.jsonParam)(rowIds), cc: (0, db_1.jsonParam)([...parentCols]) });
        for (const c of cells) {
            const def = colMap.get(c.column_id);
            if (!def)
                continue;
            if (!stored.has(c.row_id))
                stored.set(c.row_id, {});
            stored.get(c.row_id)[c.column_id] = (0, cellValue_1.fromStorage)(def.data_type, c);
        }
    }
    const batchValues = new Map();
    for (const u of updates) {
        const k = u.rowId.toLowerCase();
        if (!batchValues.has(k))
            batchValues.set(k, {});
        batchValues.get(k)[u.columnId.toLowerCase()] = u.value;
    }
    const errors = [];
    const valid = [];
    const prefixCache = new Map();
    const seen = new Set();
    for (const u of updates) {
        const rowId = u.rowId.toLowerCase();
        const columnId = u.columnId.toLowerCase();
        const col = colMap.get(columnId);
        const row = rowMap.get(rowId);
        if (!col) {
            errors.push({ rowId, columnId, message: 'ไม่พบคอลัมน์ (อาจถูกลบแล้ว)' });
            continue;
        }
        if (!row) {
            errors.push({ rowId, columnId, columnName: col.column_name, message: 'ไม่พบแถว (อาจถูกลบแล้ว)' });
            continue;
        }
        const blocked = (0, hooks_1.columnWriteBlockedReason)({ ...col, validation: col.validation }, opts.source ?? 'edit');
        if (blocked) {
            errors.push({ rowId, columnId, rowNo: row.row_order, columnName: col.column_name, message: blocked });
            continue;
        }
        let rawValue = u.value;
        let gen;
        const dc = (0, docNumber_1.getDocCfg)(col);
        if (dc) {
            if (!prefixCache.has(col.column_id))
                prefixCache.set(col.column_id, await (0, docNumber_1.docPrefixes)(dc));
            const dr = (0, docNumber_1.interpretDocRaw)(col, dc, u.value, prefixCache.get(col.column_id), 'update');
            if (!dr.ok) {
                errors.push({ rowId, columnId, rowNo: row.row_order, columnName: col.column_name, message: dr.error });
                continue;
            }
            if (dr.kind === 'generate')
                gen = { cfg: dc, prefix: dr.prefix };
            else
                rawValue = dr.value;
        }
        const parentVals = { ...(stored.get(rowId) ?? {}), ...(batchValues.get(rowId) ?? {}) };
        const pl = (0, lookup_1.getLookup)(col)?.parent;
        const pv = pl ? parentVals[pl.localColumnId] : null;
        const n = gen ? { ok: true, value: null } : await (0, lookup_1.normalizeWithLookup)(col, rawValue, pv === null || pv === undefined || pv === '' ? null : String(Array.isArray(pv) ? pv[0] : pv), resolve, { skipRequired: opts.skipRequired });
        if (!n.ok) {
            errors.push({ rowId, columnId, rowNo: row.row_order, columnName: col.column_name, message: n.error });
            continue;
        }
        const key = `${rowId}:${columnId}`;
        if (seen.has(key)) {
            const idx = valid.findIndex((v) => v.rowId === rowId && v.col.column_id === columnId);
            if (idx >= 0)
                valid.splice(idx, 1);
        }
        seen.add(key);
        valid.push({ rowId, col, rowNo: row.row_order, value: n.value, gen });
    }
    if (errors.length && !opts.partial) {
        throw (0, http_1.badRequest)(errors.length === 1 ? errors[0].message : `ข้อมูลไม่ถูกต้อง ${errors.length} เซลล์: ${errors[0].message}`, {
            cells: errors,
        });
    }
    const source = opts.source ?? 'edit';
    const written = await (0, db_1.withTx)(async (tx) => {
        const out = [];
        for (const v of valid) {
            let value = v.value;
            if (v.gen)
                [value] = await (0, docNumber_1.nextDocNumbers)(tx, sheetId, v.col, v.gen.cfg, [{ prefix: v.gen.prefix, date: (0, docNumber_1.dateParts)(null) }]);
            const r = await writeCell(tx, { sheetId, rowId: v.rowId, col: v.col, value, userId: user.id, source });
            if (r.changed)
                out.push({
                    rowId: v.rowId,
                    columnId: v.col.column_id,
                    rowNo: v.rowNo,
                    columnName: v.col.column_name,
                    oldValue: r.oldValue,
                    newValue: r.newValue,
                    historyId: r.historyId,
                    at: r.at,
                });
        }
        // modules (e.g. formula columns) react to the edit inside the same transaction; their cells are reported like edits
        if (out.length) {
            const extra = await (0, hooks_1.runAfterCellsWritten)({ tx, user, sheetId, rowIds: [...new Set(out.map((w) => w.rowId))], source });
            for (const x of extra)
                if (!out.some((w) => w.rowId === x.rowId && w.columnId === x.columnId))
                    out.push(x);
        }
        await (0, audit_1.auditMany)(out.map((w) => ({
            userId: user.id,
            action: opts.auditAction ?? 'cell_update',
            entityType: 'cell',
            entityId: `${w.rowId}:${w.columnId}`,
            fileId: sheet.file_id,
            sheetId,
            oldValue: { value: w.oldValue },
            newValue: { value: w.newValue, columnName: w.columnName, rowNo: w.rowNo, historyId: w.historyId, source },
        })), opts.req, tx);
        return out;
    });
    if (written.length) {
        (0, socket_1.emitToSheet)(sheetId, 'cells:updated', {
            sheetId,
            updates: written.map((w) => ({
                rowId: w.rowId,
                columnId: w.columnId,
                value: w.newValue,
                by: user.id,
                byName: user.displayName,
                at: w.at,
            })),
        }, (0, http_1.reqMeta)(opts.req).socketId);
    }
    return {
        updated: written.map((w) => ({ rowId: w.rowId, columnId: w.columnId, value: w.newValue, at: w.at, by: user.id })),
        unchanged: valid.length - written.length,
        errors,
    };
}
//# sourceMappingURL=cellWriter.js.map