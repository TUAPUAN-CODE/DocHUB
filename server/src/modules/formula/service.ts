import { idList, jsonParam, q, T, Tx, withTx } from '../../config/db';
import { env } from '../../config/env';
import { AuthUser } from '../../middleware/auth';
import { CellValue, ColumnDef, DataType, fromStorage, normalizeValue, toColumnDef } from '../../shared/cellValue';
import { badRequest } from '../../shared/http';
import { logger } from '../../shared/logger';
import { ExtraWrite } from '../../services/hooks';
import { loadColumns, writeCell } from '../../services/cellWriter';
import { emitToSheet } from '../../socket';
import { ColumnRef, compileFormula, displayFormula, SourceDef, topoOrder } from './compile';
import { evaluate } from './evaluator';
import { toBool, toDate, toNumber, toText, parts } from './convert';
import { DateV, EvalCtx, FormulaSyntaxError, FValue, isDateV, Node } from './types';
import { collectXrefs, parse } from './parser';
import { LV, requireSheet } from '../../shared/permissions';

/** Column types a formula may produce (the result is stored exactly like a typed value of that column) */
export const FORMULA_TYPES = new Set<string>(['varchar', 'text', 'int', 'float', 'date', 'datetime', 'boolean']);

export const formulaExprOf = (col: { data_type: string; validation?: Record<string, any> | null }): string | null => {
  const e = (col.validation as { formula?: { expr?: string } } | null | undefined)?.formula?.expr;
  return e && FORMULA_TYPES.has(col.data_type) ? e : null;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** stored cell value → formula value */
export function toF(type: DataType | string, v: CellValue): FValue {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return type === 'multi_select' ? v.join(', ') : null;
  if (type === 'date' && typeof v === 'string') return toDate(v) ? ({ kind: 'date', ms: toDate(v)!.ms } as DateV) : null;
  if (type === 'datetime' && typeof v === 'string') { const ms = Date.parse(v); return Number.isNaN(ms) ? null : ({ kind: 'datetime', ms } as DateV); }
  return v as FValue;
}

/** formula result → raw value for the column's own normalizer */
export function fromF(result: FValue, type: DataType | string): unknown {
  if (result === null) return null;
  const tz = env.tzOffsetMinutes;
  if (isDateV(result)) {
    const p = parts(result, { tzOffsetMinutes: tz });
    switch (type) {
      case 'date': return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
      case 'datetime': return new Date(result.ms - (result.kind === 'date' ? tz * 60_000 : 0)).toISOString();
      case 'varchar': case 'text': return result.kind === 'date' ? `${p.y}-${pad2(p.m)}-${pad2(p.d)}` : `${p.y}-${pad2(p.m)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}`;
      default: return toNumber(result);
    }
  }
  switch (type) {
    case 'int': { const n = toNumber(result); return n === null ? null : Math.round(n); }
    case 'float': return toNumber(result);
    case 'boolean': return toBool(result);
    case 'date': case 'datetime': { const d = toDate(result); return d ? fromF(d, type) : null; }
    default: return toText(result);
  }
}

export interface FormulaCfg { expr: string; sources?: SourceDef[] }
export const formulaCfgOf = (col: { data_type: string; validation?: Record<string, any> | null }): FormulaCfg | null => {
  const f = (col.validation as { formula?: FormulaCfg } | null | undefined)?.formula;
  return f?.expr && FORMULA_TYPES.has(col.data_type) ? f : null;
};

interface PlanItem { id: string; def: ColumnDef; ast: Node; deps: string[]; sourceSheets: string[] }
export interface Plan {
  items: PlanItem[]; types: Map<string, DataType>; defs: Map<string, ColumnDef>; needed: string[];
  /** other sheets read by LOOKUP (loaded once per recalculation) */
  lookup: () => Promise<EvalCtx['lookup'] | undefined>;
}

const refsOf = (cols: any[]): ColumnRef[] => cols.map((c) => ({ id: c.column_id, name: c.column_name, dataType: c.data_type }));

/* ---------------- other sheets (LOOKUP) ---------------- */
interface SourceData { types: Map<string, string>; rows: Map<string, Map<string, FValue>>; order: string[] }
const sourceCache = new Map<string, { at: number; data: Promise<SourceData> }>();
const SOURCE_TTL_MS = 5000;
const SOURCE_CELL_CAP = 200_000;
/** a write to a sheet makes what other sheets read from it stale */
export const invalidateSource = (sheetId: string) => { sourceCache.delete(sheetId.toLowerCase()); };

async function loadSourceData(sheetId: string, columnIds: string[]): Promise<SourceData> {
  const key = `${sheetId.toLowerCase()}`;
  const hit = sourceCache.get(key);
  if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.data;
  const data = (async () => {
    const cols = await loadColumns(sheetId);
    const types = new Map(cols.map((c) => [c.column_id as string, c.data_type as string]));
    const ids = [...new Set(columnIds)];
    const cells = ids.length ? await q(
      `SELECT TOP (${SOURCE_CELL_CAP}) c.row_id, c.column_id, r.row_order, c.value_text, c.value_int, c.value_float, c.value_date, c.value_bool, c.value_json
       FROM Cells c JOIN Rows r ON r.row_id = c.row_id
       WHERE r.sheet_id = @s AND r.is_deleted = 0 AND c.column_id IN ${idList('@cc')}
       ORDER BY r.row_order`, { s: T.uuid(sheetId), cc: jsonParam(ids) }) : [];
    if (cells.length >= SOURCE_CELL_CAP) logger.warn(`LOOKUP source ${sheetId} is larger than ${SOURCE_CELL_CAP} cells — only the first rows are used`);
    const rows = new Map<string, Map<string, FValue>>();
    const order: string[] = [];
    for (const c of cells) {
      const t = types.get(c.column_id);
      if (!t) continue;
      if (!rows.has(c.row_id)) { rows.set(c.row_id, new Map()); order.push(c.row_id); }
      rows.get(c.row_id)!.set(c.column_id, toF(t, fromStorage(t as DataType, c)));
    }
    return { types, rows, order } as SourceData;
  })();
  sourceCache.set(key, { at: Date.now(), data });
  data.catch(() => sourceCache.delete(key));
  return data;
}

const keyOf = (v: FValue) => toText(v).trim().toLowerCase();

async function buildLookup(needed: Map<string, Set<string>>): Promise<EvalCtx['lookup'] | undefined> {
  if (!needed.size) return undefined;
  const loaded = new Map<string, SourceData>();
  for (const [sheetId, ids] of needed) loaded.set(sheetId, await loadSourceData(sheetId, [...ids]));
  const index = new Map<string, Map<string, string>>(); // sheet:keyColumn → normalized key → first row
  return (sheetId, resultColumnId, keyColumnId, key) => {
    const data = loaded.get(sheetId.toLowerCase());
    if (!data || key === null || (typeof key === 'string' && !key.trim())) return null;
    const ik = `${sheetId}:${keyColumnId}`;
    let idx = index.get(ik);
    if (!idx) {
      idx = new Map();
      for (const rowId of data.order) { const k = data.rows.get(rowId)!.get(keyColumnId); if (k !== undefined && k !== null) { const nk = keyOf(k); if (nk && !idx.has(nk)) idx.set(nk, rowId); } }
      index.set(ik, idx);
    }
    const row = idx.get(keyOf(key));
    return row ? data.rows.get(row)!.get(resultColumnId) ?? null : null;
  };
}

/** Formula columns of a sheet in the order they have to be computed. Broken formulas (deleted source column …) are skipped. */
export async function planSheet(sheetId: string, tx?: Tx | null): Promise<Plan> {
  const cols = await loadColumns(sheetId, tx);
  const defs = new Map(cols.map((c) => [c.column_id, toColumnDef(c)]));
  const refs = refsOf(cols);
  const srcCols = new Map<string, ColumnRef[]>();
  const found: PlanItem[] = [];
  const neededLookup = new Map<string, Set<string>>();
  for (const c of cols) {
    const def = defs.get(c.column_id)!;
    const cfg = formulaCfgOf(def);
    if (!cfg) continue;
    try {
      for (const s of cfg.sources ?? []) if (!srcCols.has(s.sheetId.toLowerCase())) srcCols.set(s.sheetId.toLowerCase(), refsOf(await loadColumns(s.sheetId)));
      const compiled = compileFormula(cfg.expr, refs, { selfId: c.column_id, sources: cfg.sources, sourceColumns: srcCols });
      for (const x of collectXrefs(compiled.ast)) {
        if (!x.sheetId || !x.columnId) continue;
        if (!neededLookup.has(x.sheetId)) neededLookup.set(x.sheetId, new Set());
        neededLookup.get(x.sheetId)!.add(x.columnId);
      }
      found.push({ id: c.column_id, def, ast: compiled.ast, deps: compiled.deps, sourceSheets: compiled.sourceSheets });
    } catch (e) {
      logger.warn(`Formula skipped (${def.column_name}): ${(e as Error).message}`);
    }
  }
  let ordered: string[];
  const memo: { p?: Promise<EvalCtx['lookup'] | undefined> } = {};
  const lookup = () => (memo.p ??= buildLookup(neededLookup));
  try { ordered = topoOrder(found); } catch { logger.warn(`Formula cycle in sheet ${sheetId}`); return { items: [], types: new Map(), defs, needed: [], lookup }; }
  const byId = new Map(found.map((f) => [f.id, f]));
  const items = ordered.map((id) => byId.get(id)!);
  const needed = [...new Set(items.flatMap((i) => i.deps))];
  return { items, types: new Map(cols.map((c) => [c.column_id, c.data_type])), defs, needed, lookup };
}

/** Recomputes every formula column for the given rows and writes the changes (same transaction as the caller). */
export async function recomputeRows(tx: Tx, sheetId: string, rowIds: string[], userId: string, preset?: Plan): Promise<ExtraWrite[]> {
  const plan = preset ?? (await planSheet(sheetId, tx));
  if (!plan.items.length || !rowIds.length) return [];
  const ids = [...new Set(rowIds.map((r) => r.toLowerCase()))];
  const lookup = await plan.lookup();
  const cells = await q(
    `SELECT row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json FROM Cells
     WHERE row_id IN ${idList('@ids')} AND column_id IN ${idList('@cc')}`,
    { ids: jsonParam(ids), cc: jsonParam(plan.needed) },
    tx,
  );
  const rows = await q(`SELECT row_id, row_order FROM Rows WHERE row_id IN ${idList('@ids')} AND is_deleted = 0`, { ids: jsonParam(ids) }, tx);
  const rowNo = new Map(rows.map((r) => [r.row_id, r.row_order]));
  const vals = new Map<string, Map<string, FValue>>();
  for (const c of cells) {
    const t = plan.types.get(c.column_id);
    if (!t) continue;
    if (!vals.has(c.row_id)) vals.set(c.row_id, new Map());
    vals.get(c.row_id)!.set(c.column_id, toF(t, fromStorage(t as DataType, c)));
  }

  const out: ExtraWrite[] = [];
  for (const rowId of ids) {
    if (!rowNo.has(rowId)) continue;
    const cur = vals.get(rowId) ?? new Map<string, FValue>();
    for (const it of plan.items) {
      let result: FValue = null;
      try { result = evaluate(it.ast, { get: (id) => cur.get(id) ?? null, tzOffsetMinutes: env.tzOffsetMinutes, lookup }); } catch { result = null; }
      const n = normalizeValue(it.def, fromF(result, it.def.data_type), { skipRequired: true });
      const value: CellValue = n.ok ? n.value : null;
      cur.set(it.id, toF(it.def.data_type, value)); // dependents see the stored (rounded / typed) value
      const w = await writeCell(tx, { sheetId, rowId, col: it.def, value, userId, source: 'formula' });
      if (w.changed) out.push({ rowId, columnId: it.id, rowNo: rowNo.get(rowId), columnName: it.def.column_name, oldValue: w.oldValue, newValue: w.newValue, historyId: w.historyId, at: w.at } as ExtraWrite);
    }
  }
  return out;
}

const CHUNK = 400;
export const SYNC_LIMIT_ROWS = 20_000;

/** Recomputes all formula columns of a sheet for every row (after a formula is created / changed) */
export async function recomputeSheet(user: AuthUser, sheetId: string): Promise<{ rows: number; cellsChanged: number }> {
  const plan = await planSheet(sheetId);
  if (!plan.items.length) return { rows: 0, cellsChanged: 0 };
  const all = await q(`SELECT row_id FROM Rows WHERE sheet_id = @s AND is_deleted = 0 ORDER BY row_order`, { s: T.uuid(sheetId) });
  let changed = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK).map((r) => r.row_id as string);
    changed += await withTx(async (tx) => (await recomputeRows(tx, sheetId, chunk, user.id, plan)).length);
  }
  emitToSheet(sheetId, 'rows:changed', { sheetId, action: 'formula', by: user.displayName });
  return { rows: all.length, cellsChanged: changed };
}

