"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyColumnIds = keyColumnIds;
exports.snapshotSheet = snapshotSheet;
exports.listRevisions = listRevisions;
exports.getRevision = getRevision;
exports.pendingDiff = pendingDiff;
exports.pendingCounts = pendingCounts;
exports.createRevision = createRevision;
const mssql_1 = __importDefault(require("mssql"));
const db_1 = require("../../config/db");
const cellWriter_1 = require("../../services/cellWriter");
const sheetSettings_1 = require("../../services/sheetSettings");
const cellValue_1 = require("../../shared/cellValue");
const http_1 = require("../../shared/http");
const module_1 = require("../autostamp/module");
const diff_1 = require("./diff");
const META_COLS = `rv.rev_no, rv.note, rv.row_count, rv.added_count, rv.changed_count, rv.removed_count, rv.created_at, rv.created_by, u.display_name`;
const toMeta = (r) => ({
    revNo: r.rev_no, note: r.note ?? null, rowCount: r.row_count, added: r.added_count, changed: r.changed_count, removed: r.removed_count,
    createdAt: r.created_at, createdBy: r.created_by, createdByName: r.display_name ?? null,
});
/** Columns whose values name a row in the change list (sheet setting; default: the first column) */
async function keyColumnIds(sheetId) {
    const s = await (0, sheetSettings_1.readSettings)(sheetId);
    return Array.isArray(s.revisions?.keyColumnIds) ? s.revisions.keyColumnIds.map((x) => String(x).toLowerCase()) : [];
}
/** Every live row of the sheet with its current values */
async function snapshotSheet(sheetId, tx) {
    const cols = (await (0, cellWriter_1.loadColumns)(sheetId, tx)).map(cellValue_1.toColumnDef);
    const types = new Map(cols.map((c) => [c.column_id, c.data_type]));
    const rows = await (0, db_1.q)(`SELECT row_id, row_order FROM Rows WHERE sheet_id = @s AND is_deleted = 0 ORDER BY row_order`, { s: db_1.T.uuid(sheetId) }, tx);
    const cells = await (0, db_1.q)(`SELECT c.row_id, c.column_id, c.value_text, c.value_int, c.value_float, c.value_date, c.value_bool, c.value_json
     FROM Cells c JOIN Rows r ON r.row_id = c.row_id WHERE r.sheet_id = @s AND r.is_deleted = 0`, { s: db_1.T.uuid(sheetId) }, tx);
    const byRow = new Map();
    for (const c of cells) {
        const t = types.get(c.column_id);
        if (!t)
            continue; // a deleted column
        const v = (0, cellValue_1.fromStorage)(t, c);
        if (v === null || v === '' || (Array.isArray(v) && !v.length))
            continue;
        if (!byRow.has(c.row_id))
            byRow.set(c.row_id, {});
        byRow.get(c.row_id)[c.column_id] = v;
    }
    return {
        cols: cols.map((c) => ({ id: c.column_id, name: c.column_name, type: c.data_type, ...((0, module_1.stampOf)(c) ? { stamp: true } : {}) })),
        rows: rows.map((r) => ({ id: r.row_id, no: r.row_order, v: byRow.get(r.row_id) ?? {} })),
    };
}
async function listRevisions(sheetId) {
    const rows = await (0, db_1.q)(`SELECT ${META_COLS} FROM SheetRevisions rv LEFT JOIN Users u ON u.user_id = rv.created_by WHERE rv.sheet_id = @s ORDER BY rv.rev_no DESC`, { s: db_1.T.uuid(sheetId) });
    return rows.map(toMeta);
}
/** One revision with the changes since the one before it; `revNo` null = the latest */
async function getRevision(sheetId, revNo) {
    const r = await (0, db_1.q1)(`SELECT TOP 1 ${META_COLS}, rv.diff_json, (SELECT MAX(p.rev_no) FROM SheetRevisions p WHERE p.sheet_id = rv.sheet_id AND p.rev_no < rv.rev_no) AS prev_no
     FROM SheetRevisions rv LEFT JOIN Users u ON u.user_id = rv.created_by
     WHERE rv.sheet_id = @s ${revNo === null ? '' : 'AND rv.rev_no = @n'} ORDER BY rv.rev_no DESC`, { s: db_1.T.uuid(sheetId), n: db_1.T.int(revNo ?? 0) });
    if (!r)
        return null;
    return { meta: toMeta(r), diff: (0, http_1.safeJson)(r.diff_json, null), prevRevNo: r.prev_no ?? null };
}
/** Exact changes since the latest revision (what the next one would contain) */
async function pendingDiff(sheetId) {
    const latest = await (0, db_1.q1)(`SELECT TOP 1 ${META_COLS}, rv.snapshot_json FROM SheetRevisions rv LEFT JOIN Users u ON u.user_id = rv.created_by WHERE rv.sheet_id = @s ORDER BY rv.rev_no DESC`, { s: db_1.T.uuid(sheetId) });
    if (!latest)
        return { base: null, diff: null };
    const prev = (0, http_1.safeJson)(latest.snapshot_json, { cols: [], rows: [] });
    return { base: toMeta(latest), diff: (0, diff_1.diffSnapshots)(prev, await snapshotSheet(sheetId), await keyColumnIds(sheetId)) };
}
/** Quick count of rows touched since the latest revision (for a badge; the exact list is pendingDiff) */
async function pendingCounts(sheetId, since) {
    const r = await (0, db_1.q1)(`SELECT SUM(CASE WHEN is_deleted = 0 AND created_at > @t THEN 1 ELSE 0 END) AS added,
            SUM(CASE WHEN is_deleted = 0 AND created_at <= @t AND updated_at > @t THEN 1 ELSE 0 END) AS changed,
            SUM(CASE WHEN is_deleted = 1 AND created_at <= @t AND deleted_at > @t THEN 1 ELSE 0 END) AS removed
     FROM Rows WHERE sheet_id = @s`, { s: db_1.T.uuid(sheetId), t: db_1.T.dt(since) });
    return { added: Number(r?.added ?? 0), changed: Number(r?.changed ?? 0), removed: Number(r?.removed ?? 0) };
}
/**
 * Freezes the sheet as the next revision. The first revision may start at any number (to continue an Excel file's REV.8),
 * later ones are always latest + 1. Refuses when nothing changed since the latest one.
 */
