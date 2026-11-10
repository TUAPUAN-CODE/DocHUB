import { idList, jsonParam, q, q1, T } from '../config/db';
import { DataType, fromStorage } from '../shared/cellValue';
import { badRequest, clamp, likeEscape, notFound } from '../shared/http';
import { BIG_SHEET_ROWS, cachedTotal, rememberTotal, sheetRowCount } from './rowCount';

export type FilterOp =
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'is_empty'
  | 'not_empty';

export interface ColumnFilter {
  columnId: string;
  /** include = keep rows whose value is in `values`; exclude = drop them */
  mode?: 'include' | 'exclude';
  values?: (string | number | boolean)[];
  /** include mode: also keep blanks. exclude mode: also drop blanks */
  blank?: boolean;
  op?: FilterOp;
  value?: unknown;
  value2?: unknown;
}

export interface SortSpec {
  columnId: string; // column id or __row | __created | __updated
  dir: 'asc' | 'desc';
}

export interface RowQuery {
  page?: number;
  pageSize?: number;
  sorts?: SortSpec[];
  filters?: ColumnFilter[];
  search?: string;
  /** limit the free-text search to these columns (e.g. Sub Doc No. and Short Code); empty = every column */
  searchColumns?: string[];
}

/** Collects named parameters for a dynamically built statement */
export class Params {
  private i = 0;
  readonly values: Record<string, unknown> = {};
  add(v: unknown) {
    const name = `p${this.i++}`;
    this.values[name] = v;
    return `@${name}`;
  }
}

const NUMERIC = new Set<DataType>(['int', 'float']);
const DATEISH = new Set<DataType>(['date', 'datetime']);

