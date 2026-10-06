import type { Request } from 'express';
import { withTx } from '../../config/db';
import { audit } from '../../shared/audit';
import { toColumnDef } from '../../shared/cellValue';
import { badRequest } from '../../shared/http';
import { LV, requireSheet } from '../../shared/permissions';
import { loadColumns } from '../../services/cellWriter';
import { getLookup, lookupValues } from '../../services/lookup';
import { createRowTx } from '../../services/rowCreate';
import { queryRows } from '../../services/rowQuery';
import { emitToSheet } from '../../socket';
import type { PlanItem } from './plan';
import { normalizePlant } from './model';

export const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Which columns of the target worksheet the importer fills (by name — same names as the InkCode worksheet) */
export const NAMES = { date: 'วันที่ผลิต', line: 'ไลน์', shift: 'กะ', doc: 'รหัสเอกสาร', market: 'Market', qty: 'ยอด', time: 'เวลาเริ่ม' } as const;

/**
 * Where the target sheet sits in the InkCode tree "… / PF1 | PF2 / <year> / <YYYY-MM name> / <DD>": the plant (from the folder names)
 * and the day the sheet stands for (from the file and sheet names). Both are null for a sheet outside that tree.
 */
export function placeOf(ctx: { index: { map: Map<string, { name: string; parentId: string | null }> } }, sheet: any) {
  let plant: string | null = null;
  for (let cur = ctx.index.map.get(sheet.folder_id); cur; cur = cur.parentId ? ctx.index.map.get(cur.parentId) : undefined) {
    if (/^PF\d+$/i.test(cur.name.trim())) { plant = cur.name.trim().toUpperCase(); break; }
  }
  const m = /^(\d{4})-(\d{2})/.exec(String(sheet.file_name ?? '').trim());
  const d = /^\d{1,2}$/.exec(String(sheet.sheet_name ?? '').trim());
  return { plant, sheetDate: m && d ? `${m[1]}-${m[2]}-${d[0].padStart(2, '0')}` : null };
}

/** line name → its Plant in the reference table (the "Plant" column of the line sheet) */
export async function linePlants(lineLookup: { sheetId: string; columnId: string } | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!lineLookup) return out;
  const cols = await loadColumns(lineLookup.sheetId);
  const plantCol = cols.find((c: any) => c.column_name === 'Plant');
  if (!plantCol) return out;
  for (let p = 1; p <= 10; p++) {
    const r = await queryRows(lineLookup.sheetId, cols, { page: p, pageSize: 1000 });
    for (const row of r.rows) {
      const v = row.values as Record<string, unknown>;
      const plant = normalizePlant(v[plantCol.column_id]);
      if (plant) out.set(norm(v[lineLookup.columnId]), plant);
    }
    if (r.rows.length < 1000) break;
  }
  return out;
}

export async function context(user: any, sheetId: string) {
  const { sheet, ctx: permCtx } = await requireSheet(user, sheetId, LV.write);
  const cols = await loadColumns(sheetId);
  const byName = new Map<string, any>(cols.map((c: any) => [c.column_name, c]));
  for (const n of [NAMES.date, NAMES.line, NAMES.doc, NAMES.market]) if (!byName.has(n)) throw badRequest(`ตารางนี้ไม่มีคอลัมน์ "${n}" — ใช้กับชีต Worksheet ของ InkCode เท่านั้น`);
  const lineLookup = getLookup(toColumnDef(byName.get(NAMES.line)));
  const knownLines = lineLookup ? await lookupValues(lineLookup, null) : [];
  // the database sheet = where the document-code drop-down reads from
  const docLookup = getLookup(toColumnDef(byName.get(NAMES.doc)));
  const mktLookup = getLookup(toColumnDef(byName.get(NAMES.market)));
  const place = placeOf(permCtx, sheet);
  return { cols, byName, knownLines, docLookup, mktLookup, lineLookup, ...place, plants: place.plant ? await linePlants(lineLookup) : new Map<string, string>() };
}

