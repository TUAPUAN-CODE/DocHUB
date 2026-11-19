import crypto from 'crypto';
import { q, q1, T, Tx } from '../config/db';
import type { AuthUser } from '../middleware/auth';
import { audit } from '../shared/audit';
import { CellValue, toColumnDef, toStorage } from '../shared/cellValue';
import { safeJson } from '../shared/http';
import { loadColumns } from './cellWriter';
import { getDocCfg } from './docNumber';
import { columnWriteBlockedReason, runAfterCellsWritten } from './hooks';
import { lookupResolver, normalizeWithLookup, parentValueOf } from './lookup';

/**
 * Many new rows in one go (same insert as the file import POST /sheets/:id/rows/import: rows, cells and their first history in a few
 * statements, then the formula / after-write hooks once). For big automatic pulls (connectors); one row at a time is ~40 statements.
 * Rows that do not pass validation are returned in `invalid` (not inserted). Sheets with auto document-number columns are not handled
 * here (`supported` = false): the caller creates those rows one by one.
 */
export async function bulkSupported(sheetId: string, tx?: Tx): Promise<boolean> {
  const cols = await loadColumns(sheetId, tx);
  return !cols.some((c: any) => getDocCfg(toColumnDef(c)));
}

export async function bulkCreateRowsTx(tx: Tx, user: AuthUser, sheet: { file_id: string }, sheetId: string, list: Record<string, unknown>[], source: string) {
  const cols = await loadColumns(sheetId, tx);
  const resolve = lookupResolver();
  const valid: { cells: { def: ReturnType<typeof toColumnDef>; value: CellValue }[] }[] = [];
  const invalid: { index: number; message: string }[] = [];
  for (const [index, values] of list.entries()) {
    const lowered = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
    const rawAll: Record<string, unknown> = Object.fromEntries(cols.map((c: any) => [c.column_id, c.column_id in lowered ? lowered[c.column_id] : safeJson(c.default_value, null)]));
    const cells: { def: ReturnType<typeof toColumnDef>; value: CellValue }[] = [];
    let bad: string | null = null;
    for (const c of cols) {
      const def = toColumnDef(c);
      if (columnWriteBlockedReason(def, 'create')) continue;
      const n = await normalizeWithLookup(def, rawAll[def.column_id], await parentValueOf(def, rawAll), resolve);
      if (!n.ok) { bad = `${def.column_name}: ${n.error}`; break; }
      if (n.value !== null) cells.push({ def, value: n.value });
    }
    if (bad) invalid.push({ index, message: bad }); else valid.push({ cells });
  }
  if (!valid.length) return { inserted: 0, invalid };

  const o = await q1(`SELECT ISNULL(MAX(row_order), 0) AS o FROM Rows WITH (UPDLOCK, HOLDLOCK) WHERE sheet_id = @s`, { s: T.uuid(sheetId) }, tx);
  const start = Number(o?.o ?? 0);
  const rowsJson: { row_id: string; ord: number }[] = [];
  const cellsJson: Record<string, unknown>[] = [];
  const histJson: Record<string, unknown>[] = [];
  valid.forEach((v, i) => {
    const rowId = crypto.randomUUID();
    rowsJson.push({ row_id: rowId, ord: start + i + 1 });
    for (const c of v.cells) {
      const cellId = crypto.randomUUID();
      cellsJson.push({ cell_id: cellId, row_id: rowId, column_id: c.def.column_id, ...toStorage(c.def.data_type, c.value) });
      histJson.push({ cell_id: cellId, row_id: rowId, column_id: c.def.column_id, nv: JSON.stringify(c.value) });
    }
  });
  await q(`INSERT INTO Rows (row_id, sheet_id, row_order, created_by, updated_by)
           SELECT row_id, @s, ord, @u, @u FROM OPENJSON(@j) WITH (row_id UNIQUEIDENTIFIER, ord INT)`,
    { s: T.uuid(sheetId), u: T.uuid(user.id), j: T.text(JSON.stringify(rowsJson)) }, tx);
  for (let i = 0; i < cellsJson.length; i += 2000) {
    await q(`INSERT INTO Cells (cell_id, row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, updated_by)
             SELECT cell_id, row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, @u
             FROM OPENJSON(@j) WITH (cell_id UNIQUEIDENTIFIER, row_id UNIQUEIDENTIFIER, column_id UNIQUEIDENTIFIER, value_text NVARCHAR(MAX),
               value_int BIGINT, value_float FLOAT, value_date DATETIME2, value_bool BIT, value_json NVARCHAR(MAX))`,
      { u: T.uuid(user.id), j: T.text(JSON.stringify(cellsJson.slice(i, i + 2000))) }, tx);
    await q(`INSERT INTO CellHistory (cell_id, sheet_id, row_id, column_id, old_value, new_value, change_source, changed_by, version_number)
             SELECT cell_id, @s, row_id, column_id, NULL, nv, @src, @u, 1
             FROM OPENJSON(@j) WITH (cell_id UNIQUEIDENTIFIER, row_id UNIQUEIDENTIFIER, column_id UNIQUEIDENTIFIER, nv NVARCHAR(MAX))`,
      { s: T.uuid(sheetId), u: T.uuid(user.id), src: T.text(source), j: T.text(JSON.stringify(histJson.slice(i, i + 2000))) }, tx);
  }
  await runAfterCellsWritten({ tx, user, sheetId, rowIds: rowsJson.map((r) => r.row_id), source });
  await audit({ userId: user.id, action: 'rows_import', entityType: 'sheet', entityId: sheetId, fileId: sheet.file_id, sheetId,
    newValue: { rows: valid.length, firstRowNo: start + 1, via: source } }, undefined, tx);
  return { inserted: valid.length, invalid };
}
