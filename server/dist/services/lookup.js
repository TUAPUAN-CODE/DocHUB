"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLookup = void 0;
exports.lookupValues = lookupValues;
exports.lookupResolver = lookupResolver;
exports.normalizeWithLookup = normalizeWithLookup;
exports.parentValueOf = parentValueOf;
exports.assertLookupConfig = assertLookupConfig;
const db_1 = require("../config/db");
const union_1 = require("./union");
const cellValue_1 = require("../shared/cellValue");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const cellWriter_1 = require("./cellWriter");
const rowQuery_1 = require("./rowQuery");
const NOT_TEXTLIKE = new Set(['multi_select', 'image']);
const getLookup = (col) => {
    const l = col.validation?.lookup;
    return l && (col.data_type === 'select' || col.data_type === 'multi_select') && (l.users || (l.sheetId && l.columnId)) ? l : null;
};
exports.getLookup = getLookup;
/** Display names of active users (with the tag, when given) */
async function userLookupValues(tag, search) {
    const params = {};
    let where = 'u.is_active = 1';
    if (tag?.trim()) {
        where += ` AND EXISTS (SELECT 1 FROM UserTagsAll ut JOIN Tags t ON t.tag_id = ut.tag_id WHERE ut.user_id = u.user_id AND t.tag_name = @tag)`;
        params.tag = db_1.T.text(tag.trim());
    }
    if (search?.trim()) {
        where += ' AND u.display_name LIKE @sv';
        params.sv = db_1.T.text(`%${search.trim().replace(/[%_[]/g, (m) => `[${m}]`)}%`);
    }
    const rows = await (0, db_1.q)(`SELECT DISTINCT TOP 1000 u.display_name AS val FROM Users u WHERE ${where} ORDER BY val`, params);
    return rows.map((r) => String(r.val));
}
/** Distinct values of the source column (optionally limited to one parent value), as strings */
/**
 * `limit`: first N values only (the drop-down shows a page and searches the whole table on the server as you type); no limit = all.
 * `exact`: only that value (to check a typed value without loading the list).
 */
