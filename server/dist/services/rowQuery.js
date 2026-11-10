"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Params = void 0;
exports.valueExpr = valueExpr;
exports.textExpr = textExpr;
exports.buildFilterSql = buildFilterSql;
exports.searchSql = searchSql;
exports.baseWhere = baseWhere;
exports.hydrateRows = hydrateRows;
exports.userNames = userNames;
exports.queryRows = queryRows;
exports.distinctValues = distinctValues;
const db_1 = require("../config/db");
const cellValue_1 = require("../shared/cellValue");
const http_1 = require("../shared/http");
const rowCount_1 = require("./rowCount");
/** Collects named parameters for a dynamically built statement */
class Params {
    constructor() {
        this.i = 0;
        this.values = {};
    }
    add(v) {
        const name = `p${this.i++}`;
        this.values[name] = v;
        return `@${name}`;
    }
}
exports.Params = Params;
const NUMERIC = new Set(['int', 'float']);
const DATEISH = new Set(['date', 'datetime']);
function valueExpr(t, a) {
    switch (t) {
        case 'int':
            return `${a}.value_int`;
        case 'float':
            return `${a}.value_float`;
        case 'date':
            return `CAST(${a}.value_date AS DATE)`;
        case 'datetime':
            return `${a}.value_date`;
        case 'boolean':
            return `${a}.value_bool`;
        case 'multi_select':
        case 'image':
            return `${a}.value_json`;
        default:
            return `${a}.value_text`;
    }
}
/** Grouping key used by the value checklist */
function keyExpr(t, a) {
    return DATEISH.has(t) ? `CONVERT(NVARCHAR(10), ${a}.value_date, 23)` : valueExpr(t, a);
}
/** Text representation used for LIKE searches */
function textExpr(t, a) {
    switch (t) {
        case 'int':
            return `CONVERT(NVARCHAR(40), ${a}.value_int)`;
        case 'float':
            return `CONVERT(NVARCHAR(60), ${a}.value_float)`;
        case 'date':
        case 'datetime':
            return `CONVERT(NVARCHAR(10), ${a}.value_date, 23)`;
        case 'boolean':
            return `CASE ${a}.value_bool WHEN 1 THEN N'true' WHEN 0 THEN N'false' END`;
        case 'multi_select':
        case 'image':
            return `${a}.value_json`;
        default:
            return `${a}.value_text`;
    }
}
function listCast(t) {
    switch (t) {
        case 'int':
            return 'TRY_CAST([value] AS BIGINT)';
        case 'float':
            return 'TRY_CAST([value] AS FLOAT)';
        case 'boolean':
            return 'TRY_CAST([value] AS BIT)';
        default:
            return '[value]';
    }
}
function normKey(t, v) {
    if (NUMERIC.has(t)) {
        const n = Number(v);
        if (!Number.isFinite(n))
            throw (0, http_1.badRequest)('ค่าตัวกรองต้องเป็นตัวเลข');
        return n;
    }
    if (t === 'boolean')
        return v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0;
    if (DATEISH.has(t))
        return String(v).slice(0, 10);
    return String(v);
}
const num = (v) => {
    const n = Number(typeof v === 'string' ? v.replace(/,/g, '') : v);
    if (!Number.isFinite(n))
        throw (0, http_1.badRequest)('ค่าตัวกรองต้องเป็นตัวเลข');
    return n;
};
const isoDate = (v) => {
    const s = String(v ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
        throw (0, http_1.badRequest)('ค่าตัวกรองวันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD');
    return s;
};
const exists = (cp, cond) => `EXISTS (SELECT 1 FROM Cells c WHERE c.row_id = r.row_id AND c.column_id = ${cp} AND ${cond})`;
function opCondition(p, cp, t, f) {
    const ve = valueExpr(t, 'c');
    const dateish = DATEISH.has(t);
    const expr = dateish ? 'CAST(c.value_date AS DATE)' : ve;
    const par = (v) => {
        if (dateish)
            return `CAST(${p.add(db_1.T.text(isoDate(v)))} AS DATE)`;
        if (NUMERIC.has(t))
            return p.add(db_1.T.float(num(v)));
        if (t === 'boolean')
            return p.add(db_1.T.bit(v === true || v === 'true' || v === 1));
        return p.add(db_1.T.text(String(v ?? '')));
    };
    const like = (pattern) => `${textExpr(t, 'c')} LIKE ${p.add(db_1.T.text(pattern))}`;
    const s = (0, http_1.likeEscape)(String(f.value ?? ''));
    switch (f.op) {
        case 'is_empty':
            return `NOT ${exists(cp, `${ve} IS NOT NULL`)}`;
        case 'not_empty':
            return exists(cp, `${ve} IS NOT NULL`);
        case 'contains':
            return s ? exists(cp, like(`%${s}%`)) : null;
        case 'not_contains':
            return s ? `NOT ${exists(cp, like(`%${s}%`))}` : null;
        case 'starts_with':
            return s ? exists(cp, like(`${s}%`)) : null;
        case 'ends_with':
            return s ? exists(cp, like(`%${s}`)) : null;
        case 'eq':
            return exists(cp, `${expr} = ${par(f.value)}`);
        case 'neq':
            return `NOT ${exists(cp, `${expr} = ${par(f.value)}`)}`;
        case 'gt':
            return exists(cp, `${expr} > ${par(f.value)}`);
        case 'gte':
            return exists(cp, `${expr} >= ${par(f.value)}`);
        case 'lt':
            return exists(cp, `${expr} < ${par(f.value)}`);
        case 'lte':
            return exists(cp, `${expr} <= ${par(f.value)}`);
        case 'between':
            return exists(cp, `${expr} >= ${par(f.value)} AND ${expr} <= ${par(f.value2)}`);
        default:
            return null;
    }
}
/** Builds WHERE fragments (alias r = Rows) for the given filters */
function buildFilterSql(filters, cols, p, exceptColumnId) {
    const conds = [];
    for (const f of filters ?? []) {
        if (!f || f.columnId === exceptColumnId)
            continue;
        const col = cols.get(f.columnId);
        if (!col)
            continue;
        const t = col.data_type;
        const cp = p.add(db_1.T.uuid(col.column_id));
        const ve = valueExpr(t, 'c');
        const blankCond = `NOT ${exists(cp, `${ve} IS NOT NULL`)}`;
        if (Array.isArray(f.values) && (f.values.length > 0 || f.blank !== undefined)) {
            let inCond = '(1 = 0)';
            if (f.values.length) {
                const jp = p.add(db_1.T.text(JSON.stringify(f.values.map((v) => normKey(t, v)))));
                inCond =
                    t === 'multi_select'
                        ? `EXISTS (SELECT 1 FROM Cells c CROSS APPLY OPENJSON(c.value_json) j
                 WHERE c.row_id = r.row_id AND c.column_id = ${cp} AND j.[value] IN (SELECT [value] FROM OPENJSON(${jp})))`
                        : exists(cp, `${keyExpr(t, 'c')} IN (SELECT ${listCast(t)} FROM OPENJSON(${jp}))`);
            }
            if (f.mode === 'exclude')
                conds.push(`(NOT (${inCond})${f.blank ? ` AND NOT (${blankCond})` : ''})`);
            else
                conds.push(`((${inCond})${f.blank ? ` OR (${blankCond})` : ''})`);
        }
        if (f.op) {
            const c = opCondition(p, cp, t, f);
            if (c)
                conds.push(`(${c})`);
        }
    }
    return conds;
}
function searchSql(search, p, columnIds) {
    const s = search?.trim();
    if (!s)
        return null;
    const sp = p.add(db_1.T.text(`%${(0, http_1.likeEscape)(s)}%`));
    const only = columnIds?.length ? `AND c.column_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(${p.add(db_1.T.text(JSON.stringify(columnIds)))}))` : '';
    return `EXISTS (SELECT 1 FROM Cells c JOIN Columns cc ON cc.column_id = c.column_id AND cc.is_deleted = 0
    WHERE c.row_id = r.row_id ${only} AND (c.value_text LIKE ${sp} OR c.value_json LIKE ${sp}
      OR CONVERT(NVARCHAR(40), c.value_int) LIKE ${sp} OR CONVERT(NVARCHAR(60), c.value_float) LIKE ${sp}
      OR CONVERT(NVARCHAR(10), c.value_date, 23) LIKE ${sp}))`;
}
function baseWhere(sheetId, cols, p, opts, exceptColumnId) {
    const where = [`r.sheet_id = ${p.add(db_1.T.uuid(sheetId))}`, 'r.is_deleted = 0'];
    where.push(...buildFilterSql(opts.filters, cols, p, exceptColumnId));
    const s = searchSql(opts.search, p, opts.searchColumns);
    if (s)
        where.push(s);
    return where.join(' AND ');
}
/** Loads full rows (with typed values + per-cell meta) for the given row records */
async function hydrateRows(rows, cols) {
    const colMap = new Map(cols.map((c) => [c.column_id, c]));
    const out = new Map();
    const users = new Set();
    for (const r of rows) {
        out.set(r.row_id, {
            id: r.row_id,
            order: r.row_order,
            values: {},
            meta: {},
            createdBy: r.created_by,
            createdAt: r.created_at,
            updatedBy: r.updated_by ?? null,
            updatedAt: r.updated_at,
            deletedAt: r.deleted_at ?? undefined,
            deletedBy: r.deleted_by ?? undefined,
        });
        users.add(r.created_by);
        if (r.updated_by)
            users.add(r.updated_by);
        if (r.deleted_by)
            users.add(r.deleted_by);
    }
    if (rows.length) {
        const cells = await (0, db_1.q)(`SELECT c.row_id, c.column_id, c.value_text, c.value_int, c.value_float, c.value_date, c.value_bool, c.value_json,
              c.updated_by, c.updated_at
       FROM Cells c WHERE c.row_id IN ${(0, db_1.idList)('@ids')}`, { ids: (0, db_1.jsonParam)(rows.map((r) => r.row_id)) });
        for (const c of cells) {
            const row = out.get(c.row_id);
            const col = colMap.get(c.column_id);
            if (!row || !col)
                continue;
            const v = (0, cellValue_1.fromStorage)(col.data_type, c);
            if (v !== null)
                row.values[c.column_id] = v;
            row.meta[c.column_id] = { by: c.updated_by, at: c.updated_at };
            users.add(c.updated_by);
        }
    }
    return { rows: rows.map((r) => out.get(r.row_id)), userIds: [...users] };
}
async function userNames(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length)
        return {};
    const rows = await (0, db_1.q)(`SELECT user_id, display_name, avatar_url FROM Users WHERE user_id IN ${(0, db_1.idList)('@ids')}`, { ids: (0, db_1.jsonParam)(list) });
    return Object.fromEntries(rows.map((r) => [r.user_id, { name: r.display_name, avatarUrl: r.avatar_url }]));
}
async function queryRows(sheetId, cols, opts) {
    const colMap = new Map(cols.map((c) => [c.column_id, c]));
    const p = new Params();
    const where = baseWhere(sheetId, colMap, p, opts);
    const joins = [];
    const orders = [];
    (opts.sorts ?? []).slice(0, 5).forEach((s, i) => {
        const dir = s.dir === 'desc' ? 'DESC' : 'ASC';
        if (s.columnId === '__row')
            return void orders.push(`r.row_order ${dir}`);
        if (s.columnId === '__created')
            return void orders.push(`r.created_at ${dir}`);
        if (s.columnId === '__updated')
            return void orders.push(`r.updated_at ${dir}`);
        const col = colMap.get(s.columnId);
        if (!col)
            return;
        const a = `s${i}`;
        joins.push(`LEFT JOIN Cells ${a} ON ${a}.row_id = r.row_id AND ${a}.column_id = ${p.add(db_1.T.uuid(col.column_id))}`);
        const e = valueExpr(col.data_type, a);
        orders.push(`CASE WHEN ${e} IS NULL THEN 1 ELSE 0 END`, `${e} ${dir}`);
    });
    orders.push('r.row_order ASC');
    const pageSize = (0, http_1.clamp)(Math.trunc(opts.pageSize ?? 100), 1, 1000);
    const page = Math.max(1, Math.trunc(opts.page ?? 1));
    // free-text search reads every cell of the sheet: refuse it on a huge sheet unless a column filter narrows the rows first
    if (opts.search?.trim() && !(opts.filters ?? []).some((f) => f && (f.op || f.values?.length)) && (await (0, rowCount_1.sheetRowCount)(sheetId)) > rowCount_1.BIG_SHEET_ROWS) {
        throw (0, http_1.badRequest)(`ชีตนี้มีข้อมูลมาก (เกิน ${rowCount_1.BIG_SHEET_ROWS.toLocaleString()} แถว) กรุณากรองด้วยคอลัมน์ เช่น วันที่ ก่อนค้นหาข้อความ`);
    }
    const countKey = JSON.stringify([opts.filters ?? [], opts.search ?? '', opts.searchColumns ?? []]);
    let total = (0, rowCount_1.cachedTotal)(sheetId, countKey);
    if (total === null) {
        const count = await (0, db_1.q1)(`SELECT COUNT_BIG(*) AS total FROM Rows r WHERE ${where}`, p.values);
        total = Number(count?.total ?? 0);
        (0, rowCount_1.rememberTotal)(sheetId, countKey, total);
    }
    const records = await (0, db_1.q)(`SELECT r.row_id, r.row_order, r.created_by, r.created_at, r.updated_by, r.updated_at
     FROM Rows r ${joins.join(' ')}
     WHERE ${where}
     ORDER BY ${orders.join(', ')}
     OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`, p.values);
    const { rows, userIds } = await hydrateRows(records, cols);
    return { rows, total, page, pageSize, users: await userNames(userIds) };
}
async function distinctValues(sheetId, cols, columnId, opts) {
    const colMap = new Map(cols.map((c) => [c.column_id, c]));
    const col = colMap.get(columnId);
    if (!col)
        throw (0, http_1.notFound)('ไม่พบคอลัมน์');
    const t = col.data_type;
    const p = new Params();
    const where = baseWhere(sheetId, colMap, p, { filters: opts.filters, search: opts.search }, columnId);
    const cp = p.add(db_1.T.uuid(columnId));
    const limit = (0, http_1.clamp)(Math.trunc(opts.limit ?? 500), 1, 2000);
    const vs = opts.valueSearch?.trim();
    let searchCond = '';
    if (vs) {
        const sp = p.add(db_1.T.text(`%${(0, http_1.likeEscape)(vs)}%`));
        if (t === 'select' || t === 'multi_select') {
            const options = JSON.parse(col.select_options || '[]');
            const matches = options.filter((o) => o.label.toLowerCase().includes(vs.toLowerCase())).map((o) => o.value);
            const mp = p.add(db_1.T.text(JSON.stringify(matches)));
            const k = t === 'multi_select' ? 'j.[value]' : 'dc.value_text';
            searchCond = `AND (${k} LIKE ${sp} OR ${k} IN (SELECT [value] FROM OPENJSON(${mp})))`;
        }
        else
            searchCond = `AND ${textExpr(t, 'dc')} LIKE ${sp}`;
    }
    const sql = t === 'multi_select'
        ? `SELECT TOP (${limit}) j.[value] AS k, COUNT(*) AS cnt
         FROM Rows r JOIN Cells dc ON dc.row_id = r.row_id AND dc.column_id = ${cp}
         CROSS APPLY OPENJSON(dc.value_json) j
         WHERE ${where} ${searchCond}
         GROUP BY j.[value] ORDER BY j.[value]`
        : `SELECT TOP (${limit}) ${keyExpr(t, 'dc')} AS k, COUNT(*) AS cnt
         FROM Rows r JOIN Cells dc ON dc.row_id = r.row_id AND dc.column_id = ${cp}
         WHERE ${where} AND ${valueExpr(t, 'dc')} IS NOT NULL ${searchCond}
         GROUP BY ${keyExpr(t, 'dc')} ORDER BY ${keyExpr(t, 'dc')}`;
    const rows = await (0, db_1.q)(sql, p.values);
    const blank = vs
        ? null
        : await (0, db_1.q1)(`SELECT COUNT(*) AS cnt FROM Rows r
         WHERE ${where} AND NOT EXISTS (SELECT 1 FROM Cells c WHERE c.row_id = r.row_id AND c.column_id = ${cp}
           AND ${valueExpr(t, 'c')} IS NOT NULL)`, p.values);
    const items = rows.map((r) => {
        let value = r.k;
        if (NUMERIC.has(t))
            value = Number(r.k);
        else if (t === 'boolean')
            value = !!r.k;
        return { value, count: Number(r.cnt) };
    });
    return { items, blankCount: blank ? Number(blank.cnt) : 0, truncated: rows.length >= limit };
}
//# sourceMappingURL=rowQuery.js.map