import sql from 'mssql';
import { q, q1, T, Tx } from '../../config/db';
import { loadColumns } from '../../services/cellWriter';
import { readSettings } from '../../services/sheetSettings';
import { DataType, fromStorage, toColumnDef } from '../../shared/cellValue';
import { safeJson } from '../../shared/http';
import { stampOf } from '../autostamp/module';
import { diffSnapshots, RevDiff, Snapshot } from './diff';
import { diffFormats, FormatDiff, formatChangeCount, formatSettings, FormatSnap } from './format';
import { parseTemplates } from '../../services/pdfTemplates';

/** kind: data = a Master Data / ทั่วไป revision (rows + format) · format = a แบบฟอร์มบันทึก revision (format only) */
export interface RevMeta {
  revNo: number; note: string | null; rowCount: number; added: number; changed: number; removed: number;
  kind: 'data' | 'format'; formatChanges: number;
  createdAt: Date; createdBy: string; createdByName: string | null;
}
const META_COLS = `rv.rev_no, rv.note, rv.row_count, rv.added_count, rv.changed_count, rv.removed_count, rv.kind, rv.format_changes, rv.created_at, rv.created_by, u.display_name`;
const toMeta = (r: any): RevMeta => ({
  revNo: r.rev_no, note: r.note ?? null, rowCount: r.row_count, added: r.added_count, changed: r.changed_count, removed: r.removed_count,
  kind: r.kind === 'format' ? 'format' : 'data', formatChanges: Number(r.format_changes ?? 0),
  createdAt: r.created_at, createdBy: r.created_by, createdByName: r.display_name ?? null,
});

export type DocType = 'master_data' | 'record' | null;
/** The document type of the file the sheet belongs to */
export async function sheetDocType(sheetId: string, tx?: Tx): Promise<DocType> {
  const r = await q1(`SELECT f.doc_type FROM Sheets s JOIN Files f ON f.file_id = s.file_id WHERE s.sheet_id = @s`, { s: T.uuid(sheetId) }, tx);
  return r?.doc_type === 'master_data' || r?.doc_type === 'record' ? r.doc_type : null;
}

/** The sheet's format now: columns, form settings, the file's PDF layouts that use this sheet */
export async function formatSnapshot(sheetId: string, tx?: Tx): Promise<FormatSnap> {
  const cols = await loadColumns(sheetId, tx);
  const settings = await readSettings(sheetId, tx);
  const f = await q1(`SELECT f.pdf_templates FROM Sheets s JOIN Files f ON f.file_id = s.file_id WHERE s.sheet_id = @s`, { s: T.uuid(sheetId) }, tx);
  const id = sheetId.toLowerCase();
  return {
    cols: cols.map((c: any) => ({
      id: c.column_id, name: c.column_name, type: c.data_type, order: c.display_order, required: !!c.is_required,
      options: safeJson(c.select_options, []), validation: safeJson(c.validation_rule, {}), defaultValue: safeJson(c.default_value, null),
      placeholder: c.placeholder ?? null, description: c.description ?? null,
    })),
    settings: formatSettings(settings as Record<string, unknown>),
    pdf: parseTemplates(f?.pdf_templates).map((t) => ({ id: t.id, name: t.name, json: JSON.stringify(t) })).filter((t) => t.json.toLowerCase().includes(id)),
  };
}

/** Columns whose values name a row in the change list (sheet setting; default: the first column) */
export async function keyColumnIds(sheetId: string): Promise<string[]> {
  const s = await readSettings(sheetId);
  return Array.isArray(s.revisions?.keyColumnIds) ? s.revisions.keyColumnIds.map((x: string) => String(x).toLowerCase()) : [];
}

/** Every live row of the sheet with its current values */
export async function snapshotSheet(sheetId: string, tx?: Tx): Promise<Snapshot> {
  const cols = (await loadColumns(sheetId, tx)).map(toColumnDef);
  const types = new Map(cols.map((c) => [c.column_id, c.data_type as DataType]));
  const rows = await q(`SELECT row_id, row_order FROM Rows WHERE sheet_id = @s AND is_deleted = 0 ORDER BY row_order`, { s: T.uuid(sheetId) }, tx);
  const cells = await q(
    `SELECT c.row_id, c.column_id, c.value_text, c.value_int, c.value_float, c.value_date, c.value_bool, c.value_json
     FROM Cells c JOIN Rows r ON r.row_id = c.row_id WHERE r.sheet_id = @s AND r.is_deleted = 0`,
    { s: T.uuid(sheetId) }, tx,
  );
  const byRow = new Map<string, Record<string, any>>();
  for (const c of cells) {
    const t = types.get(c.column_id);
    if (!t) continue; // a deleted column
    const v = fromStorage(t, c);
    if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (!byRow.has(c.row_id)) byRow.set(c.row_id, {});
    byRow.get(c.row_id)![c.column_id] = v;
  }
  return {
    cols: cols.map((c) => ({ id: c.column_id, name: c.column_name, type: c.data_type, ...(stampOf(c) ? { stamp: true } : {}) })),
    rows: rows.map((r) => ({ id: r.row_id, no: r.row_order, v: byRow.get(r.row_id) ?? {} })),
  };
}

