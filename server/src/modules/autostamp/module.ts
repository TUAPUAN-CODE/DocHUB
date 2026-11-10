import { env } from '../../config/env';
import { idList, jsonParam, q } from '../../config/db';
import { ExtraWrite, registerAfterCellsWritten, registerColumnGuard } from '../../services/hooks';
import { loadColumns, writeCell } from '../../services/cellWriter';
import { normalizeValue, toColumnDef } from '../../shared/cellValue';
import { safeJson } from '../../shared/http';

/**
 * "Last updated" columns: a date column marked `autoStamp: 'updatedAt'` gets today's date and a text column marked
 * `autoStamp: 'updatedBy'` gets the editor's name whenever a row is created or any of its other cells changes.
 * Imports keep the values in the file (history brought over from Excel), and a rollback restores them as they were.
 */
export type StampKind = 'updatedAt' | 'updatedBy';
export const STAMP_TYPES: Record<StampKind, string[]> = { updatedAt: ['date', 'datetime'], updatedBy: ['varchar', 'text'] };

export function stampOf(col: { data_type: string; validation?: unknown }): StampKind | null {
  const v = typeof col.validation === 'string' ? safeJson<Record<string, any>>(col.validation, {}) : (col.validation as Record<string, any> | null);
  const k = v?.autoStamp;
  return (k === 'updatedAt' || k === 'updatedBy') && STAMP_TYPES[k as StampKind].includes(col.data_type) ? k : null;
}

/** sources that bring values from elsewhere (or are the stamp itself): they never stamp, and may write the stamp columns */
const PASSIVE = new Set(['import', 'rollback', 'type_change', 'connector', 'formula', 'stamp']);

/** Today in the app's time zone (YYYY-MM-DD), or now for a date-time column */
export function stampValue(kind: StampKind, dataType: string, user: { displayName: string }, now = new Date()): string {
  if (kind === 'updatedBy') return user.displayName;
  if (dataType === 'datetime') return now.toISOString();
  return new Date(now.getTime() + env.tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

registerColumnGuard((col, source) => (stampOf(col) && !PASSIVE.has(source) ? 'คอลัมน์นี้ระบบเติมให้อัตโนมัติเมื่อมีการแก้ไขแถว' : null));

registerAfterCellsWritten(async (ctx) => {
  if (PASSIVE.has(ctx.source) || !ctx.rowIds.length) return [];
  const cols = (await loadColumns(ctx.sheetId, ctx.tx)).map(toColumnDef).filter((c) => stampOf(c));
  if (!cols.length) return [];
  const ids = [...new Set(ctx.rowIds.map((r) => r.toLowerCase()))];
  const rows = await q(`SELECT row_id, row_order FROM Rows WHERE row_id IN ${idList('@ids')} AND is_deleted = 0`, { ids: jsonParam(ids) }, ctx.tx);
  const now = new Date();
  const out: ExtraWrite[] = [];
  for (const r of rows) {
    for (const col of cols) {
      const n = normalizeValue(col, stampValue(stampOf(col)!, col.data_type, ctx.user, now), { skipRequired: true });
      if (!n.ok) continue;
      const w = await writeCell(ctx.tx, { sheetId: ctx.sheetId, rowId: r.row_id, col, value: n.value, userId: ctx.user.id, source: 'stamp' });
      if (w.changed) out.push({ rowId: r.row_id, columnId: col.column_id, rowNo: r.row_order, columnName: col.column_name, oldValue: w.oldValue, newValue: w.newValue, historyId: w.historyId, at: w.at });
    }
  }
  return out;
});

export default {};