/** (document, market) pairs that exist in the database sheet */
export async function dbPairs(docs: string[], docLookup: { sheetId: string; columnId: string } | null, mktLookup: { sheetId: string; columnId: string } | null) {
  const pairs = new Map<string, Set<string>>();
  if (!docLookup || !mktLookup || docLookup.sheetId !== mktLookup.sheetId) return { pairs, known: false };
  const dbCols = await loadColumns(docLookup.sheetId);
  const uniq = [...new Set(docs)];
  for (let i = 0; i < uniq.length; i += 100) {
    const r = await queryRows(docLookup.sheetId, dbCols, { page: 1, pageSize: 1000, filters: [{ columnId: docLookup.columnId, values: uniq.slice(i, i + 100) } as any] });
    for (const row of r.rows) {
      const d = norm((row.values as Record<string, unknown>)[docLookup.columnId]);
      const m = String((row.values as Record<string, unknown>)[mktLookup.columnId] ?? '');
      if (!pairs.has(d)) pairs.set(d, new Set());
      pairs.get(d)!.add(m);
    }
  }
  return { pairs, known: true };
}

export const annotate = (items: PlanItem[], pairs: Map<string, Set<string>>, dbKnown: boolean, plants: Map<string, string>, myPlant: string | null) => items.map((i) => {
  const ms = pairs.get(norm(i.doc));
  const market = ms ? [...ms].find((m) => norm(m) === norm(i.country)) : undefined;
  const plant = plants.get(norm(i.line)) ?? null;
  return { ...i, inDb: dbKnown ? !!market : null, market: market ?? i.country, dbMarkets: ms ? [...ms] : [], docInDb: dbKnown ? !!ms : null, plant, otherPlant: !!(myPlant && plant && plant !== myPlant) };
});


export interface InsertResult { created: number; duplicate: number; skippedNotInDb: number; skippedOtherPlant: number; failed: { doc: string; line: string; reason: string }[] }

/**
 * Adds plan items as rows of one worksheet sheet. Rows already there for that date (same line + document + market [+ time]) are
 * not added twice. `items` carry the annotate() flags.
 */
export async function insertItems(user: any, sheet: any, sheetId: string, ctx: Awaited<ReturnType<typeof context>>, items: ReturnType<typeof annotate>, date: string, o: { onlyMatched: boolean; onlyPlant: boolean }, req?: Request): Promise<InsertResult> {
  const idOf = (n: string) => ctx.byName.get(n)?.column_id as string | undefined;
  const existing = new Set<string>();
  const keyOf = (line: unknown, doc: unknown, market: unknown, time: unknown) => [norm(line), norm(doc), norm(market), norm(time)].join('|');
  for (let p = 1; p <= 20; p++) {
    const r = await queryRows(sheetId, ctx.cols, { page: p, pageSize: 1000, filters: [{ columnId: idOf(NAMES.date)!, op: 'eq', value: date } as any] });
    for (const row of r.rows) { const v = row.values as Record<string, unknown>; existing.add(keyOf(v[idOf(NAMES.line)!], v[idOf(NAMES.doc)!], v[idOf(NAMES.market)!], idOf(NAMES.time) ? v[idOf(NAMES.time)!] : '')); }
    if (r.rows.length < 1000) break;
  }
  const result: InsertResult = { created: 0, duplicate: 0, skippedNotInDb: 0, skippedOtherPlant: 0, failed: [] };
  for (const it of items) {
    if (o.onlyPlant && it.otherPlant) { result.skippedOtherPlant++; continue; }
    if (o.onlyMatched && it.inDb === false) { result.skippedNotInDb++; continue; }
    const k = keyOf(it.line, it.doc, it.market, idOf(NAMES.time) ? it.time : '');
    if (existing.has(k)) { result.duplicate++; continue; }
    const values: Record<string, unknown> = { [idOf(NAMES.date)!]: date, [idOf(NAMES.line)!]: it.line, [idOf(NAMES.doc)!]: it.doc, [idOf(NAMES.market)!]: it.market };
    if (idOf(NAMES.shift)) values[idOf(NAMES.shift)!] = it.shift;
    if (idOf(NAMES.qty) && it.qty !== null) values[idOf(NAMES.qty)!] = it.qty;
    if (idOf(NAMES.time) && it.time) values[idOf(NAMES.time)!] = it.time;
    try { await withTx((tx) => createRowTx(tx, user, sheet, sheetId, values, 'plan-import', req)); existing.add(k); result.created++; }
    catch (e) { if (result.failed.length < 50) result.failed.push({ doc: it.doc, line: it.line, reason: (e as Error).message }); }
  }
  emitToSheet(sheetId, 'rows:changed', { sheetId, action: 'import', by: user.displayName });
  await audit({ userId: user.id, action: 'inkcode_plan_import', entityType: 'sheet', entityId: sheetId, fileId: sheet.file_id, sheetId, newValue: { date, ...result, failed: result.failed.length } }, req);
  return result;
}
