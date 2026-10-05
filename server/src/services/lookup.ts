import { q, T } from '../config/db';
import { AuthUser } from '../middleware/auth';
import { ColumnDef, DataType, NormResult, normalizeValue } from '../shared/cellValue';
import { badRequest } from '../shared/http';
import { LV, requireSheet } from '../shared/permissions';
import { loadColumns } from './cellWriter';
import { textExpr } from './rowQuery';

/**
 * "Relationship" between sheets, like a SQL foreign key + dependent drop-downs:
 * a select column takes its options from the distinct values of a column in another sheet and, optionally,
 * only from rows whose `parent.foreignColumnId` equals this row's `parent.localColumnId` value.
 */
export interface Lookup {
  sheetId: string;
  columnId: string;
  parent?: { localColumnId: string; foreignColumnId: string } | null;
}

const NOT_TEXTLIKE = new Set<DataType>(['multi_select', 'image']);

export const getLookup = (col: Pick<ColumnDef, 'validation' | 'data_type'>): Lookup | null => {
  const l = (col.validation as { lookup?: Lookup } | undefined)?.lookup;
  return l && (col.data_type === 'select' || col.data_type === 'multi_select') && l.sheetId && l.columnId ? l : null;
};

/** Distinct values of the source column (optionally limited to one parent value), as strings */
/** Most values returned for a drop-down (a code list can be a few thousand long) */
export const LOOKUP_LIMIT = 20_000;

export async function lookupValues(l: Lookup, parentValue: string | null, search?: string, exact?: string): Promise<string[]> {
  if (l.parent && (parentValue === null || parentValue === '')) return [];
  const cols = await loadColumns(l.sheetId);
  const src = cols.find((c) => c.column_id === l.columnId);
  if (!src || NOT_TEXTLIKE.has(src.data_type)) return [];
  const params: Record<string, unknown> = { s: T.uuid(l.sheetId), vc: T.uuid(l.columnId) };
  let join = '';
  if (l.parent) {
    const pc = cols.find((c) => c.column_id === l.parent!.foreignColumnId);
    if (!pc || NOT_TEXTLIKE.has(pc.data_type)) return [];
    params.pc = T.uuid(pc.column_id);
    params.pv = T.text(parentValue);
    join = `JOIN Cells p ON p.row_id = r.row_id AND p.column_id = @pc AND ${textExpr(pc.data_type, 'p')} = @pv`;
  }
  let like = '';
  if (search?.trim()) {
    params.sv = T.text(`%${search.trim().replace(/[%_[]/g, (m) => `[${m}]`)}%`);
    like = `AND ${textExpr(src.data_type, 'v')} LIKE @sv`;
  }
  if (exact !== undefined) { params.ev = T.text(exact); like += ` AND ${textExpr(src.data_type, 'v')} = @ev`; }
  const rows = await q(
    `SELECT DISTINCT TOP ${LOOKUP_LIMIT} ${textExpr(src.data_type, 'v')} AS val
     FROM Rows r JOIN Cells v ON v.row_id = r.row_id AND v.column_id = @vc ${join}
     WHERE r.sheet_id = @s AND r.is_deleted = 0 AND ${textExpr(src.data_type, 'v')} IS NOT NULL AND ${textExpr(src.data_type, 'v')} <> N'' ${like}
     ORDER BY val`,
    params,
  );
  return rows.map((r) => String(r.val));
}

/** Memoised option lookup for one request (an import checks thousands of cells against a handful of lists) */
export function lookupResolver() {
  const cache = new Map<string, Promise<string[]>>();
  return (l: Lookup, parentValue: string | null) => {
    const key = `${l.sheetId}|${l.columnId}|${l.parent?.foreignColumnId ?? ''}|${parentValue ?? ''}`;
    if (!cache.has(key)) cache.set(key, lookupValues(l, parentValue));
    return cache.get(key)!;
  };
}
export type LookupResolver = ReturnType<typeof lookupResolver>;

/** normalizeValue, but a lookup column is checked against the live values of its source */
export async function normalizeWithLookup(
  col: ColumnDef,
  raw: unknown,
  parentValue: string | null,
  resolve: LookupResolver,
  opts: { skipRequired?: boolean } = {},
): Promise<NormResult> {
  const l = getLookup(col);
  if (!l) return normalizeValue(col, raw, opts);
  let values = await resolve(l, parentValue);
  // a very long list is cut at LOOKUP_LIMIT: check the typed value against the source itself instead of rejecting it
  if (values.length >= LOOKUP_LIMIT && typeof raw === 'string' && raw.trim() && !values.includes(raw.trim())) values = [...values, ...(await lookupValues(l, parentValue, undefined, raw.trim()))];
  const res = normalizeValue({ ...col, options: values.map((v) => ({ value: v, label: v })) }, raw, opts);
  if (!res.ok && l.parent && !values.length && !(parentValue ?? '').trim()) return { ok: false, error: `กรุณาเลือกค่าของคอลัมน์ที่เชื่อมโยงก่อน ("${col.column_name}" ขึ้นกับคอลัมน์อื่น)` };
  return res;
}

/** The parent value (as text) of a dependent column, from the values being written or what is stored */
export async function parentValueOf(col: ColumnDef, values: Record<string, unknown>): Promise<string | null> {
  const l = getLookup(col);
  if (!l?.parent) return null;
  const v = values[l.parent.localColumnId];
  return v === null || v === undefined || v === '' ? null : String(Array.isArray(v) ? v[0] : v);
}

/** Validates a lookup definition when a column is created / edited */
export async function assertLookupConfig(user: AuthUser, ownSheetId: string, ownColumnId: string | null, l: Lookup) {
  await requireSheet(user, l.sheetId, LV.read);
  const foreign = await loadColumns(l.sheetId);
  const src = foreign.find((c) => c.column_id === l.columnId);
  if (!src) throw badRequest('ไม่พบคอลัมน์ต้นทางของตัวเลือก (อาจถูกลบแล้ว)');
  if (NOT_TEXTLIKE.has(src.data_type)) throw badRequest('คอลัมน์ต้นทางต้องเป็นข้อความ ตัวเลข วันที่ หรือตัวเลือกเดียว');
  if (l.parent) {
    if (!foreign.some((c) => c.column_id === l.parent!.foreignColumnId && !NOT_TEXTLIKE.has(c.data_type)))
      throw badRequest('ไม่พบคอลัมน์ที่ใช้เชื่อมโยงในตารางต้นทาง');
    const own = await loadColumns(ownSheetId);
    if (!own.some((c) => c.column_id === l.parent!.localColumnId && c.column_id !== ownColumnId && !NOT_TEXTLIKE.has(c.data_type)))
      throw badRequest('ไม่พบคอลัมน์ที่ใช้เชื่อมโยงในตารางนี้');
  }
}