async function createRevision(tx, sheetId, userId, note, firstNo) {
    await new mssql_1.default.Request(tx).input('r', mssql_1.default.NVarChar(200), `sheet-rev:${sheetId}`)
        .query(`DECLARE @x INT; EXEC @x = sp_getapplock @Resource = @r, @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 30000; IF @x < 0 THROW 50000, N'revision lock timeout', 1;`);
    const latest = await (0, db_1.q1)(`SELECT TOP 1 rev_no, snapshot_json FROM SheetRevisions WHERE sheet_id = @s ORDER BY rev_no DESC`, { s: db_1.T.uuid(sheetId) }, tx);
    const snap = await snapshotSheet(sheetId, tx);
    let diff = null;
    if (latest) {
        diff = (0, diff_1.diffSnapshots)((0, http_1.safeJson)(latest.snapshot_json, { cols: [], rows: [] }), snap, await keyColumnIds(sheetId));
        const nothing = !diff.added.length && !diff.changed.length && !diff.removed.length && !diff.columns.added.length && !diff.columns.removed.length && !diff.columns.renamed.length;
        if (nothing)
            return { error: `ไม่มีการเปลี่ยนแปลงจาก Rev.${latest.rev_no}` };
    }
    const revNo = latest ? latest.rev_no + 1 : Math.max(0, firstNo ?? 1);
    await (0, db_1.q)(`INSERT INTO SheetRevisions (sheet_id, rev_no, note, row_count, added_count, changed_count, removed_count, snapshot_json, diff_json, created_by)
     VALUES (@s, @n, @note, @rc, @a, @c, @r, @snap, @diff, @u)`, {
        s: db_1.T.uuid(sheetId), n: db_1.T.int(revNo), note: db_1.T.text(note), rc: db_1.T.int(snap.rows.length),
        a: db_1.T.int(diff?.added.length ?? 0), c: db_1.T.int(diff?.changed.length ?? 0), r: db_1.T.int(diff?.removed.length ?? 0),
        snap: db_1.T.text(JSON.stringify(snap)), diff: db_1.T.text(diff ? JSON.stringify(diff) : null), u: db_1.T.uuid(userId),
    }, tx);
    return { revNo, rowCount: snap.rows.length, diff };
}
//# sourceMappingURL=service.js.map