export async function listRevisions(sheetId: string): Promise<RevMeta[]> {
  const rows = await q(`SELECT ${META_COLS} FROM SheetRevisions rv LEFT JOIN Users u ON u.user_id = rv.created_by WHERE rv.sheet_id = @s ORDER BY rv.rev_no DESC`, { s: T.uuid(sheetId) });
  return rows.map(toMeta);
}

/** One revision with the changes since the one before it; `revNo` null = the latest */
export async function getRevision(sheetId: string, revNo: number | null): Promise<{ meta: RevMeta; diff: RevDiff | null; formatDiff: FormatDiff | null; prevRevNo: number | null } | null> {
  const r = await q1(
    `SELECT TOP 1 ${META_COLS}, rv.diff_json, rv.format_diff_json, (SELECT MAX(p.rev_no) FROM SheetRevisions p WHERE p.sheet_id = rv.sheet_id AND p.rev_no < rv.rev_no) AS prev_no
     FROM SheetRevisions rv LEFT JOIN Users u ON u.user_id = rv.created_by
     WHERE rv.sheet_id = @s ${revNo === null ? '' : 'AND rv.rev_no = @n'} ORDER BY rv.rev_no DESC`,
    { s: T.uuid(sheetId), n: T.int(revNo ?? 0) },
  );
  if (!r) return null;
  return { meta: toMeta(r), diff: safeJson<RevDiff | null>(r.diff_json, null), formatDiff: safeJson<FormatDiff | null>(r.format_diff_json, null), prevRevNo: r.prev_no ?? null };
}

/** Exact changes since the latest revision (what the next one would contain) */
export async function pendingDiff(sheetId: string): Promise<{ base: RevMeta | null; diff: RevDiff | null; formatDiff: FormatDiff | null; docType: DocType }> {
  const docType = await sheetDocType(sheetId);
  const latest = await q1(`SELECT TOP 1 ${META_COLS}, rv.snapshot_json, rv.format_json FROM SheetRevisions rv LEFT JOIN Users u ON u.user_id = rv.created_by WHERE rv.sheet_id = @s ORDER BY rv.rev_no DESC`, { s: T.uuid(sheetId) });
  if (!latest) return { base: null, diff: null, formatDiff: null, docType };
  const prevFormat = safeJson<FormatSnap | null>(latest.format_json, null);
  const formatDiff = prevFormat ? diffFormats(prevFormat, await formatSnapshot(sheetId)) : null;
  // a form's data is not issued as revisions
  if (docType === 'record') return { base: toMeta(latest), diff: null, formatDiff, docType };
  const prev = safeJson<Snapshot>(latest.snapshot_json, { cols: [], rows: [] });
  return { base: toMeta(latest), diff: diffSnapshots(prev, await snapshotSheet(sheetId), await keyColumnIds(sheetId)), formatDiff, docType };
}

/** Number of format changes since the latest revision (null: that revision has no format kept yet) */
export async function pendingFormatCount(sheetId: string): Promise<number | null> {
  const latest = await q1(`SELECT TOP 1 format_json FROM SheetRevisions WHERE sheet_id = @s ORDER BY rev_no DESC`, { s: T.uuid(sheetId) });
  const prev = safeJson<FormatSnap | null>(latest?.format_json, null);
  return prev ? formatChangeCount(diffFormats(prev, await formatSnapshot(sheetId))) : null;
}

