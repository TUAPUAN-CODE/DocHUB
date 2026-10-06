import { q1, q, T } from '../config/db';
import type { Tx } from '../config/db';
import { safeJson } from '../shared/http';

/** Sheet settings JSON is shared by several modules: each reads / writes only its own key */
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
