import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { withTx } from '../../config/db';
import { audit } from '../../shared/audit';
import { toColumnDef } from '../../shared/cellValue';
import { ah, badRequest, ok, parse, pid, safeJson } from '../../shared/http';
import { LV, requireSheet } from '../../shared/permissions';
import { loadColumns } from '../../services/cellWriter';
import { getLookup, lookupValues } from '../../services/lookup';
import { createRowTx } from '../../services/rowCreate';
import { queryRows } from '../../services/rowQuery';
import { emitToSheet } from '../../socket';
import { parsePlan, PlanItem } from './plan';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Which columns of the target worksheet the importer fills (by name — same names as the InkCode worksheet) */
const NAMES = { date: 'วันที่ผลิต', line: 'ไลน์', shift: 'กะ', doc: 'รหัสเอกสาร', market: 'Market', qty: 'ยอด', time: 'เวลาเริ่ม' } as const;

/**
 * Where the target sheet sits in the InkCode tree "… / PF1 | PF2 / <year> / <YYYY-MM name> / <DD>": the plant (from the folder names)
 * and the day the sheet stands for (from the file and sheet names). Both are null for a sheet outside that tree.
 */
function placeOf(ctx: { index: { map: Map<string, { name: string; parentId: string | null }> } }, sheet: any) {
  let plant: string | null = null;
  for (let cur = ctx.index.map.get(sheet.folder_id); cur; cur = cur.parentId ? ctx.index.map.get(cur.parentId) : undefined) {
    if (/^PF\d+$/i.test(cur.name.trim())) { plant = cur.name.trim().toUpperCase(); break; }
  }
  const m = /^(\d{4})-(\d{2})/.exec(String(sheet.file_name ?? '').trim());
  const d = /^\d{1,2}$/.exec(String(sheet.sheet_name ?? '').trim());
  return { plant, sheetDate: m && d ? `${m[1]}-${m[2]}-${d[0].padStart(2, '0')}` : null };
}

/** line name → its Plant in the reference table (the "Plant" column of the line sheet) */
async function linePlants(lineLookup: { sheetId: string; columnId: string } | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!lineLookup) return out;
  const cols = await loadColumns(lineLookup.sheetId);
  const plantCol = cols.find((c: any) => c.column_name === 'Plant');
  if (!plantCol) return out;
  for (let p = 1; p <= 10; p++) {
    const r = await queryRows(lineLookup.sheetId, cols, { page: p, pageSize: 1000 });
    for (const row of r.rows) {
      const v = row.values as Record<string, unknown>;
      const plant = String(v[plantCol.column_id] ?? '').trim().toUpperCase();
      if (plant) out.set(norm(v[lineLookup.columnId]), plant);
    }
    if (r.rows.length < 1000) break;
  }
  return out;
}