/** Quick count of rows touched since the latest revision (for a badge; the exact list is pendingDiff) */
export async function pendingCounts(sheetId: string, since: Date) {
  const r = await q1(
    `SELECT SUM(CASE WHEN is_deleted = 0 AND created_at > @t THEN 1 ELSE 0 END) AS added,
            SUM(CASE WHEN is_deleted = 0 AND created_at <= @t AND updated_at > @t THEN 1 ELSE 0 END) AS changed,
            SUM(CASE WHEN is_deleted = 1 AND created_at <= @t AND deleted_at > @t THEN 1 ELSE 0 END) AS removed
     FROM Rows WHERE sheet_id = @s`,
    { s: T.uuid(sheetId), t: T.dt(since) },
  );
  return { added: Number(r?.added ?? 0), changed: Number(r?.changed ?? 0), removed: Number(r?.removed ?? 0) };
}

/**
 * Freezes the sheet as the next revision. The first revision may start at any number (to continue an Excel file's REV.8),
 * later ones are always latest + 1. Refuses when nothing changed since the latest one.
 */
export async function createRevision(tx: Tx, sheetId: string, userId: string, note: string | null, firstNo: number | null) {
  await new sql.Request(tx).input('r', sql.NVarChar(200), `sheet-rev:${sheetId}`)
    .query(`DECLARE @x INT; EXEC @x = sp_getapplock @Resource = @r, @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 30000; IF @x < 0 THROW 50000, N'revision lock timeout', 1;`);
  const kind = (await sheetDocType(sheetId, tx)) === 'record' ? 'format' : 'data';
  const latest = await q1(`SELECT TOP 1 rev_no, snapshot_json, format_json FROM SheetRevisions WHERE sheet_id = @s ORDER BY rev_no DESC`, { s: T.uuid(sheetId) }, tx);
  const fmt = await formatSnapshot(sheetId, tx);
  const prevFmt = safeJson<FormatSnap | null>(latest?.format_json, null);
  const formatDiff = prevFmt ? diffFormats(prevFmt, fmt) : null;
  const fmtCount = formatDiff ? formatChangeCount(formatDiff) : 0;
  let snap: Snapshot;
  let diff: RevDiff | null = null;
  if (kind === 'format') {
    // a form: only its format is issued; the rows recorded with it stay out of the revision
    const n = await q1(`SELECT COUNT(*) AS n FROM Rows WHERE sheet_id = @s AND is_deleted = 0`, { s: T.uuid(sheetId) }, tx);
    snap = { cols: (await snapshotSheet(sheetId, tx)).cols, rows: [] };
    if (latest && prevFmt && !fmtCount) return { error: `รูปแบบไม่มีการเปลี่ยนแปลงจาก Rev.${latest.rev_no}` as const };
    snap = { ...snap, rows: [] };
    (snap as any).rowTotal = Number(n?.n ?? 0);
  } else {
    snap = await snapshotSheet(sheetId, tx);
    if (latest) {
      diff = diffSnapshots(safeJson<Snapshot>(latest.snapshot_json, { cols: [], rows: [] }), snap, await keyColumnIds(sheetId));
      const nothing = !diff.added.length && !diff.changed.length && !diff.removed.length && !diff.columns.added.length && !diff.columns.removed.length && !diff.columns.renamed.length;
      if (nothing && !fmtCount) return { error: `ไม่มีการเปลี่ยนแปลงจาก Rev.${latest.rev_no}` as const };
    }
  }
  const revNo = latest ? latest.rev_no + 1 : Math.max(0, firstNo ?? 1);
  await q(
    `INSERT INTO SheetRevisions (sheet_id, rev_no, note, row_count, added_count, changed_count, removed_count, snapshot_json, diff_json, created_by,
       kind, format_json, format_diff_json, format_changes)
     VALUES (@s, @n, @note, @rc, @a, @c, @r, @snap, @diff, @u, @k, @fj, @fd, @fc)`,
    {
      s: T.uuid(sheetId), n: T.int(revNo), note: T.text(note), rc: T.int(kind === 'format' ? (snap as any).rowTotal : snap.rows.length),
      a: T.int(diff?.added.length ?? 0), c: T.int(diff?.changed.length ?? 0), r: T.int(diff?.removed.length ?? 0),
      snap: T.text(JSON.stringify({ cols: snap.cols, rows: snap.rows })), diff: T.text(diff ? JSON.stringify(diff) : null), u: T.uuid(userId),
      k: kind, fj: T.text(JSON.stringify(fmt)), fd: T.text(formatDiff ? JSON.stringify(formatDiff) : null), fc: T.int(fmtCount),
    },
    tx,
  );
  return { revNo, rowCount: snap.rows.length, diff, formatDiff, kind };
}
