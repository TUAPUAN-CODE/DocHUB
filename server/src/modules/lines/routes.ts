import { Router } from 'express';
import { z } from 'zod';
import { q, q1, T } from '../../config/db';
import { audit } from '../../shared/audit';
import { ah, badRequest, notFound, ok, parse, pid, zId } from '../../shared/http';
import { LV, requireSheet } from '../../shared/permissions';
import { applyCellUpdates, loadColumns } from '../../services/cellWriter';
import { hydrateRows, userNames } from '../../services/rowQuery';
import { readSettings, writeSettingsKey } from '../../services/sheetSettings';
import { emitToSheet } from '../../socket';
import { runScan } from '../scan/routes';

const router = Router();

interface LinesCfg {
  lineSheetId: string;
  /** scan = add a line by scanning its QR (trolley); form = fill a form for each line (a document's lines) */
  entry?: 'scan' | 'form' | null;
  displayColumnIds?: string[] | null;
  actions?: { label: string; columnId: string; kind: 'now' | 'value'; value?: string | null }[] | null;
}

const cfgSchema = z.object({
  lineSheetId: zId,
  entry: z.enum(['scan', 'form']).nullish(),
  displayColumnIds: z.array(zId).max(12).nullish(),
  actions: z.array(z.object({ label: z.string().trim().min(1).max(60), columnId: zId, kind: z.enum(['now', 'value']), value: z.string().max(200).nullish() })).max(10).nullish(),
});

async function linesCfg(sheetId: string): Promise<LinesCfg> {
  const c = (await readSettings(sheetId)).lines as LinesCfg | undefined;
  if (!c?.lineSheetId) throw badRequest('ชีตนี้ยังไม่ได้ตั้งค่ารายการในแถว (ผู้จัดการตั้งได้ที่ปุ่ม ตั้งค่าสแกน/ผสม)');
  return c;
}

async function assertHeaderRow(sheetId: string, rowId: string) {
  const r = await q1(`SELECT row_id FROM Rows WHERE row_id = @r AND sheet_id = @s AND is_deleted = 0`, { r: T.uuid(rowId), s: T.uuid(sheetId) });
  if (!r) throw notFound('ไม่พบแถว (อาจถูกลบแล้ว)');
}

/** Managers: which sheet holds the line items of the rows of this sheet (e.g. trolley → materials on it) */
router.put('/sheets/:id/lines/settings', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.manage);
  const body = parse(z.object({ lines: cfgSchema.nullable() }), req.body);
  if (body.lines) {
    if (body.lines.lineSheetId.toLowerCase() === sheetId.toLowerCase()) throw badRequest('ชีตรายการต้องเป็นคนละชีตกับชีตนี้');
    await requireSheet(req.user!, body.lines.lineSheetId, LV.read);
    const cols = new Set((await loadColumns(body.lines.lineSheetId)).map((c) => c.column_id));
    for (const id of [...(body.lines.displayColumnIds ?? []), ...(body.lines.actions ?? []).map((a) => a.columnId)]) if (!cols.has(id)) throw badRequest('ไม่พบคอลัมน์ที่เลือกในชีตรายการ (อาจถูกลบแล้ว)');
  }
  await writeSettingsKey(sheetId, 'lines', body.lines);
  ok(res, { saved: true });
}));

router.get('/sheets/:id/rows/:rowId/lines', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.read);
  const cfg = await linesCfg(sheetId);
  await requireSheet(req.user!, cfg.lineSheetId, LV.read);
  await assertHeaderRow(sheetId, String(req.params.rowId));
  const cols = await loadColumns(cfg.lineSheetId);
  const recs = await q(
    `SELECT r.row_id, r.row_order, r.created_by, r.created_at, r.updated_by, r.updated_at, r.deleted_at, r.deleted_by
     FROM RowLinks l JOIN Rows r ON r.row_id = l.child_row_id
     WHERE l.parent_row_id = @p AND l.role = N'contains' AND r.is_deleted = 0 ORDER BY l.link_id`, { p: T.uuid(String(req.params.rowId)) });
  const { rows, userIds } = await hydrateRows(recs, cols);
  ok(res, { lines: rows, users: await userNames(userIds) });
}));

