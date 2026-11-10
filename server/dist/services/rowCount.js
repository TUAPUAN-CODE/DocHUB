"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BIG_SHEET_ROWS = exports.invalidateRowCount = void 0;
exports.cachedTotal = cachedTotal;
exports.rememberTotal = rememberTotal;
exports.sheetRowCount = sheetRowCount;
const db_1 = require("../config/db");
const cluster_1 = require("./cluster");
/**
 * Counting the rows of a big sheet on every page load is the most expensive part of paging (the table is scanned each time).
 * Totals of sheets with ≥ CACHE_FROM rows are remembered for a few seconds, and dropped as soon as rows are added / removed.
 */
const CACHE_FROM = 50_000;
const TTL_MS = 20_000;
const cache = new Map();
const dropLocal = (sheetId) => {
    const s = sheetId.toLowerCase();
    for (const [k, v] of cache)
        if (v.sheet === s)
            cache.delete(k);
};
(0, cluster_1.onBroadcast)('rowcount', dropLocal);
const invalidateRowCount = (sheetId) => { dropLocal(sheetId); (0, cluster_1.broadcast)('rowcount', sheetId); };
exports.invalidateRowCount = invalidateRowCount;
function cachedTotal(sheetId, key) {
    const hit = cache.get(`${sheetId.toLowerCase()}|${key}`);
    return hit && Date.now() - hit.at < TTL_MS ? hit.total : null;
}
function rememberTotal(sheetId, key, total) {
    if (total < CACHE_FROM)
        return;
    if (cache.size > 500)
        cache.clear();
    cache.set(`${sheetId.toLowerCase()}|${key}`, { at: Date.now(), total, sheet: sheetId.toLowerCase() });
}
/** Rows of the sheet (no filter) — cheap: one seek + range on IX_Rows_Sheet */
async function sheetRowCount(sheetId) {
    const hit = cachedTotal(sheetId, '*');
    if (hit !== null)
        return hit;
    const r = await (0, db_1.q1)(`SELECT COUNT_BIG(*) AS n FROM Rows WHERE sheet_id = @s AND is_deleted = 0`, { s: db_1.T.uuid(sheetId) });
    const n = Number(r?.n ?? 0);
    rememberTotal(sheetId, '*', n);
    return n;
}
/** A sheet this big needs a filter before a free-text search (a LIKE '%…%' reads every cell of the table) */
exports.BIG_SHEET_ROWS = Math.max(10_000, Number(process.env.BIG_SHEET_ROWS) || 300_000);
//# sourceMappingURL=rowCount.js.map