async function context(user: any, sheetId: string) {
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
async function dbPairs(docs: string[], docLookup: { sheetId: string; columnId: string } | null, mktLookup: { sheetId: string; columnId: string } | null) {
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

const annotate = (items: PlanItem[], pairs: Map<string, Set<string>>, dbKnown: boolean, plants: Map<string, string>, myPlant: string | null) => items.map((i) => {
  const ms = pairs.get(norm(i.doc));
  const market = ms ? [...ms].find((m) => norm(m) === norm(i.country)) : undefined;
  const plant = plants.get(norm(i.line)) ?? null;
  return { ...i, inDb: dbKnown ? !!market : null, market: market ?? i.country, dbMarkets: ms ? [...ms] : [], docInDb: dbKnown ? !!ms : null, plant, otherPlant: !!(myPlant && plant && plant !== myPlant) };
});

router.post('/inkcode/plan/preview', upload.single('file'), ah(async (req, res) => {
  const { sheetId } = parse(z.object({ sheetId: z.string().min(30).max(40) }), req.body);
  if (!req.file) throw badRequest('ไม่พบไฟล์ที่อัปโหลด');
  const ctx = await context(req.user!, sheetId.toLowerCase());
  let plan;
  try { plan = parsePlan(req.file.buffer, ctx.knownLines); } catch (e) { throw badRequest((e as Error).message); }
  const { pairs, known } = await dbPairs(plan.items.map((i) => i.doc), ctx.docLookup, ctx.mktLookup);
  ok(res, { date: plan.date, sheetName: plan.sheetName, warnings: plan.warnings, knownLines: ctx.knownLines, items: annotate(plan.items, pairs, known, ctx.plants, ctx.plant), plant: ctx.plant, sheetDate: ctx.sheetDate, fillsTime: ctx.byName.has(NAMES.time), fillsQty: ctx.byName.has(NAMES.qty) });
}));

router.post('/inkcode/plan/import', upload.single('file'), ah(async (req, res) => {
  const body = parse(z.object({
    sheetId: z.string().min(30).max(40),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    onlyMatched: z.enum(['0', '1']).default('1'),
    onlyPlant: z.enum(['0', '1']).default('1'),       // sheets under a PF1 / PF2 folder: skip lines of the other plant
    allowOtherDate: z.enum(['0', '1']).default('0'),  // day sheets ("2026-10 …" / "03"): the plan must be for that day
    lineMap: z.string().max(20000).optional(),       // JSON { "<line text from the plan>": "<line of the reference table>" }
  }), req.body);
  if (!req.file) throw badRequest('ไม่พบไฟล์ที่อัปโหลด');
  const sheetId = body.sheetId.toLowerCase();
  const user = req.user!;
  const { sheet } = await requireSheet(user, sheetId, LV.write);
  const ctx = await context(user, sheetId);
  let plan;
  try { plan = parsePlan(req.file.buffer, ctx.knownLines); } catch (e) { throw badRequest((e as Error).message); }
  const date = body.date ?? plan.date;
  if (!date) throw badRequest('ไม่พบวันที่ในแผน กรุณาระบุวันที่ผลิต');
  if (ctx.sheetDate && date !== ctx.sheetDate && body.allowOtherDate !== '1') throw badRequest(`ชีตนี้คือวันที่ ${ctx.sheetDate} แต่แผนเป็นวันที่ ${date} — เปิดชีตของวันที่ ${date} แล้วนำเข้า (หรือยืนยันนำเข้าลงชีตนี้)`);
  const lineMap = safeJson<Record<string, string>>(body.lineMap, {});
  const { pairs, known } = await dbPairs(plan.items.map((i) => i.doc), ctx.docLookup, ctx.mktLookup);
  const items = annotate(plan.items, pairs, known, ctx.plants, ctx.plant).map((i) => { const line = lineMap[i.line] ?? i.line; const plant = ctx.plants.get(norm(line)) ?? i.plant; return { ...i, line, plant, otherPlant: !!(ctx.plant && plant && plant !== ctx.plant) }; });

  // rows already in the sheet for that date (same line + document + market [+ time]) are not added twice
  const idOf = (n: string) => ctx.byName.get(n)?.column_id as string | undefined;
  const existing = new Set<string>();
  const keyOf = (line: unknown, doc: unknown, market: unknown, time: unknown) => [norm(line), norm(doc), norm(market), norm(time)].join('|');
  for (let p = 1; p <= 20; p++) {
    const r = await queryRows(sheetId, ctx.cols, { page: p, pageSize: 1000, filters: [{ columnId: idOf(NAMES.date)!, op: 'eq', value: date } as any] });
    for (const row of r.rows) { const v = row.values as Record<string, unknown>; existing.add(keyOf(v[idOf(NAMES.line)!], v[idOf(NAMES.doc)!], v[idOf(NAMES.market)!], idOf(NAMES.time) ? v[idOf(NAMES.time)!] : '')); }
    if (r.rows.length < 1000) break;
  }

  const result = { created: 0, duplicate: 0, skippedNotInDb: 0, skippedOtherPlant: 0, failed: [] as { doc: string; line: string; reason: string }[] };
  for (const it of items) {
    if (body.onlyPlant === '1' && it.otherPlant) { result.skippedOtherPlant++; continue; }
    if (body.onlyMatched === '1' && it.inDb === false) { result.skippedNotInDb++; continue; }
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
  await audit({ userId: user.id, action: 'inkcode_plan_import', entityType: 'sheet', entityId: sheetId, fileId: sheet.file_id, sheetId, newValue: { date, created: result.created, duplicate: result.duplicate, skippedNotInDb: result.skippedNotInDb, skippedOtherPlant: result.skippedOtherPlant, failed: result.failed.length } }, req);
  ok(res, { date, total: items.length, ...result });
}));

export default router;
