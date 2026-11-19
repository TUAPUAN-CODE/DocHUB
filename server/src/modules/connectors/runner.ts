import { env } from '../../config/env';
import { q, q1, T, withTx } from '../../config/db';
import { loadAuthUser } from '../../middleware/auth';
import { applyCellUpdates, loadColumns } from '../../services/cellWriter';
import { createRowTx } from '../../services/rowCreate';
import { bulkCreateRowsTx, bulkSupported } from '../../services/rowBulk';
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
  // one run at a time (a running run refreshes its marker every minute; one older than 5 min was cut off by a restart and is ignored)
  const lock = await q(`UPDATE Connectors SET running_since = SYSUTCDATETIME() OUTPUT inserted.connector_id WHERE connector_id = @i AND (running_since IS NULL OR running_since < DATEADD(MINUTE, -5, SYSUTCDATETIME()))`, { i: T.uuid(id) });
  if (!lock.length) throw new Error('กำลังดึงข้อมูลอยู่ กรุณารอสักครู่');
  const res: RunResult = { read: 0, created: 0, updated: 0, skipped: 0, errors: [] };
  // a long run (a big first pull) keeps its lock fresh, so the scheduler never starts a second run of the same connector next to it
  const beat = setInterval(() => { void q(`UPDATE Connectors SET running_since = SYSUTCDATETIME() WHERE connector_id = @i AND running_since IS NOT NULL`, { i: T.uuid(id) }).catch(() => undefined); }, 60_000);
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

    // every key already in the sheet, read once (the first row wins, like a lookup by value)
    const keyOf = (v: unknown) => { const t = String(v ?? '').trim(); if (!keyCol) return t; if (keyCol.data_type === 'int' || keyCol.data_type === 'float') { const n = Number(t.replace(/,/g, '')); return Number.isFinite(n) ? String(n) : ''; } return t.toLowerCase(); };
    const existing = new Map<string, string>();
    if (keyCol) {
      const all = await q(`SELECT r.row_id, c.value_int, c.value_float, c.value_text FROM Rows r JOIN Cells c ON c.row_id = r.row_id AND c.column_id = @c
                           WHERE r.sheet_id = @s AND r.is_deleted = 0 ORDER BY r.row_order`, { s: T.uuid(sheetId), c: T.uuid(keyCol.column_id) });
      for (const r of all) { const k = keyOf(r.value_int ?? r.value_float ?? r.value_text); if (k && !existing.has(k)) existing.set(k, String(r.row_id)); }
    }
    const toCreate: Record<string, unknown>[] = [];
    const toUpdate: { rowId: string; columnId: string; value: unknown }[] = [];
    const seenKeys = new Set<string>();
    for (const [i, rec] of records.entries()) {
      const values: Record<string, unknown> = {};
      for (const m of mapping) values[m.columnId.toLowerCase()] = scalar(rec[m.source]);
      if (keyCol && keyMap) {
        const kv = values[keyCol.column_id];
        if (kv === null || kv === '' || kv === undefined) { res.skipped++; continue; }
        const ks = keyOf(kv);
        if (!ks || seenKeys.has(ks)) { res.skipped++; continue; }   // duplicate key inside the source: first one wins
        seenKeys.add(ks);
        const hit = existing.get(ks);
        if (hit) { for (const [cid, v] of Object.entries(values)) if (cid !== keyCol.column_id) toUpdate.push({ rowId: hit, columnId: cid, value: v }); res.updated++; continue; }
      }
      toCreate.push(values);
      void i;
    }
    // new rows: in bulk, 500 to a transaction (the file-import insert); sheets with auto document numbers, or a batch that fails, one by one
    const createOne = async (v: Record<string, unknown>, n: number) => {
      try { await withTx((tx) => createRowTx(tx, user, sheet, sheetId, v, 'connector')); res.created++; }
      catch (e) { res.skipped++; if (res.errors.length < 10) res.errors.push(`แถวที่ ${n}: ${(e as Error).message}`); }
    };
    const bulk = toCreate.length > 1 && await bulkSupported(sheetId);
    for (let i = 0; i < toCreate.length; i += 500) {
      const batch = toCreate.slice(i, i + 500);
      if (!bulk) { for (const [j, v] of batch.entries()) await createOne(v, i + j + 1); continue; }
      try {
        const r = await withTx((tx) => bulkCreateRowsTx(tx, user, sheet, sheetId, batch, 'connector'));
        res.created += r.inserted; res.skipped += r.invalid.length;
        for (const x of r.invalid) if (res.errors.length < 10) res.errors.push(`แถวที่ ${i + x.index + 1}: ${x.message}`);
      } catch (e) {
        logger.warn(`connector ${id}: bulk insert failed (${(e as Error).message}) — one by one`);
        for (const [j, v] of batch.entries()) await createOne(v, i + j + 1);
      }
    }
    for (let i = 0; i < toUpdate.length; i += 4000) {
      const r = await applyCellUpdates(user, sheetId, toUpdate.slice(i, i + 4000), { source: 'connector', partial: true, skipRequired: true, auditAction: 'connector_update' }) as { errors?: { message: string }[] };
      for (const e of r?.errors ?? []) if (res.errors.length < 10) res.errors.push(e.message);
    }
    emitToSheet(sheetId, 'rows:changed', { sheetId, action: 'import', by: 'connector' });
    const msg = `อ่าน ${res.read} · เพิ่ม ${res.created} · อัปเดต ${res.updated}${res.skipped ? ` · ข้าม ${res.skipped}` : ''}`;
    await q(`UPDATE Connectors SET last_run_at = SYSUTCDATETIME(), last_status = 'ok', last_message = @m, running_since = NULL WHERE connector_id = @i`, { m: T.text(msg), i: T.uuid(id) });
    clearInterval(beat);
    return res;
  } catch (e) {
    clearInterval(beat);
    const needs = e instanceof NeedsAuth;
    await q(`UPDATE Connectors SET last_run_at = SYSUTCDATETIME(), last_status = @s, last_message = @m, running_since = NULL WHERE connector_id = @i`, { s: needs ? 'needs_auth' : 'error', m: T.text((e as Error).message.slice(0, 900)), i: T.uuid(id) });
    throw e;
  }
}