/** Add a line: scan its QR (made / updated with the line sheet's formats) or attach an existing row. A line sits on one header at a time (attaching moves it). */
router.post('/sheets/:id/rows/:rowId/lines', ah(async (req, res) => {
  const sheetId = pid(req);
  const u = req.user!;
  const { sheet } = await requireSheet(u, sheetId, LV.write);
  const cfg = await linesCfg(sheetId);
  const { sheet: lineSheet } = await requireSheet(u, cfg.lineSheetId, LV.write);
  const headerRow = String(req.params.rowId);
  await assertHeaderRow(sheetId, headerRow);
  const body = parse(z.object({ text: z.string().min(1).max(2000).optional(), profileId: z.string().max(40).nullish(), lineRowId: zId.optional() }), req.body);
  let lineRowId = body.lineRowId;
  let how = 'attached';
  if (!lineRowId) {
    if (!body.text) throw badRequest('กรุณาสแกนหรือระบุแถวรายการ');
    const r = await runScan(u, lineSheet, cfg.lineSheetId, body.text, body.profileId, req);
    lineRowId = r.rowId; how = r.action;
  } else {
    const ex = await q1(`SELECT row_id FROM Rows WHERE row_id = @r AND sheet_id = @s AND is_deleted = 0`, { r: T.uuid(lineRowId), s: T.uuid(cfg.lineSheetId) });
    if (!ex) throw notFound('ไม่พบแถวรายการ');
  }
  const prev = await q(`SELECT parent_row_id FROM RowLinks WHERE child_row_id = @c AND role = N'contains'`, { c: T.uuid(lineRowId) });
  if (prev.some((p) => String(p.parent_row_id).toLowerCase() === headerRow.toLowerCase())) return ok(res, { rowId: lineRowId, how, already: true });
  if (prev.length) {
    await q(`DELETE FROM RowLinks WHERE child_row_id = @c AND role = N'contains'`, { c: T.uuid(lineRowId) });
    await audit({ userId: u.id, action: 'line_move', entityType: 'row', entityId: lineRowId, fileId: lineSheet.file_id, sheetId: cfg.lineSheetId, oldValue: { header: prev[0].parent_row_id }, newValue: { header: headerRow } }, req);
  }
  await q(`INSERT INTO RowLinks (sheet_id, parent_row_id, child_row_id, qty, role, created_by) VALUES (@s, @p, @c, NULL, N'contains', @u)`,
    { s: T.uuid(cfg.lineSheetId), p: T.uuid(headerRow), c: T.uuid(lineRowId), u: T.uuid(u.id) });
  await audit({ userId: u.id, action: 'line_add', entityType: 'row', entityId: headerRow, fileId: sheet.file_id, sheetId, newValue: { line: lineRowId, how } }, req);
  emitToSheet(sheetId, 'rows:changed', { sheetId, action: 'lines', rowId: headerRow, by: u.displayName });
  ok(res, { rowId: lineRowId, how, moved: prev.length > 0 }, 201);
}));

router.delete('/sheets/:id/rows/:rowId/lines/:lineRowId', ah(async (req, res) => {
  const sheetId = pid(req);
  const u = req.user!;
  const { sheet } = await requireSheet(u, sheetId, LV.write);
  await linesCfg(sheetId);
  const r = await q(`DELETE FROM RowLinks WHERE parent_row_id = @p AND child_row_id = @c AND role = N'contains'`, { p: T.uuid(String(req.params.rowId)), c: T.uuid(String(req.params.lineRowId)) });
  void r;
  await audit({ userId: u.id, action: 'line_remove', entityType: 'row', entityId: String(req.params.rowId), fileId: sheet.file_id, sheetId, oldValue: { line: req.params.lineRowId } }, req);
  ok(res, { removed: true });
}));

/** One action for every line on the header (e.g. "ออกห้องเย็น" stamps the time on all materials of the trolley) */
router.post('/sheets/:id/rows/:rowId/lines/action', ah(async (req, res) => {
  const sheetId = pid(req);
  const u = req.user!;
  await requireSheet(u, sheetId, LV.write);
  const cfg = await linesCfg(sheetId);
  const body = parse(z.object({ index: z.number().int().min(0).max(9) }), req.body);
  const act = cfg.actions?.[body.index];
  if (!act) throw badRequest('ไม่พบการกระทำนี้');
  const lines = await q(`SELECT l.child_row_id FROM RowLinks l JOIN Rows r ON r.row_id = l.child_row_id WHERE l.parent_row_id = @p AND l.role = N'contains' AND r.is_deleted = 0`, { p: T.uuid(String(req.params.rowId)) });
  if (!lines.length) throw badRequest('ยังไม่มีรายการในแถวนี้');
  const value = act.kind === 'now' ? new Date().toISOString() : act.value ?? '';
  const res2 = await applyCellUpdates(u, cfg.lineSheetId, lines.map((l) => ({ rowId: l.child_row_id as string, columnId: act.columnId, value })), { req, source: 'lines', partial: true });
  ok(res, { count: lines.length, result: res2 });
}));

