import { Request, Router } from 'express';
import type { AuthUser } from '../../middleware/auth';
import { z } from 'zod';
import { idList, jsonParam, q, T, withTx } from '../../config/db';
import { applyCellUpdates, loadColumns } from '../../services/cellWriter';
import { createRowTx } from '../../services/rowCreate';
import { findRowByValue } from '../../services/rowFind';
import { hydrateRows, userNames } from '../../services/rowQuery';
import { readSettings, writeSettingsKey } from '../../services/sheetSettings';
import { emitToSheet } from '../../socket';
import { ah, badRequest, ok, parse, pid, reqMeta, zId } from '../../shared/http';
import { LV, requireSheet } from '../../shared/permissions';
import { detectProfile, EXTERNAL_FIELDS, firstEmptyStamp, mergeFill, parseScan, ScanProfile } from './parse';
import { externalValues } from './external';
import { fromStorage } from '../../shared/cellValue';

const router = Router();

const profileSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  delimiter: z.string().max(5),
  match: z.object({ prefix: z.string().max(60).nullish(), regex: z.string().max(300).nullish(), fieldCount: z.number().int().min(1).max(50).nullish() }).nullish(),
  fields: z.array(z.object({ index: z.number().int().min(1).max(50), columnId: zId })).min(1).max(50),
  action: z.enum(['create', 'update']),
  keyColumnId: zId.nullish(),
  onMiss: z.enum(['create', 'reject']).nullish(),
  stamps: z.array(zId).max(6).nullish(),
  onFull: z.enum(['ignore', 'reject', 'new_row']).nullish(),
  external: z.object({
    source: z.literal('delayhub_mapping'), pieceIndex: z.number().int().min(1).max(50),
    fill: z.array(z.object({ field: z.enum(EXTERNAL_FIELDS), toColumnId: zId })).min(1).max(10), onMiss: z.enum(['reject', 'allow']),
  }).nullish(),
  verify: z.object({
    sheetId: zId, refKeyColumnId: zId, checkColumnId: zId.nullish(),
    fill: z.array(z.object({ fromColumnId: zId, toColumnId: zId })).max(20).nullish(),
    onMiss: z.enum(['reject', 'allow']),
  }).nullish(),
});

const loadProfiles = async (sheetId: string): Promise<ScanProfile[]> => ((await readSettings(sheetId)).scanProfiles ?? []) as ScanProfile[];

