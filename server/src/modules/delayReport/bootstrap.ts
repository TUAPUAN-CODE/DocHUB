import fs from 'fs';
import path from 'path';
import { q, q1, T } from '../../config/db';
import { env } from '../../config/env';
import { logger } from '../../shared/logger';
import { encryptJson } from '../connectors/secret';
import { safeFetch } from '../connectors/safeFetch';
import { DELAY_COLS, DELAY_CONNECTOR_NAME, DELAY_NAMES } from './columns';

/**
 * DelayHUB → DocHUB, set up from .env (nothing to click):
 *   DELAYHUB_URL=http://<DelayHUB server>:<port>     DELAYHUB_EXPORT_KEY=<EXPORT_API_KEY of DelayHUB>     DELAYHUB_RUN_AT=05:00 (default)   DELAYHUB_DAYS=3 (default)
 * At start-up the connector "DelayHUB → รายงาน Delay F3PFPF67" is created (or brought up to date) for the sheet of the seeded file:
 * every day at DELAYHUB_RUN_AT it reads the finished rows of the last DELAYHUB_DAYS days and updates / adds them by mapping_id.
 */
export const delayHubConfigured = () => !!(process.env.DELAYHUB_URL && process.env.DELAYHUB_EXPORT_KEY);
const base = () => String(process.env.DELAYHUB_URL ?? '').replace(/\/+$/, '').replace(/\/api$/, '');
const key = () => String(process.env.DELAYHUB_EXPORT_KEY ?? '');

export async function delaySheetId(): Promise<string | null> {
  const r = await q1(`SELECT TOP 1 s.sheet_id FROM Sheets s JOIN Files f ON f.file_id = s.file_id
                      WHERE f.is_deleted = 0 AND s.is_deleted = 0 AND f.file_name = @f AND s.sheet_name = @s ORDER BY f.created_at`,
    { f: DELAY_NAMES.file, s: DELAY_NAMES.sheet });
  return r ? String(r.sheet_id).toLowerCase() : null;
}

export async function ensureDelayConnector(): Promise<string | null> {
  if (!delayHubConfigured()) return null;
  const runAt = /^([01]\d|2[0-3]):[0-5]\d$/.test(process.env.DELAYHUB_RUN_AT ?? '') ? process.env.DELAYHUB_RUN_AT! : '05:00';
  const days = Math.min(Math.max(Number(process.env.DELAYHUB_DAYS) || 3, 1), 62);
  const sheetId = await delaySheetId();
  if (!sheetId) { logger.warn(`DelayHUB: ไม่พบไฟล์ "${DELAY_NAMES.file}" (seed ยังไม่ลง?) — ยังไม่ตั้ง connector`); return null; }
  const cols = await q(`SELECT column_id, column_name FROM Columns WHERE sheet_id = @s AND is_deleted = 0`, { s: T.uuid(sheetId) });
  const byName = new Map(cols.map((c: any) => [String(c.column_name), String(c.column_id).toLowerCase()]));
  const mapping = DELAY_COLS.filter((c) => byName.has(c.name)).map((c) => ({ source: c.field, columnId: byName.get(c.name)! }));
  const keyCol = byName.get('mapping_id');
  if (!keyCol) { logger.warn('DelayHUB: ชีตไม่มีคอลัมน์ mapping_id — ยังไม่ตั้ง connector'); return null; }
  const owner = await q1(`SELECT TOP 1 u.user_id FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id JOIN Roles r ON r.role_id = ur.role_id
                          WHERE r.role_name IN (N'admin', N'root') AND u.is_active = 1 ORDER BY CASE r.role_name WHEN N'admin' THEN 0 ELSE 1 END, u.created_at`);
  if (!owner) return null;
  const config = { url: `${base()}/api/export/f3pfpf67?days=${days}`, method: 'GET', headers: {}, format: 'json', jsonPath: 'rows' };
  const secret = encryptJson({ type: 'header', headerName: 'x-export-key', token: key() });
  const cur = await q1(`SELECT connector_id FROM Connectors WHERE is_deleted = 0 AND name = @n`, { n: DELAY_CONNECTOR_NAME });
  const p = { n: DELAY_CONNECTOR_NAME, c: T.text(JSON.stringify(config)), t: T.uuid(sheetId), m: T.text(JSON.stringify(mapping)), kc: T.uuid(keyCol), ra: runAt, sec: T.text(secret) };
  if (cur) {
    await q(`UPDATE Connectors SET kind = 'http', config_json = @c, target_sheet_id = @t, mapping_json = @m, key_column_id = @kc, schedule_min = 1440, run_at = @ra, secret_enc = @sec WHERE connector_id = @i`,
      { ...p, i: T.uuid(cur.connector_id) });
    return String(cur.connector_id);
  }
  const r = await q1(`INSERT INTO Connectors (name, kind, config_json, secret_enc, target_sheet_id, mapping_json, key_column_id, schedule_min, run_at, created_by)
                      OUTPUT inserted.connector_id VALUES (@n, 'http', @c, @sec, @t, @m, @kc, 1440, @ra, @u)`, { ...p, u: T.uuid(owner.user_id) });
  logger.info(`DelayHUB: ตั้ง connector "${DELAY_CONNECTOR_NAME}" ดึงทุกวัน ${runAt} น. (${days} วันล่าสุด)`);
  return String(r!.connector_id);
}

/** The Excel form F3PFPV04 (blank template) is DelayHUB's: fetched from it and kept in UPLOAD_DIR/delayhub (refreshed once a day) */
const TEMPLATE = () => path.resolve(env.uploadDir, 'delayhub', 'F3PFPV04.xlsx');
export async function delayTemplate(): Promise<Buffer> {
  const file = TEMPLATE();
  const st = fs.existsSync(file) ? fs.statSync(file) : null;
  if (st && Date.now() - st.mtimeMs < 24 * 3600_000) return fs.readFileSync(file);
  if (!delayHubConfigured()) { if (st) return fs.readFileSync(file); throw new Error('ยังไม่ได้ตั้ง DELAYHUB_URL / DELAYHUB_EXPORT_KEY ใน .env ของ DocHUB'); }
  try {
    const r = await safeFetch(`${base()}/api/export/f3pfpf67/template.xlsx`, { headers: { 'x-export-key': key() } });
    if (r.status !== 200 || r.body.length < 1000) throw new Error(`DelayHUB ตอบ ${r.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.body);
    return r.body;
  } catch (e) {
    if (st) { logger.warn(`DelayHUB template: ${(e as Error).message} — ใช้สำเนาเดิม`); return fs.readFileSync(file); }
    throw new Error(`ดึงแบบฟอร์ม Excel จาก DelayHUB ไม่สำเร็จ: ${(e as Error).message}`);
  }
}
