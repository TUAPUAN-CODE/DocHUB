import { q1, q, T, Tx } from '../config/db';
import { badRequest, safeJson } from '../shared/http';

/** Sheet settings JSON is shared by several modules: each reads / writes only its own key */
/** `tx`: inside a transaction that created / changed the sheet (reading outside it would wait for that same transaction) */
export async function readSettings(sheetId: string, tx?: Tx): Promise<Record<string, any>> {
  const r = await q1(`SELECT settings_json FROM Sheets WHERE sheet_id = @s`, { s: T.uuid(sheetId) }, tx);
  return safeJson<Record<string, any>>(r?.settings_json, {}) ?? {};
}
export async function writeSettingsKey(sheetId: string, key: string, value: unknown, tx?: Tx): Promise<Record<string, any>> {
  const cur = await readSettings(sheetId, tx);
  if (value === null || value === undefined) delete cur[key]; else cur[key] = value;
  await q(`UPDATE Sheets SET settings_json = @j, updated_at = SYSUTCDATETIME() WHERE sheet_id = @s`, { j: T.text(JSON.stringify(cur)), s: T.uuid(sheetId) }, tx);
  return cur;
}
/** Replaces column ids inside a settings value (used after a sheet copy) */
export function remapIds<T>(value: T, map: Map<string, string>): T {
  const walk = (v: any): any => {
    if (typeof v === 'string') return map.get(v.toLowerCase()) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

/**
 * A sheet marked `singleRow` (settings) keeps ONE row — e.g. the header of a form file where 1 file = 1 document. Called before rows are added
 * (`adding` = how many): refuses when the sheet would then have more than one live row. Deleted rows (trash) do not count.
 */
export async function assertRowRoom(sheetId: string, adding: number, tx?: Tx): Promise<void> {
  const s = await readSettings(sheetId, tx);
  if (!s.singleRow) return;
  const n = await q1(`SELECT COUNT(*) AS n FROM Rows WHERE sheet_id = @s AND is_deleted = 0`, { s: T.uuid(sheetId) }, tx);
  if (Number(n?.n ?? 0) + adding > 1) throw badRequest('ชีตนี้เก็บได้แถวเดียว (1 ไฟล์ = 1 เอกสาร) — ถ้าจะทำเอกสารใหม่ ให้ทำสำเนาไฟล์');
}