/** Managers: save the QR formats of this sheet */
router.put('/sheets/:id/scan/profiles', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.manage);
  const { profiles } = parse(z.object({ profiles: z.array(profileSchema).max(20) }), req.body);
  const cols = new Set((await loadColumns(sheetId)).map((c) => c.column_id));
  for (const p of profiles) {
    for (const f of p.fields) if (!cols.has(f.columnId)) throw badRequest(`รูปแบบ “${p.name}”: ไม่พบคอลัมน์ที่เลือก (อาจถูกลบแล้ว)`);
    if (new Set(p.fields.map((f) => f.index)).size !== p.fields.length) throw badRequest(`รูปแบบ “${p.name}”: ข้อมูลชุดเดียวกันถูกใส่หลายคอลัมน์`);
    if (p.action === 'update' && (!p.keyColumnId || !p.fields.some((f) => f.columnId === p.keyColumnId))) throw badRequest(`รูปแบบ “${p.name}”: โหมดอัปเดตต้องเลือกคอลัมน์ที่ใช้หาแถว และคอลัมน์นั้นต้องมีข้อมูลชุดที่ใส่ให้`);
    if (p.verify) {
      const v = p.verify;
      if (v.sheetId.toLowerCase() === sheetId.toLowerCase()) throw badRequest(`รูปแบบ “${p.name}”: ตารางที่ใช้ตรวจต้องเป็นคนละชีตกับชีตนี้`);
      await requireSheet(req.user!, v.sheetId, LV.read);
      const refCols = new Set((await loadColumns(v.sheetId)).map((c) => c.column_id));
      if (!refCols.has(v.refKeyColumnId)) throw badRequest(`รูปแบบ “${p.name}”: ไม่พบคอลัมน์ค้นหาในตารางที่ใช้ตรวจ`);
      const check = v.checkColumnId ?? p.keyColumnId;
      if (!check || !p.fields.some((f) => f.columnId === check)) throw badRequest(`รูปแบบ “${p.name}”: ต้องเลือกว่าจะนำข้อมูลชุดไหนไปตรวจ (คอลัมน์นั้นต้องมีข้อมูลชุดที่ใส่ให้)`);
      for (const f of v.fill ?? []) if (!refCols.has(f.fromColumnId) || !cols.has(f.toColumnId)) throw badRequest(`รูปแบบ “${p.name}”: ไม่พบคอลัมน์ที่เลือกเติมค่า`);
    }
    for (const f of p.external?.fill ?? []) if (!cols.has(f.toColumnId)) throw badRequest(`รูปแบบ “${p.name}”: ไม่พบคอลัมน์ที่เลือกเติมค่าจาก DelayHUB`);
    for (const sc of p.stamps ?? []) if (!cols.has(sc)) throw badRequest(`รูปแบบ “${p.name}”: ไม่พบคอลัมน์เวลาที่เลือก (อาจถูกลบแล้ว)`);
    if (p.stamps?.length && p.action !== 'update') throw badRequest(`รูปแบบ “${p.name}”: การลงเวลาตามลำดับใช้กับโหมด “อัปเดตแถวที่มีอยู่” เท่านั้น`);
    if (p.match?.regex) { try { new RegExp(p.match.regex); } catch { throw badRequest(`รูปแบบ “${p.name}”: เงื่อนไข regex ไม่ถูกต้อง`); } }
  }
  await writeSettingsKey(sheetId, 'scanProfiles', profiles.length ? profiles : null);
  ok(res, { saved: true });
}));

/** Shows how a text would be split (editor "try it" box) — nothing is written */
router.post('/sheets/:id/scan/preview', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.read);
  const body = parse(z.object({ text: z.string().min(1).max(2000), profile: profileSchema.optional() }), req.body);
  const profile = body.profile ?? detectProfile(body.text, await loadProfiles(sheetId));
  if (!profile) return ok(res, { profile: null, pieces: [], values: {} });
  ok(res, { profile: { id: profile.id, name: profile.name }, ...parseScan(body.text, profile as ScanProfile) });
}));

/** Only reads: which format fits the text and which column gets which value (including the values copied from the verify sheet). Nothing is written. */
export async function resolveScan(sheetId: string, text: string, profileId?: string | null): Promise<{ profile: ScanProfile; values: Record<string, string> }> {
  const profiles = await loadProfiles(sheetId);
  if (!profiles.length) throw badRequest('ชีตนี้ยังไม่ได้ตั้งค่ารูปแบบ QR (ผู้จัดการตั้งได้ที่ปุ่ม ตั้งค่าสแกน/ผสม)');
  const profile = profileId ? profiles.find((p) => p.id === profileId) ?? null : detectProfile(text, profiles);
  if (!profile) throw badRequest('ข้อความที่สแกนไม่ตรงกับรูปแบบ QR ที่ตั้งไว้', { text: text.slice(0, 200) });
  const { values: scanned } = parseScan(text, profile);
  if (!Object.keys(scanned).length) throw badRequest(`รูปแบบ “${profile.name}”: ไม่พบข้อมูลในตำแหน่งที่กำหนด`);
  const values: Record<string, string> = { ...scanned };
  if (profile.verify) Object.assign(values, await verifyAgainst(profile, scanned, await loadColumns(sheetId)));
  if (profile.external) Object.assign(values, await externalValues(profile, text, scanned));
  return { profile, values };
}

/** Scan core, shared with other modules (line items of a trolley, devices): pick the format, split the text, create / update the row */
export type ScanOutcome = { action: 'created' | 'updated' | 'ignored'; rowId: string; rowNo: number; profile: { id: string; name: string }; stamped?: string; stampedColumnId?: string };