/** After a formula column was created / changed: fill existing rows (in the background when the sheet is large) */
export async function backfill(user: AuthUser, sheetId: string): Promise<{ queued: boolean }> {
  await syncSources(sheetId);
  if ((await countRows(sheetId)) > SYNC_LIMIT_ROWS) {
    void recomputeSheet(user, sheetId).catch((e) => logger.error(`formula backfill failed: ${e?.message}`));
    return { queued: true };
  }
  await recomputeSheet(user, sheetId);
  return { queued: false };
}

/** A copied sheet has new column ids: re-point the formulas of its columns */
export async function remapAfterCopy(tx: Tx, newSheetId: string, columnMap: { old_id: string; new_id: string }[]): Promise<void> {
  const map = new Map(columnMap.map((m) => [m.old_id.toLowerCase(), m.new_id.toLowerCase()]));
  const rows = await q(`SELECT column_id, validation_rule FROM Columns WHERE sheet_id = @s AND validation_rule LIKE N'%formula%'`, { s: T.uuid(newSheetId) }, tx);
  for (const r of rows) {
    let v: { formula?: { expr?: string; sources?: { sheetId: string }[] } } | null = null;
    try { v = JSON.parse(r.validation_rule); } catch { continue; }
    const expr = v?.formula?.expr;
    if (!expr) continue;
    v!.formula!.expr = expr.replace(/\[#([0-9a-fA-F-]{36})\]/g, (_m, id: string) => `[#${map.get(id.toLowerCase()) ?? id.toLowerCase()}]`);
    await q(`UPDATE Columns SET validation_rule = @v WHERE column_id = @c`, { v: T.text(JSON.stringify(v)), c: T.uuid(r.column_id) }, tx);
    // the copy reads the same source sheets: record it (inside this transaction — a second connection would wait for it forever)
    for (const src of new Set((v!.formula!.sources ?? []).map((x) => x.sheetId.toLowerCase())))
      await q(`INSERT INTO FormulaSources (column_id, sheet_id, source_sheet_id) VALUES (@c, @s, @src)`, { c: T.uuid(r.column_id), s: T.uuid(newSheetId), src: T.uuid(src) }, tx);
  }
}

export async function countRows(sheetId: string): Promise<number> {
  const r = await q(`SELECT COUNT(*) AS n FROM Rows WHERE sheet_id = @s AND is_deleted = 0`, { s: T.uuid(sheetId) });
  return Number(r[0]?.n ?? 0);
}

const ALIAS_RE = /^[\p{L}\p{N}\p{M}_]{1,40}$/u;

/** Keeps FormulaSources (who reads which sheet) in line with the stored formulas of a sheet */
export async function syncSources(sheetId: string): Promise<void> {
  const cols = await loadColumns(sheetId);
  const rows: { c: string; s: string }[] = [];
  for (const c of cols) {
    const cfg = formulaCfgOf(toColumnDef(c));
    for (const src of cfg?.sources ?? []) rows.push({ c: c.column_id, s: src.sheetId.toLowerCase() });
  }
  await withTx(async (tx) => {
    await q(`DELETE FROM FormulaSources WHERE sheet_id = @s`, { s: T.uuid(sheetId) }, tx);
    for (const r of rows) {
      await q(`INSERT INTO FormulaSources (column_id, sheet_id, source_sheet_id) VALUES (@c, @s, @src)`,
        { c: T.uuid(r.c), s: T.uuid(sheetId), src: T.uuid(r.s) }, tx);
    }
  });
}

/** Sheets that read from `sheetId` (directly) */
export async function readersOf(sheetId: string): Promise<string[]> {
  const r = await q(`SELECT DISTINCT sheet_id FROM FormulaSources WHERE source_sheet_id = @s`, { s: T.uuid(sheetId) });
  return r.map((x) => String(x.sheet_id).toLowerCase());
}

/** Would adding "sheetId reads from sources" create a loop of sheets reading each other? */
async function readsBack(sheetId: string, sources: string[]): Promise<boolean> {
  const target = sheetId.toLowerCase();
  const seen = new Set<string>();
  const stack = [...sources.map((x) => x.toLowerCase())];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const r = await q(`SELECT DISTINCT source_sheet_id FROM FormulaSources WHERE sheet_id = @s`, { s: T.uuid(cur) });
    for (const x of r) stack.push(String(x.source_sheet_id).toLowerCase());
  }
  return false;
}

/** Validates a formula column definition; returns the validation to store (expression kept by column id) */
export async function prepareFormulaValidation(
  user: AuthUser,
  sheetId: string,
  selfId: string | null,
  dataType: string,
  validation: Record<string, any> | null | undefined,
): Promise<Record<string, any> | null | undefined> {
  const raw = validation?.formula?.expr as string | undefined;
  if (validation && 'formula' in validation && !raw) { const { formula: _f, ...rest } = validation; void _f; return Object.keys(rest).length ? rest : null; }
  if (!raw) return validation;
  if (!FORMULA_TYPES.has(dataType)) throw badRequest('สูตรใช้ได้กับคอลัมน์ชนิด ข้อความ ตัวเลข วันที่ และ ใช่/ไม่ใช่ เท่านั้น');

  // sources: other sheets this formula reads. The person configuring must be able to read them.
  const sources: SourceDef[] = [];
  const srcCols = new Map<string, ColumnRef[]>();
  const seenAlias = new Set<string>();
  for (const s of (validation?.formula?.sources ?? []) as SourceDef[]) {
    if (!ALIAS_RE.test(s.alias)) throw badRequest(`ชื่อแหล่งข้อมูล "${s.alias}" ใช้ไม่ได้ (ตัวอักษร ตัวเลข _ ไม่เกิน 40 ตัว ไม่มีช่องว่าง)`);
    if (seenAlias.has(s.alias.toLowerCase())) throw badRequest(`ชื่อแหล่งข้อมูล "${s.alias}" ซ้ำกัน`);
    seenAlias.add(s.alias.toLowerCase());
    if (s.sheetId.toLowerCase() === sheetId.toLowerCase()) throw badRequest('อ่านข้อมูลจากชีตตัวเองด้วย @ ไม่ได้ ใช้ชื่อคอลัมน์ธรรมดาแทน');
    await requireSheet(user, s.sheetId, LV.read);
    sources.push({ alias: s.alias, sheetId: s.sheetId.toLowerCase() });
    srcCols.set(s.sheetId.toLowerCase(), refsOf(await loadColumns(s.sheetId)));
  }
  if (sources.length && (await readsBack(sheetId, sources.map((x) => x.sheetId)))) throw badRequest('ชีตทั้งสองอ่านข้อมูลจากกันเป็นวงกลม');

  const cols = await loadColumns(sheetId);
  const refs = refsOf(cols.filter((c) => c.column_id !== selfId));
  let compiled;
  try { compiled = compileFormula(raw, refs, { selfId: selfId ?? undefined, sources, sourceColumns: srcCols }); } catch (e) {
    if (e instanceof FormulaSyntaxError) throw badRequest(`สูตรไม่ถูกต้อง: ${e.message}`, { formula: { message: e.message, pos: e.pos } });
    throw e;
  }
  // cycle check including the column being saved
  const others: { id: string; deps: string[] }[] = [];
  for (const c of cols) {
    if (c.column_id === selfId) continue;
    const cfg = formulaCfgOf(toColumnDef(c));
    if (!cfg) continue;
    try {
      const oc = new Map<string, ColumnRef[]>();
      for (const s of cfg.sources ?? []) oc.set(s.sheetId.toLowerCase(), refsOf(await loadColumns(s.sheetId)));
      others.push({ id: c.column_id, deps: compileFormula(cfg.expr, refsOf(cols), { selfId: c.column_id, sources: cfg.sources, sourceColumns: oc }).deps });
    } catch { /* broken elsewhere */ }
  }
  const selfKey = selfId ?? '__new__';
  try { topoOrder([...others, { id: selfKey, deps: compiled.deps }]); } catch { throw badRequest('สูตรนี้ทำให้คอลัมน์สูตรอ้างอิงกันเป็นวงกลม'); }
  const formula: FormulaCfg = { expr: compiled.canonical };
  if (sources.length) formula.sources = sources;
  return { ...validation, formula };
}

/** Names of formula columns that use `columnId` (a column used by a formula cannot be deleted).
 *  Also covers columns of OTHER sheets that read this column through @source[...]. */
export async function formulaDependents(sheetId: string, columnId: string): Promise<string[]> {
  const cols = await loadColumns(sheetId);
  const refs = refsOf(cols);
  const names: string[] = [];
  for (const c of cols) {
    const cfg = formulaCfgOf(toColumnDef(c));
    if (!cfg || c.column_id === columnId) continue;
    try {
      const sc = new Map<string, ColumnRef[]>();
      for (const s of cfg.sources ?? []) sc.set(s.sheetId.toLowerCase(), refsOf(await loadColumns(s.sheetId)));
      if (compileFormula(cfg.expr, refs, { selfId: c.column_id, sources: cfg.sources, sourceColumns: sc }).deps.includes(columnId)) names.push(c.column_name);
    } catch { /* ignore */ }
  }
  const id = columnId.toLowerCase();
  for (const readerSheet of await readersOf(sheetId)) {
    for (const c of await loadColumns(readerSheet)) {
      const cfg = formulaCfgOf(toColumnDef(c));
      if (cfg?.expr.toLowerCase().includes(`@{${sheetId.toLowerCase()}}[#${id}]`)) names.push(c.column_name);
    }
  }
  return names;
}

/** For the column editor: shows the stored formula with column names */
export const formulaDisplay = (canonical: string, cols: any[], sources?: SourceDef[], sourceColumns?: Map<string, ColumnRef[]>) =>
  displayFormula(canonical, refsOf(cols), sources, sourceColumns);

/** Describes a column's sources for managers (file / sheet names), and the formula in readable form */
export async function describeFormula(col: any, cols: any[]): Promise<{ display: string; sources: { alias: string; sheetId: string; sheetName: string | null; fileId: string | null; fileName: string | null }[] } | null> {
  const cfg = formulaCfgOf(toColumnDef(col));
  if (!cfg) return null;
  const sourceColumns = new Map<string, ColumnRef[]>();
  const sources: { alias: string; sheetId: string; sheetName: string | null; fileId: string | null; fileName: string | null }[] = [];
  for (const s of cfg.sources ?? []) {
    let info: any = null;
    try {
      sourceColumns.set(s.sheetId.toLowerCase(), refsOf(await loadColumns(s.sheetId)));
      const r = await q(`SELECT sh.sheet_id, sh.sheet_name, f.file_id, f.file_name FROM Sheets sh JOIN Files f ON f.file_id = sh.file_id WHERE sh.sheet_id = @s`, { s: T.uuid(s.sheetId) });
      info = r[0] ?? null;
    } catch { /* source gone */ }
    sources.push({ alias: s.alias, sheetId: s.sheetId, sheetName: info?.sheet_name ?? null, fileId: info?.file_id ?? null, fileName: info?.file_name ?? null });
  }
  let display = cfg.expr;
  try { display = formulaDisplay(cfg.expr, cols, cfg.sources, sourceColumns); } catch { /* keep canonical */ }
  return { display, sources };
}

/** A source sheet changed → recalculate the sheets that read it (debounced; one run per sheet at a time) */
const pending = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 3000;
export function scheduleReaders(user: AuthUser, sourceSheetId: string, depth = 0): void {
  invalidateSource(sourceSheetId);
  if (depth > 5) return;
  void readersOf(sourceSheetId).then((readers) => {
    for (const r of readers) {
      const prev = pending.get(r);
      if (prev) clearTimeout(prev);
      pending.set(r, setTimeout(() => {
        pending.delete(r);
        invalidateSource(sourceSheetId);
        recomputeSheet(user, r).then(() => scheduleReaders(user, r, depth + 1)).catch((e) => logger.error(`formula dependents recompute failed: ${e?.message}`));
      }, DEBOUNCE_MS));
    }
  }).catch((e) => logger.error(`formula readers lookup failed: ${e?.message}`));
}

export { parse as parseFormula };