export function valueExpr(t: DataType, a: string) {
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
function keyExpr(t: DataType, a: string) {
  return DATEISH.has(t) ? `CONVERT(NVARCHAR(10), ${a}.value_date, 23)` : valueExpr(t, a);
}

/** Text representation used for LIKE searches */
export function textExpr(t: DataType, a: string) {
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

function listCast(t: DataType) {
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

function normKey(t: DataType, v: unknown) {
  if (NUMERIC.has(t)) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw badRequest('ค่าตัวกรองต้องเป็นตัวเลข');
    return n;
  }
  if (t === 'boolean') return v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0;
  if (DATEISH.has(t)) return String(v).slice(0, 10);
  return String(v);
}

const num = (v: unknown) => {
  const n = Number(typeof v === 'string' ? v.replace(/,/g, '') : v);
  if (!Number.isFinite(n)) throw badRequest('ค่าตัวกรองต้องเป็นตัวเลข');
  return n;
};
const isoDate = (v: unknown) => {
  const s = String(v ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest('ค่าตัวกรองวันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD');
  return s;
};

const exists = (cp: string, cond: string) =>
  `EXISTS (SELECT 1 FROM Cells c WHERE c.row_id = r.row_id AND c.column_id = ${cp} AND ${cond})`;

function opCondition(p: Params, cp: string, t: DataType, f: ColumnFilter): string | null {
  const ve = valueExpr(t, 'c');
  const dateish = DATEISH.has(t);
  const expr = dateish ? 'CAST(c.value_date AS DATE)' : ve;
  const par = (v: unknown) => {
    if (dateish) return `CAST(${p.add(T.text(isoDate(v)))} AS DATE)`;
    if (NUMERIC.has(t)) return p.add(T.float(num(v)));
    if (t === 'boolean') return p.add(T.bit(v === true || v === 'true' || v === 1));
    return p.add(T.text(String(v ?? '')));
  };
  const like = (pattern: string) => `${textExpr(t, 'c')} LIKE ${p.add(T.text(pattern))}`;
  const s = likeEscape(String(f.value ?? ''));
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
export function buildFilterSql(
  filters: ColumnFilter[] | undefined,
  cols: Map<string, any>,
  p: Params,
  exceptColumnId?: string,
): string[] {
  const conds: string[] = [];
  for (const f of filters ?? []) {
    if (!f || f.columnId === exceptColumnId) continue;
    const col = cols.get(f.columnId);
    if (!col) continue;
    const t = col.data_type as DataType;
    const cp = p.add(T.uuid(col.column_id));
    const ve = valueExpr(t, 'c');
    const blankCond = `NOT ${exists(cp, `${ve} IS NOT NULL`)}`;

    if (Array.isArray(f.values) && (f.values.length > 0 || f.blank !== undefined)) {
      let inCond = '(1 = 0)';
      if (f.values.length) {
        const jp = p.add(T.text(JSON.stringify(f.values.map((v) => normKey(t, v)))));
        inCond =
          t === 'multi_select'
            ? `EXISTS (SELECT 1 FROM Cells c CROSS APPLY OPENJSON(c.value_json) j
                 WHERE c.row_id = r.row_id AND c.column_id = ${cp} AND j.[value] IN (SELECT [value] FROM OPENJSON(${jp})))`
            : exists(cp, `${keyExpr(t, 'c')} IN (SELECT ${listCast(t)} FROM OPENJSON(${jp}))`);
      }
      if (f.mode === 'exclude') conds.push(`(NOT (${inCond})${f.blank ? ` AND NOT (${blankCond})` : ''})`);
      else conds.push(`((${inCond})${f.blank ? ` OR (${blankCond})` : ''})`);
    }
    if (f.op) {
      const c = opCondition(p, cp, t, f);
      if (c) conds.push(`(${c})`);
    }
  }
  return conds;
}

export function searchSql(search: string | undefined, p: Params, columnIds?: string[]): string | null {
  const s = search?.trim();
  if (!s) return null;
  const sp = p.add(T.text(`%${likeEscape(s)}%`));
  const only = columnIds?.length ? `AND c.column_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(${p.add(T.text(JSON.stringify(columnIds)))}))` : '';
  return `EXISTS (SELECT 1 FROM Cells c JOIN Columns cc ON cc.column_id = c.column_id AND cc.is_deleted = 0
    WHERE c.row_id = r.row_id ${only} AND (c.value_text LIKE ${sp} OR c.value_json LIKE ${sp}
      OR CONVERT(NVARCHAR(40), c.value_int) LIKE ${sp} OR CONVERT(NVARCHAR(60), c.value_float) LIKE ${sp}
      OR CONVERT(NVARCHAR(10), c.value_date, 23) LIKE ${sp}))`;
}

export function baseWhere(sheetId: string, cols: Map<string, any>, p: Params, opts: RowQuery, exceptColumnId?: string) {
  const where = [`r.sheet_id = ${p.add(T.uuid(sheetId))}`, 'r.is_deleted = 0'];
  where.push(...buildFilterSql(opts.filters, cols, p, exceptColumnId));
  const s = searchSql(opts.search, p, opts.searchColumns);
  if (s) where.push(s);
  return where.join(' AND ');
}

export interface RowOut {
  id: string;
  order: number;
  values: Record<string, unknown>;
  meta: Record<string, { by: string; at: Date }>;
  createdBy: string;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

/** Loads full rows (with typed values + per-cell meta) for the given row records */
export async function hydrateRows(rows: any[], cols: any[]) {
  const colMap = new Map(cols.map((c) => [c.column_id, c]));
  const out = new Map<string, RowOut>();
  const users = new Set<string>();
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
    if (r.updated_by) users.add(r.updated_by);
    if (r.deleted_by) users.add(r.deleted_by);
  }
  if (rows.length) {
    const cells = await q(
      `SELECT c.row_id, c.column_id, c.value_text, c.value_int, c.value_float, c.value_date, c.value_bool, c.value_json,
              c.updated_by, c.updated_at
       FROM Cells c WHERE c.row_id IN ${idList('@ids')}`,
      { ids: jsonParam(rows.map((r) => r.row_id)) },
    );
    for (const c of cells) {
      const row = out.get(c.row_id);
      const col = colMap.get(c.column_id);
      if (!row || !col) continue;
      const v = fromStorage(col.data_type, c);
      if (v !== null) row.values[c.column_id] = v;
      row.meta[c.column_id] = { by: c.updated_by, at: c.updated_at };
      users.add(c.updated_by);
    }
  }
  return { rows: rows.map((r) => out.get(r.row_id)!), userIds: [...users] };
}

export async function userNames(ids: string[]) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  const rows = await q(
    `SELECT user_id, display_name, avatar_url FROM Users WHERE user_id IN ${idList('@ids')}`,
    { ids: jsonParam(list) },
  );
  return Object.fromEntries(rows.map((r) => [r.user_id, { name: r.display_name, avatarUrl: r.avatar_url }]));
}

export async function queryRows(sheetId: string, cols: any[], opts: RowQuery) {
  const colMap = new Map(cols.map((c) => [c.column_id, c]));
  const p = new Params();
  const where = baseWhere(sheetId, colMap, p, opts);
  const joins: string[] = [];
  const orders: string[] = [];
  (opts.sorts ?? []).slice(0, 5).forEach((s, i) => {
    const dir = s.dir === 'desc' ? 'DESC' : 'ASC';
    if (s.columnId === '__row') return void orders.push(`r.row_order ${dir}`);
    if (s.columnId === '__created') return void orders.push(`r.created_at ${dir}`);
    if (s.columnId === '__updated') return void orders.push(`r.updated_at ${dir}`);
    const col = colMap.get(s.columnId);
    if (!col) return;
    const a = `s${i}`;
    joins.push(`LEFT JOIN Cells ${a} ON ${a}.row_id = r.row_id AND ${a}.column_id = ${p.add(T.uuid(col.column_id))}`);
    const e = valueExpr(col.data_type, a);
    orders.push(`CASE WHEN ${e} IS NULL THEN 1 ELSE 0 END`, `${e} ${dir}`);
  });
  orders.push('r.row_order ASC');

  const pageSize = clamp(Math.trunc(opts.pageSize ?? 100), 1, 1000);
  const page = Math.max(1, Math.trunc(opts.page ?? 1));
  // free-text search reads every cell of the sheet: refuse it on a huge sheet unless a column filter narrows the rows first
  if (opts.search?.trim() && !(opts.filters ?? []).some((f) => f && (f.op || f.values?.length)) && (await sheetRowCount(sheetId)) > BIG_SHEET_ROWS) {
    throw badRequest(`ชีตนี้มีข้อมูลมาก (เกิน ${BIG_SHEET_ROWS.toLocaleString()} แถว) กรุณากรองด้วยคอลัมน์ เช่น วันที่ ก่อนค้นหาข้อความ`);
  }
  const countKey = JSON.stringify([opts.filters ?? [], opts.search ?? '', opts.searchColumns ?? []]);
  let total = cachedTotal(sheetId, countKey);
  if (total === null) {
    const count = await q1(`SELECT COUNT_BIG(*) AS total FROM Rows r WHERE ${where}`, p.values);
    total = Number(count?.total ?? 0);
    rememberTotal(sheetId, countKey, total);
  }
  const records = await q(
    `SELECT r.row_id, r.row_order, r.created_by, r.created_at, r.updated_by, r.updated_at
     FROM Rows r ${joins.join(' ')}
     WHERE ${where}
     ORDER BY ${orders.join(', ')}
     OFFSET ${(page - 1) * pageSize} ROWS FETCH NEXT ${pageSize} ROWS ONLY`,
    p.values,
  );
  const { rows, userIds } = await hydrateRows(records, cols);
  return { rows, total, page, pageSize, users: await userNames(userIds) };
}

export async function distinctValues(
  sheetId: string,
  cols: any[],
  columnId: string,
  opts: { filters?: ColumnFilter[]; search?: string; valueSearch?: string; limit?: number },
) {
  const colMap = new Map(cols.map((c) => [c.column_id, c]));
  const col = colMap.get(columnId);
  if (!col) throw notFound('ไม่พบคอลัมน์');
  const t = col.data_type as DataType;
  const p = new Params();
  const where = baseWhere(sheetId, colMap, p, { filters: opts.filters, search: opts.search }, columnId);
  const cp = p.add(T.uuid(columnId));
  const limit = clamp(Math.trunc(opts.limit ?? 500), 1, 2000);
  const vs = opts.valueSearch?.trim();

  let searchCond = '';
  if (vs) {
    const sp = p.add(T.text(`%${likeEscape(vs)}%`));
    if (t === 'select' || t === 'multi_select') {
      const options: { value: string; label: string }[] = JSON.parse(col.select_options || '[]');
      const matches = options.filter((o) => o.label.toLowerCase().includes(vs.toLowerCase())).map((o) => o.value);
      const mp = p.add(T.text(JSON.stringify(matches)));
      const k = t === 'multi_select' ? 'j.[value]' : 'dc.value_text';
      searchCond = `AND (${k} LIKE ${sp} OR ${k} IN (SELECT [value] FROM OPENJSON(${mp})))`;
    } else searchCond = `AND ${textExpr(t, 'dc')} LIKE ${sp}`;
  }

  const sql =
    t === 'multi_select'
      ? `SELECT TOP (${limit}) j.[value] AS k, COUNT(*) AS cnt
         FROM Rows r JOIN Cells dc ON dc.row_id = r.row_id AND dc.column_id = ${cp}
         CROSS APPLY OPENJSON(dc.value_json) j
         WHERE ${where} ${searchCond}
         GROUP BY j.[value] ORDER BY j.[value]`
      : `SELECT TOP (${limit}) ${keyExpr(t, 'dc')} AS k, COUNT(*) AS cnt
         FROM Rows r JOIN Cells dc ON dc.row_id = r.row_id AND dc.column_id = ${cp}
         WHERE ${where} AND ${valueExpr(t, 'dc')} IS NOT NULL ${searchCond}
         GROUP BY ${keyExpr(t, 'dc')} ORDER BY ${keyExpr(t, 'dc')}`;
  const rows = await q(sql, p.values);
  const blank = vs
    ? null
    : await q1(
        `SELECT COUNT(*) AS cnt FROM Rows r
         WHERE ${where} AND NOT EXISTS (SELECT 1 FROM Cells c WHERE c.row_id = r.row_id AND c.column_id = ${cp}
           AND ${valueExpr(t, 'c')} IS NOT NULL)`,
        p.values,
      );
  const items = rows.map((r) => {
    let value: unknown = r.k;
    if (NUMERIC.has(t)) value = Number(r.k);
    else if (t === 'boolean') value = !!r.k;
    return { value, count: Number(r.cnt) };
  });
  return { items, blankCount: blank ? Number(blank.cnt) : 0, truncated: rows.length >= limit };
}
