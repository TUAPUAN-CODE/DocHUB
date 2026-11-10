"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffIsEmpty = exports.diffCounts = void 0;
exports.diffSnapshots = diffSnapshots;
const empty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const same = (a, b) => (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);
const text = (v) => (empty(v) ? '' : Array.isArray(v) ? v.join(', ') : String(v));
/** The words a person uses to find the row again: values of the key columns (default: the first column) */
function refOf(row, snap, keyIds) {
    const keys = (keyIds.length ? keyIds : snap.cols.filter((c) => !c.stamp).slice(0, 1).map((c) => c.id)).filter((id) => snap.cols.some((c) => c.id === id));
    const label = keys.map((id) => text(row.v[id])).filter(Boolean).join(' · ') || `แถว ${row.no}`;
    const ref = { id: row.id, no: row.no, label };
    for (const c of snap.cols) {
        if (!c.stamp || empty(row.v[c.id]))
            continue;
        if (c.type === 'date' || c.type === 'datetime')
            ref.at = row.v[c.id];
        else
            ref.by = row.v[c.id];
    }
    return ref;
}
const valuesOf = (row, snap) => snap.cols.filter((c) => !c.stamp && !empty(row.v[c.id])).map((c) => ({ columnId: c.id, name: c.name, type: c.type, value: row.v[c.id] }));
/**
 * What changed from `prev` to `cur`, row by row (rows are matched by their id, so a re-ordered or renamed row is still the same row).
 * Auto-stamped columns (last updated date / name) never count as a change on their own.
 */
function diffSnapshots(prev, cur, keyIds = []) {
    const prevRows = new Map(prev.rows.map((r) => [r.id, r]));
    const curIds = new Set(cur.rows.map((r) => r.id));
    const prevCols = new Map(prev.cols.map((c) => [c.id, c]));
    const curCols = new Map(cur.cols.map((c) => [c.id, c]));
    const compared = cur.cols.filter((c) => !c.stamp && prevCols.has(c.id));
    const out = {
        added: [], removed: [], changed: [],
        columns: {
            added: cur.cols.filter((c) => !prevCols.has(c.id)).map((c) => c.name),
            removed: prev.cols.filter((c) => !curCols.has(c.id)).map((c) => c.name),
            renamed: cur.cols.filter((c) => prevCols.has(c.id) && prevCols.get(c.id).name !== c.name).map((c) => ({ from: prevCols.get(c.id).name, to: c.name })),
        },
    };
    for (const r of cur.rows) {
        const p = prevRows.get(r.id);
        if (!p) {
            out.added.push({ ...refOf(r, cur, keyIds), values: valuesOf(r, cur) });
            continue;
        }
        const fields = compared.filter((c) => !same(p.v[c.id], r.v[c.id])).map((c) => ({ columnId: c.id, name: c.name, type: c.type, old: p.v[c.id] ?? null, new: r.v[c.id] ?? null }));
        if (fields.length)
            out.changed.push({ ...refOf(r, cur, keyIds), fields });
    }
    for (const p of prev.rows)
        if (!curIds.has(p.id))
            out.removed.push({ ...refOf(p, prev, keyIds), values: valuesOf(p, prev) });
    return out;
}
const diffCounts = (d) => ({ added: d.added.length, changed: d.changed.length, removed: d.removed.length });
exports.diffCounts = diffCounts;
const diffIsEmpty = (d) => !d.added.length && !d.changed.length && !d.removed.length && !d.columns.added.length && !d.columns.removed.length && !d.columns.renamed.length;
exports.diffIsEmpty = diffIsEmpty;
//# sourceMappingURL=diff.js.map