/** The other sheet: is the scanned value in it? Copies the wanted columns (as text; the normal checks of the column still apply when written) */
async function verifyAgainst(profile: ScanProfile, scanned: Record<string, string>, cols: any[]): Promise<Record<string, string>> {
  const v = profile.verify!;
  const checkId = v.checkColumnId ?? profile.keyColumnId!;
  const value = scanned[checkId];
  const refCols = await loadColumns(v.sheetId);
  const refKey = refCols.find((c) => c.column_id === v.refKeyColumnId);
  const found = value && refKey ? await findRowByValue(v.sheetId, refKey, value) : null;
  if (!found) {
    if (v.onMiss === 'reject') throw badRequest(`ไม่พบ “${value ?? ''}” ในตารางตรวจสอบ (${refKey?.column_name ?? 'คอลัมน์ค้นหา'}) — ไม่บันทึก`, { notFound: true, unknown: value ?? null });
    return {};
  }
  const ids = [...new Set((v.fill ?? []).map((f) => f.fromColumnId))];
  const ref: Record<string, string | null> = {};
  if (ids.length) {
    const cells = await q(`SELECT column_id, value_text, value_int, value_float, value_date, value_bool, value_json FROM Cells WHERE row_id = @r AND column_id IN ${idList('@cc')}`, { r: T.uuid(found.rowId), cc: jsonParam(ids) });
    for (const c of cells) {
      const def = refCols.find((x) => x.column_id === String(c.column_id).toLowerCase());
      if (!def) continue;
      const val = fromStorage(def.data_type, c);
      ref[String(c.column_id).toLowerCase()] = val === null || val === '' ? null : Array.isArray(val) ? val.join(',') : String(val);
    }
  }
  void cols;
  const merged = mergeFill(scanned, v.fill ?? [], ref);
  return Object.fromEntries(Object.entries(merged).filter(([k]) => !(k in scanned)));
}

/** which of the stamp columns of this row are already filled */
async function filledStamps(rowId: string, stampIds: string[]): Promise<boolean[]> {
  const cells = await q(
    `SELECT column_id FROM Cells WHERE row_id = @r AND column_id IN ${idList('@cc')}
     AND ((value_text IS NOT NULL AND value_text <> N'') OR value_int IS NOT NULL OR value_float IS NOT NULL OR value_date IS NOT NULL OR value_bool IS NOT NULL)`,
    { r: T.uuid(rowId), cc: jsonParam(stampIds) });
  const have = new Set(cells.map((c) => String(c.column_id).toLowerCase()));
  return stampIds.map((id) => have.has(id.toLowerCase()));
}