/** A daily connector (run_at 'HH:mm' in the app's time zone, APP_TZ_OFFSET_MINUTES = Thailand by default) is due once today's time has passed and it has not run since */
export function dailyDue(runAt: string, lastRunAt: Date | string | null, now = new Date(), tzOffsetMin = env.tzOffsetMinutes): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(String(runAt ?? ''));
  if (!m) return false;
  const local = new Date(now.getTime() + tzOffsetMin * 60_000); // the wall clock of the app's zone, read with getUTC*
  const at = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), Number(m[1]), Number(m[2])) - tzOffsetMin * 60_000);
  if (now < at) return false;
  return !lastRunAt || new Date(lastRunAt) < at;
}

/** Scheduler (runs on one server only, see services/leader.ts): every minute start the connectors that are due */
export function startConnectorScheduler() {
  const tick = async () => {
    try {
      // every N minutes (no clock time)
      const due: { connector_id: string }[] = await q(`SELECT connector_id FROM Connectors WHERE is_deleted = 0 AND schedule_min > 0 AND run_at IS NULL AND target_sheet_id IS NOT NULL AND (last_run_at IS NULL OR DATEADD(MINUTE, schedule_min, last_run_at) <= SYSUTCDATETIME()) AND (running_since IS NULL OR running_since < DATEADD(MINUTE, -5, SYSUTCDATETIME()))`);
      // every day at a clock time (server local time, e.g. 05:00)
      const daily = await q(`SELECT connector_id, run_at, last_run_at FROM Connectors WHERE is_deleted = 0 AND schedule_min > 0 AND run_at IS NOT NULL AND target_sheet_id IS NOT NULL AND (running_since IS NULL OR running_since < DATEADD(MINUTE, -5, SYSUTCDATETIME()))`);
      for (const d of daily) if (dailyDue(d.run_at, d.last_run_at)) due.push(d);
      for (const d of due) await runConnector(d.connector_id).catch((e) => logger.warn(`connector ${d.connector_id}: ${(e as Error).message}`));
    } catch (e) { logger.warn(`connector scheduler: ${(e as Error).message}`); }
  };
  const t = setInterval(() => void tick(), 60_000);
  return () => clearInterval(t);
}