/* ---- showing the link between a header sheet and its line sheet in the table (column next to the row number) ---- */

/** header sheet: how many lines each of these rows has */
router.post('/sheets/:id/lines/counts', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.read);
  const { rowIds } = parse(z.object({ rowIds: z.array(zId).max(1000) }), req.body);
  if (!rowIds.length) return ok(res, {});
  const rows = await q(
    `SELECT l.parent_row_id, COUNT(*) AS n FROM RowLinks l JOIN Rows r ON r.row_id = l.child_row_id AND r.is_deleted = 0
     WHERE l.role = N'contains' AND l.parent_row_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids)) GROUP BY l.parent_row_id`,
    { ids: T.text(JSON.stringify(rowIds)) },
  );
  ok(res, Object.fromEntries(rows.map((r) => [String(r.parent_row_id).toLowerCase(), Number(r.n)])));
}));

/** header sheet: the line row ids of each of these rows (PDF: a table of only the lines of the printed document) */
router.post('/sheets/:id/lines/map', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.read);
  const { rowIds } = parse(z.object({ rowIds: z.array(zId).max(5000) }), req.body);
  if (!rowIds.length) return ok(res, {});
  const rows = await q(
    `SELECT l.parent_row_id, l.child_row_id FROM RowLinks l JOIN Rows r ON r.row_id = l.child_row_id AND r.is_deleted = 0
     WHERE l.role = N'contains' AND l.parent_row_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids)) ORDER BY l.link_id`,
    { ids: T.text(JSON.stringify(rowIds)) },
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[String(r.parent_row_id).toLowerCase()] ??= []).push(String(r.child_row_id).toLowerCase());
  ok(res, out);
}));

/** line sheet: the sheet of the same file whose rows hold this sheet's rows as their lines (null: none) */
router.get('/sheets/:id/lines/header-sheet', ah(async (req, res) => {
  const sheetId = pid(req);
  const { sheet } = await requireSheet(req.user!, sheetId, LV.read);
  const sheets = await q(`SELECT sheet_id, sheet_name, settings_json FROM Sheets WHERE file_id = @f AND is_deleted = 0 AND sheet_id <> @s`, { f: T.uuid(sheet.file_id), s: T.uuid(sheetId) });
  const h = sheets.find((x) => { try { return String(JSON.parse(x.settings_json ?? '{}')?.lines?.lineSheetId ?? '').toLowerCase() === sheetId.toLowerCase(); } catch { return false; } });
  ok(res, h ? { sheetId: h.sheet_id, sheetName: h.sheet_name } : null);
}));

/** line sheet: the header row of each of these rows, named by the header sheet's first column (e.g. its document number) */
router.post('/sheets/:id/lines/parents', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.read);
  const { rowIds, headerSheetId } = parse(z.object({ rowIds: z.array(zId).max(1000), headerSheetId: zId }), req.body);
  await requireSheet(req.user!, headerSheetId, LV.read);
  if (!rowIds.length) return ok(res, {});
  const links = await q(
    `SELECT l.child_row_id, l.parent_row_id, p.row_id, p.row_order, p.created_by, p.created_at, p.updated_by, p.updated_at, p.deleted_at, p.deleted_by
     FROM RowLinks l JOIN Rows p ON p.row_id = l.parent_row_id AND p.is_deleted = 0 AND p.sheet_id = @h
     WHERE l.role = N'contains' AND l.child_row_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`,
    { ids: T.text(JSON.stringify(rowIds)), h: T.uuid(headerSheetId) },
  );
  const cols = await loadColumns(headerSheetId);
  const { rows } = await hydrateRows(links, cols.slice(0, 1));
  const label = new Map(rows.map((r: any) => [String(r.id).toLowerCase(), { order: r.order, value: cols[0] ? (r.values as Record<string, unknown>)[cols[0].column_id] : null }]));
  ok(res, Object.fromEntries(links.map((l) => {
    const p = label.get(String(l.parent_row_id).toLowerCase());
    const v = p?.value;
    return [String(l.child_row_id).toLowerCase(), { rowId: l.parent_row_id, label: v === null || v === undefined || v === '' ? `แถว ${p?.order ?? ''}` : Array.isArray(v) ? v.join(', ') : String(v) }];
  })));
}));

export default router;
