import { q, q1, T, withTx } from '../../config/db';
import { loadAuthUser } from '../../middleware/auth';
import { applyCellUpdates, loadColumns } from '../../services/cellWriter';
import { createRowTx } from '../../services/rowCreate';
import { findRowByValue } from '../../services/rowFind';
import { LV, requireSheet } from '../../shared/permissions';
import { safeJson } from '../../shared/http';
import { emitToSheet } from '../../socket';
import { logger } from '../../shared/logger';
import { HttpConfig, loadRecords, NeedsAuth } from './source';
import type { Rec } from './parse';

export interface Mapping { source: string; columnId: string }
export const MAX_ROWS = Number(process.env.CONNECTOR_MAX_ROWS) || 50_000;

export interface RunResult { read: number; created: number; updated: number; skipped: number; errors: string[] }

const scalar = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);

/** Pulls the source and writes it into the target sheet as the connector's owner (same validation / permissions as typing in the grid) */
export async function runConnector(id: string, opts: { userId?: string } = {}): Promise<RunResult> {
  const c = await q1(`SELECT * FROM Connectors WHERE connector_id = @i AND is_deleted = 0`, { i: T.uuid(id) });
  if (!c) throw new Error('ไม่พบ connector');
  if (!c.target_sheet_id) throw new Error('ยังไม่ได้เลือกตารางปลายทาง');
  // one run at a time (a stale marker older than 30 min is ignored)
  const lock = await q(`UPDATE Connectors SET running_since = SYSUTCDATETIME() OUTPUT inserted.connector_id WHERE connector_id = @i AND (running_since IS NULL OR running_since < DATEADD(MINUTE, -30, SYSUTCDATETIME()))`, { i: T.uuid(id) });
  if (!lock.length) throw new Error('กำลังดึงข้อมูลอยู่ กรุณารอสักครู่');
  const res: RunResult = { read: 0, created: 0, updated: 0, skipped: 0, errors: [] };
  try {
    const user = await loadAuthUser(opts.userId ?? c.created_by);
    if (!user) throw new Error('เจ้าของ connector ถูกปิดการใช้งาน');
    const sheetId: string = c.target_sheet_id;
    const { sheet } = await requireSheet(user, sheetId, LV.write);
    const cfg = safeJson<HttpConfig>(c.config_json, { url: '', format: 'auto' });
    const mapping = safeJson<Mapping[]>(c.mapping_json, []).filter((m) => m.source && m.columnId);
    if (!mapping.length) throw new Error('ยังไม่ได้กำหนดการจับคู่ข้อมูลกับคอลัมน์');
    const records: Rec[] = await loadRecords(c.kind, cfg, c.secret_enc, async (enc) => { await q(`UPDATE Connectors SET secret_enc = @s WHERE connector_id = @i`, { s: T.text(enc), i: T.uuid(id) }); });
    if (records.length > MAX_ROWS) throw new Error(`ข้อมูลมี ${records.length.toLocaleString()} แถว เกินที่อนุญาตต่อครั้ง (${MAX_ROWS.toLocaleString()})`);
    res.read = records.length;
    const cols = await loadColumns(sheetId);
    const keyCol = c.key_column_id ? cols.find((x: any) => x.column_id === String(c.key_column_id).toLowerCase()) : null;
    const keyMap = keyCol ? mapping.find((m) => m.columnId.toLowerCase() === keyCol.column_id) : null;
    if (c.key_column_id && (!keyCol || !keyMap)) throw new Error('คอลัมน์คีย์ต้องอยู่ในรายการจับคู่');

    const toCreate: Record<string, unknown>[] = [];
    const toUpdate: { rowId: string; columnId: string; value: unknown }[] = [];
    const seenKeys = new Set<string>();
    for (const [i, rec] of records.entries()) {
      const values: Record<string, unknown> = {};
      for (const m of mapping) values[m.columnId.toLowerCase()] = scalar(rec[m.source]);
      if (keyCol && keyMap) {
        const kv = values[keyCol.column_id];
        if (kv === null || kv === '' || kv === undefined) { res.skipped++; continue; }
        const ks = String(kv);
        if (seenKeys.has(ks)) { res.skipped++; continue; }   // duplicate key inside the source: first one wins
        seenKeys.add(ks);
        const hit = await findRowByValue(sheetId, keyCol, ks);
        if (hit) { for (const [cid, v] of Object.entries(values)) if (cid !== keyCol.column_id) toUpdate.push({ rowId: hit.rowId, columnId: cid, value: v }); res.updated++; continue; }
      }
      toCreate.push(values);
      void i;
    }
    for (let i = 0; i < toCreate.length; i += 100) {
      const batch = toCreate.slice(i, i + 100);
      for (const v of batch) {
        try { await withTx((tx) => createRowTx(tx, user, sheet, sheetId, v, 'connector')); res.created++; }
        catch (e) { res.skipped++; if (res.errors.length < 10) res.errors.push(`แถวที่ ${i + 1}: ${(e as Error).message}`); }
      }
    }
    for (let i = 0; i < toUpdate.length; i += 4000) {
      const r = await applyCellUpdates(user, sheetId, toUpdate.slice(i, i + 4000), { source: 'connector', partial: true, skipRequired: true, auditAction: 'connector_update' }) as { errors?: { message: string }[] };
      for (const e of r?.errors ?? []) if (res.errors.length < 10) res.errors.push(e.message);
    }
    emitToSheet(sheetId, 'rows:changed', { sheetId, action: 'import', by: 'connector' });
    const msg = `อ่าน ${res.read} · เพิ่ม ${res.created} · อัปเดต ${res.updated}${res.skipped ? ` · ข้าม ${res.skipped}` : ''}`;
    await q(`UPDATE Connectors SET last_run_at = SYSUTCDATETIME(), last_status = 'ok', last_message = @m, running_since = NULL WHERE connector_id = @i`, { m: T.text(msg), i: T.uuid(id) });
    return res;
  } catch (e) {
    const needs = e instanceof NeedsAuth;
    await q(`UPDATE Connectors SET last_run_at = SYSUTCDATETIME(), last_status = @s, last_message = @m, running_since = NULL WHERE connector_id = @i`, { s: needs ? 'needs_auth' : 'error', m: T.text((e as Error).message.slice(0, 900)), i: T.uuid(id) });
    throw e;
  }
}

/** Scheduler (runs on one server only, see services/leader.ts): every minute start the connectors that are due */
export function startConnectorScheduler() {
  const tick = async () => {
    try {
      const due = await q(`SELECT connector_id FROM Connectors WHERE is_deleted = 0 AND schedule_min > 0 AND target_sheet_id IS NOT NULL AND (last_run_at IS NULL OR DATEADD(MINUTE, schedule_min, last_run_at) <= SYSUTCDATETIME()) AND (running_since IS NULL OR running_since < DATEADD(MINUTE, -30, SYSUTCDATETIME()))`);
      for (const d of due) await runConnector(d.connector_id).catch((e) => logger.warn(`connector ${d.connector_id}: ${(e as Error).message}`));
    } catch (e) { logger.warn(`connector scheduler: ${(e as Error).message}`); }
  };
  const t = setInterval(() => void tick(), 60_000);
  return () => clearInterval(t);
}