/** Scan core, shared with other modules (line items of a trolley, devices): pick the format, split the text, create / update the row */
export async function runScan(u: AuthUser, sheet: { file_id: string }, sheetId: string, text: string, profileId: string | null | undefined, req?: Request): Promise<ScanOutcome> {
  const profiles = await loadProfiles(sheetId);
  if (!profiles.length) throw badRequest('ชีตนี้ยังไม่ได้ตั้งค่ารูปแบบ QR (ผู้จัดการตั้งได้ที่ปุ่ม ตั้งค่าสแกน/ผสม)');
  const profile = profileId ? profiles.find((p) => p.id === profileId) ?? null : detectProfile(text, profiles);
  if (!profile) throw badRequest('ข้อความที่สแกนไม่ตรงกับรูปแบบ QR ที่ตั้งไว้', { text: text.slice(0, 200) });
  const { values: scanned } = parseScan(text, profile);
  if (!Object.keys(scanned).length) throw badRequest(`รูปแบบ “${profile.name}”: ไม่พบข้อมูลในตำแหน่งที่กำหนด`);

  const cols = await loadColumns(sheetId);
  const values: Record<string, string> = { ...scanned };
  if (profile.verify) Object.assign(values, await verifyAgainst(profile, scanned, cols));
  if (profile.external) Object.assign(values, await externalValues(profile, text, scanned));
  const colName = (id: string) => cols.find((c) => c.column_id === id)?.column_name ?? '';
  const stamps = profile.stamps ?? [];
  const now = new Date().toISOString();
  const found = profile.action === 'update' && profile.keyColumnId && values[profile.keyColumnId]
    ? await findRowByValue(sheetId, cols.find((c) => c.column_id === profile.keyColumnId)!, values[profile.keyColumnId], stamps.length > 0) : null;
  if (profile.action === 'update' && !found && profile.onMiss !== 'create') {
    throw badRequest(`ไม่พบแถวที่ ${colName(profile.keyColumnId ?? '') || 'คีย์'} = “${values[profile.keyColumnId!] ?? ''}”`, { notFound: true });
  }
  const create = async (extra: Record<string, string>) => {
    const made = await withTx((tx) => createRowTx(tx, u, sheet, sheetId, { ...values, ...extra }, 'scan', req));
    emitToSheet(sheetId, 'rows:changed', { sheetId, action: 'create', rowId: made.rowId, by: u.displayName }, reqMeta(req).socketId);
    return made;
  };
  const prof = { id: profile.id, name: profile.name };

  if (found) {
    const updates = Object.entries(values).filter(([c]) => c !== profile.keyColumnId).map(([columnId, value]) => ({ rowId: found.rowId, columnId, value }));
    let stamped: string | undefined;
    let stampedId: string | undefined;
    if (stamps.length) {
      const i = firstEmptyStamp(await filledStamps(found.rowId, stamps));
      if (i >= 0) { updates.push({ rowId: found.rowId, columnId: stamps[i], value: now }); stamped = colName(stamps[i]); stampedId = stamps[i]; }
      else if (profile.onFull === 'reject') throw badRequest(`แถวนี้ลงเวลาครบทุกช่องแล้ว (${stamps.map(colName).join(' → ')})`);
      else if (profile.onFull === 'new_row') { const made = await create({ [stamps[0]]: now }); return { action: 'created', rowId: made.rowId, rowNo: made.rowNo, profile: prof, stamped: colName(stamps[0]), stampedColumnId: stamps[0] }; }
      else return { action: 'ignored', rowId: found.rowId, rowNo: found.rowNo, profile: prof };
    }
    if (updates.length) await applyCellUpdates(u, sheetId, updates, { req, source: 'scan' });
    return { action: 'updated', rowId: found.rowId, rowNo: found.rowNo, profile: prof, stamped, stampedColumnId: stampedId };
  }
  const made = await create(stamps.length ? { [stamps[0]]: now } : {});
  return { action: 'created', rowId: made.rowId, rowNo: made.rowNo, profile: prof, stamped: stamps.length ? colName(stamps[0]) : undefined, stampedColumnId: stamps.length ? stamps[0] : undefined };
}

/** Fills the "add row" form: the same reading as a scan (format + check against the other sheet) but nothing is saved */
router.post('/sheets/:id/scan/resolve', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.write);
  const body = parse(z.object({ text: z.string().min(1).max(2000), profileId: z.string().max(40).nullish() }), req.body);
  const r = await resolveScan(sheetId, body.text, body.profileId);
  ok(res, { profile: { id: r.profile.id, name: r.profile.name }, values: r.values });
}));

/** A scan from the scan box */
router.post('/sheets/:id/scan', ah(async (req, res) => {
  const sheetId = pid(req);
  const u = req.user!;
  const { sheet } = await requireSheet(u, sheetId, LV.write);
  const body = parse(z.object({ text: z.string().min(1).max(2000), profileId: z.string().max(40).nullish() }), req.body);
  const r = await runScan(u, sheet, sheetId, body.text, body.profileId, req);
  const cols = await loadColumns(sheetId);
  const rec = await q(`SELECT row_id, row_order, created_by, created_at, updated_by, updated_at, deleted_at, deleted_by FROM Rows WHERE row_id = @r`, { r: T.uuid(r.rowId) });
  const { rows, userIds } = await hydrateRows(rec, cols);
  ok(res, { action: r.action, rowNo: r.rowNo, profile: r.profile, stamped: r.stamped ?? null, row: rows[0], users: await userNames(userIds) });
}));

export default router;
