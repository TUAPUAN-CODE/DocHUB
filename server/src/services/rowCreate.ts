import { q1, T, Tx } from '../config/db';
import type { AuthUser } from '../middleware/auth';
import { audit } from '../shared/audit';
import { CellValue, normalizeValue, toColumnDef } from '../shared/cellValue';
import { badRequest, safeJson } from '../shared/http';
import { loadColumns, writeCell } from './cellWriter';
import { DocNumberCfg, docDate, docPrefixes, getDocCfg, interpretDocRaw, nextDocNumbers } from './docNumber';
import { columnWriteBlockedReason, runAfterCellsWritten } from './hooks';
import { getLookup, lookupResolver, normalizeWithLookup, parentValueOf } from './lookup';
import type { Request } from 'express';
import { assertRowRoom } from './sheetSettings';

void normalizeValue; void getLookup;

/**
 * Creates one row inside the caller's transaction, with the same rules as POST /sheets/:id/rows
 * (validation, relationship lists, auto document numbers, formula columns). Used by modules that make rows as a side effect
 * (scan, mix). `values` is keyed by column id.
 */
export async function createRowTx(tx: Tx, user: AuthUser, sheet: { file_id: string }, sheetId: string, values: Record<string, unknown>, source: string, req?: Request): Promise<{ rowId: string; rowNo: number }> {
  const cols = await loadColumns(sheetId, tx);
  const lowered = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  const fieldErrors: Record<string, string> = {};
  const toWrite: { col: ReturnType<typeof toColumnDef>; value: CellValue }[] = [];
  const resolve = lookupResolver();
  const rawAll: Record<string, unknown> = Object.fromEntries(cols.map((c) => [c.column_id, c.column_id in lowered ? lowered[c.column_id] : safeJson(c.default_value, null)]));
  const docGen: { def: ReturnType<typeof toColumnDef>; cfg: DocNumberCfg; prefix: string | null; date: ReturnType<typeof docDate> }[] = [];
  for (const c of cols) {
    const def = toColumnDef(c);
    if (columnWriteBlockedReason(def, 'create')) continue;
    let raw = rawAll[c.column_id];
    const dc = getDocCfg(def);
    if (dc) {
      const r = interpretDocRaw(def, dc, raw, await docPrefixes(dc), 'create');
      if (!r.ok) { fieldErrors[c.column_id] = r.error; continue; }
      if (r.kind === 'generate') { docGen.push({ def, cfg: dc, prefix: r.prefix, date: docDate(dc, rawAll) }); continue; }
      raw = r.value;
    }
    const n = await normalizeWithLookup(def, raw, await parentValueOf(def, rawAll), resolve);
    if (!n.ok) fieldErrors[c.column_id] = n.error;
    else if (n.value !== null) toWrite.push({ col: def, value: n.value });
  }
  if (Object.keys(fieldErrors).length) throw badRequest(Object.values(fieldErrors)[0], { fields: fieldErrors });

  const o = await q1(`SELECT ISNULL(MAX(row_order), 0) + 1 AS o FROM Rows WITH (UPDLOCK, HOLDLOCK) WHERE sheet_id = @s`, { s: T.uuid(sheetId) }, tx);
  await assertRowRoom(sheetId, 1, tx);
  const r = await q1(`INSERT INTO Rows (sheet_id, row_order, created_by, updated_by) OUTPUT inserted.row_id VALUES (@s, @o, @u, @u)`,
    { s: T.uuid(sheetId), o: T.int(o!.o), u: T.uuid(user.id) }, tx);
  for (const g of docGen) {
    const [num] = await nextDocNumbers(tx, sheetId, g.def, g.cfg, [{ prefix: g.prefix, date: g.date }]);
    toWrite.push({ col: g.def, value: num });
  }
  for (const w of toWrite) await writeCell(tx, { sheetId, rowId: r!.row_id, col: w.col, value: w.value, userId: user.id, source });
  await runAfterCellsWritten({ tx, user, sheetId, rowIds: [r!.row_id], source });
  await audit({ userId: user.id, action: 'row_create', entityType: 'row', entityId: r!.row_id, fileId: sheet.file_id, sheetId,
    newValue: { rowNo: o!.o, via: source, values: Object.fromEntries(toWrite.map((w) => [w.col.column_name, w.value])) } }, req, tx);
  return { rowId: r!.row_id as string, rowNo: Number(o!.o) };
}