async function lookupValues(l, parentValue, search, exact, limit) {
    if (l.users) {
        const v = await userLookupValues(l.users.tag, search);
        return exact !== undefined ? v.filter((x) => x === exact) : v;
    }
    if (l.parent && (parentValue === null || parentValue === ''))
        return [];
    // a union sheet is a copy of other sheets, refreshed when somebody opens it: refresh it from here too
    const own = await (0, db_1.q1)(`SELECT sheet_id, union_config FROM Sheets WHERE sheet_id = @s`, { s: db_1.T.uuid(l.sheetId) });
    if (own?.union_config)
        (0, union_1.syncUnionIfStale)(own, 60_000);
    const cols = await (0, cellWriter_1.loadColumns)(l.sheetId);
    const src = cols.find((c) => c.column_id === l.columnId);
    if (!src || NOT_TEXTLIKE.has(src.data_type))
        return [];
    const params = { s: db_1.T.uuid(l.sheetId), vc: db_1.T.uuid(l.columnId) };
    let join = '';
    if (l.parent) {
        const pc = cols.find((c) => c.column_id === l.parent.foreignColumnId);
        if (!pc || NOT_TEXTLIKE.has(pc.data_type))
            return [];
        params.pc = db_1.T.uuid(pc.column_id);
        params.pv = db_1.T.text(parentValue);
        join = `JOIN Cells p ON p.row_id = r.row_id AND p.column_id = @pc AND ${(0, rowQuery_1.textExpr)(pc.data_type, 'p')} = @pv`;
    }
    let like = '';
    if (search?.trim()) {
        params.sv = db_1.T.text(`%${search.trim().replace(/[%_[]/g, (m) => `[${m}]`)}%`);
        like = `AND ${(0, rowQuery_1.textExpr)(src.data_type, 'v')} LIKE @sv`;
    }
    if (exact !== undefined) {
        params.ev = db_1.T.text(exact);
        like += ` AND ${(0, rowQuery_1.textExpr)(src.data_type, 'v')} = @ev`;
    }
    const rows = await (0, db_1.q)(`SELECT DISTINCT ${limit ? `TOP ${Math.max(1, Math.min(100000, Math.floor(limit)))}` : ''} ${(0, rowQuery_1.textExpr)(src.data_type, 'v')} AS val
     FROM Rows r JOIN Cells v ON v.row_id = r.row_id AND v.column_id = @vc ${join}
     WHERE r.sheet_id = @s AND r.is_deleted = 0 AND ${(0, rowQuery_1.textExpr)(src.data_type, 'v')} IS NOT NULL AND ${(0, rowQuery_1.textExpr)(src.data_type, 'v')} <> N'' ${like}
     ORDER BY val`, params);
    return rows.map((r) => String(r.val));
}
/** Memoised option lookup for one request (an import checks thousands of cells against a handful of lists) */
function lookupResolver() {
    const cache = new Map();
    return (l, parentValue, exact) => {
        const key = l.users ? `users|${l.users.tag ?? ''}|${exact ?? ''}` : `${l.sheetId}|${l.columnId}|${l.parent?.foreignColumnId ?? ''}|${parentValue ?? ''}|${exact ?? ''}`;
        if (!cache.has(key))
            cache.set(key, lookupValues(l, parentValue, undefined, exact));
        return cache.get(key);
    };
}
/** normalizeValue, but a lookup column is checked against the live values of its source */
async function normalizeWithLookup(col, raw, parentValue, resolve, opts = {}) {
    const l = (0, exports.getLookup)(col);
    if (!l)
        return (0, cellValue_1.normalizeValue)(col, raw, opts);
    // the typed value is checked against the source itself (an exact lookup), so the size of the source list never matters
    const typed = (Array.isArray(raw) ? raw : [raw]).filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => String(x).trim()).filter(Boolean);
    const found = new Set();
    for (const t of [...new Set(typed)])
        for (const v of await resolve(l, parentValue, t))
            found.add(v);
    const values = [...found];
    const res = (0, cellValue_1.normalizeValue)({ ...col, options: values.map((v) => ({ value: v, label: v })) }, raw, opts);
    if (!res.ok && l.parent && !values.length && !(parentValue ?? '').trim())
        return { ok: false, error: `กรุณาเลือกค่าของคอลัมน์ที่เชื่อมโยงก่อน ("${col.column_name}" ขึ้นกับคอลัมน์อื่น)` };
    return res;
}
/** The parent value (as text) of a dependent column, from the values being written or what is stored */
async function parentValueOf(col, values) {
    const l = (0, exports.getLookup)(col);
    if (!l?.parent)
        return null;
    const v = values[l.parent.localColumnId];
    return v === null || v === undefined || v === '' ? null : String(Array.isArray(v) ? v[0] : v);
}
/** Validates a lookup definition when a column is created / edited */
async function assertLookupConfig(user, ownSheetId, ownColumnId, l) {
    if (l.users) {
        if (l.parent)
            throw (0, http_1.badRequest)('ตัวเลือกจากรายชื่อผู้ใช้ใช้การเชื่อมโยงกับคอลัมน์อื่นไม่ได้');
        return;
    }
    if (!l.sheetId || !l.columnId)
        throw (0, http_1.badRequest)('เลือกตารางและคอลัมน์ต้นทางของตัวเลือกให้ครบ');
    await (0, permissions_1.requireSheet)(user, l.sheetId, permissions_1.LV.read);
    const foreign = await (0, cellWriter_1.loadColumns)(l.sheetId);
    const src = foreign.find((c) => c.column_id === l.columnId);
    if (!src)
        throw (0, http_1.badRequest)('ไม่พบคอลัมน์ต้นทางของตัวเลือก (อาจถูกลบแล้ว)');
    if (NOT_TEXTLIKE.has(src.data_type))
        throw (0, http_1.badRequest)('คอลัมน์ต้นทางต้องเป็นข้อความ ตัวเลข วันที่ หรือตัวเลือกเดียว');
    if (l.parent) {
        if (!foreign.some((c) => c.column_id === l.parent.foreignColumnId && !NOT_TEXTLIKE.has(c.data_type)))
            throw (0, http_1.badRequest)('ไม่พบคอลัมน์ที่ใช้เชื่อมโยงในตารางต้นทาง');
        const own = await (0, cellWriter_1.loadColumns)(ownSheetId);
        if (!own.some((c) => c.column_id === l.parent.localColumnId && c.column_id !== ownColumnId && !NOT_TEXTLIKE.has(c.data_type)))
            throw (0, http_1.badRequest)('ไม่พบคอลัมน์ที่ใช้เชื่อมโยงในตารางนี้');
    }
}
//# sourceMappingURL=lookup.js.map