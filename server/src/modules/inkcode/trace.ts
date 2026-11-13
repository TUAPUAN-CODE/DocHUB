import { idList, jsonParam, q, T } from '../../config/db';
import type { AuthUser } from '../../middleware/auth';
import { badRequest, likeEscape } from '../../shared/http';
import { LV, PermCtx } from '../../shared/permissions';

/**
 * Trace back from a printed ink code: the text read off a product (any part of a code line, spaces ignored) → the day-sheet rows
 * whose "Code Format แถว 1-4" contain it (date · line · shift · document · market), and for each one what the plan said about that
 * run (record file of the plan drop: Rev., block, notes, quantity, other documents) and its raw-material rows (Rawmat, Material, Spec …).
 * Only files the user can read are used.
 */
const CODE_COLS = [1, 2, 3, 4].map((n) => `Code Format แถว ${n}`);
const ROW_COLS = ['วันที่ผลิต', 'เวลาเริ่ม', 'ไลน์', 'กะ', 'รหัสเอกสาร', 'Market', 'ลูกค้า', 'ชนิด', 'Product Code SAP', 'Remark (ไม่ Ink)', ...CODE_COLS];

type Vals = Record<string, string | number | null>;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));

/** values of rows by column name (text, numbers and dates) */
async function rowValues(rowIds: string[]): Promise<Map<string, Vals>> {
  const out = new Map<string, Vals>();
  if (!rowIds.length) return out;
  for (const r of await q(`
    SELECT c.row_id, cc.column_name, cc.display_order, c.value_text, c.value_int, c.value_float, c.value_date
    FROM Cells c JOIN Columns cc ON cc.column_id = c.column_id AND cc.is_deleted = 0
    WHERE c.row_id IN ${idList('@r')} ORDER BY cc.display_order`, { r: jsonParam(rowIds) })) {
    const k = String(r.row_id).toLowerCase();
    const v = out.get(k) ?? {};
    v[r.column_name] = r.value_text ?? r.value_float ?? r.value_int ?? (r.value_date ? iso(r.value_date) : null);
    out.set(k, v);
  }
  return out;
}
/** rows of a sheet (by name, in one file) whose text cells equal the given values */
async function rowsWhere(fileId: string, sheetName: string, eq: Record<string, string>): Promise<string[]> {
  const keys = Object.entries(eq).filter(([, v]) => v);
  const rows = await q(`
    SELECT r.row_id FROM Sheets s JOIN Rows r ON r.sheet_id = s.sheet_id AND r.is_deleted = 0
    WHERE s.file_id = @f AND s.sheet_name = @n AND s.is_deleted = 0
      AND (SELECT COUNT(*) FROM OPENJSON(@eq) WITH (k NVARCHAR(200) '$[0]', v NVARCHAR(400) '$[1]') e
           JOIN Columns cc ON cc.sheet_id = s.sheet_id AND cc.is_deleted = 0 AND cc.column_name = e.k
           JOIN Cells c ON c.row_id = r.row_id AND c.column_id = cc.column_id AND LTRIM(RTRIM(c.value_text)) = e.v) = @n2
    ORDER BY r.row_order`, { f: T.uuid(fileId), n: sheetName, eq: JSON.stringify(keys), n2: keys.length });
  return rows.map((r: any) => String(r.row_id).toLowerCase());
}

export async function traceCode(user: AuthUser, text: string) {
  const needle = text.replace(/\s+/g, '').slice(0, 60);
  if (needle.length < 3) throw badRequest('พิมพ์โค้ดอย่างน้อย 3 ตัวอักษร');
  const ctx = await PermCtx.load(user);
  const hits = await q(`
    SELECT TOP 60 r.row_id, s.sheet_id, s.sheet_name, f.file_id, f.file_name, f.folder_id, f.created_by, MAX(cc.column_name) AS code_col
    FROM Cells c
    JOIN Columns cc ON cc.column_id = c.column_id AND cc.is_deleted = 0 AND cc.column_name IN (SELECT [value] FROM OPENJSON(@cols))
    JOIN Rows r ON r.row_id = c.row_id AND r.is_deleted = 0
    JOIN Sheets s ON s.sheet_id = r.sheet_id AND s.is_deleted = 0 AND s.union_config IS NULL
    JOIN Files f ON f.file_id = s.file_id AND f.is_deleted = 0
    WHERE REPLACE(c.value_text, ' ', '') LIKE @like
    GROUP BY r.row_id, s.sheet_id, s.sheet_name, f.file_id, f.file_name, f.folder_id, f.created_by, r.row_order
    ORDER BY f.file_name DESC, r.row_order`, { cols: JSON.stringify(CODE_COLS), like: `%${likeEscape(needle)}%` });
  const readable = hits.filter((h: any) => ctx.fileLevel(h) >= LV.read);
  const vals = await rowValues(readable.map((h: any) => h.row_id));

  // record files of plan drops (sheet "ผลนำเข้า" + "วัตถุดิบ"), newest first, that the user can read
  const records = (await q(`
    SELECT f.file_id, f.file_name, f.folder_id, f.created_by, f.created_at FROM Files f
    WHERE f.is_deleted = 0 AND EXISTS (SELECT 1 FROM Sheets s WHERE s.file_id = f.file_id AND s.is_deleted = 0 AND s.sheet_name = N'ผลนำเข้า')
      AND f.file_name LIKE N'แผน %'
    ORDER BY f.created_at DESC`)).filter((f: any) => ctx.fileLevel(f) >= LV.read);

  const results: { fileId: string; fileName: string; sheetId: string; sheetName: string; rowId: string; row: Vals; plan: { fileId: string; fileName: string; item: Vals | null; materials: Vals[] } | null }[] = [];
  for (const h of readable) {
    const v = vals.get(String(h.row_id).toLowerCase()) ?? {};
    const row: Vals = Object.fromEntries(ROW_COLS.map((n) => [n, v[n] ?? null]));
    const date = iso(row['วันที่ผลิต']);
    let plan: { fileId: string; fileName: string; item: Vals | null; materials: Vals[] } | null = null;
    // the latest plan record of that day with this run (date + document + country + line)
    for (const rf of records.filter((f: any) => String(f.file_name).startsWith(`แผน ${date}`))) {
      const ids = await rowsWhere(rf.file_id, 'ผลนำเข้า', { วันที่ผลิต: date, 'Doc.No': String(row['รหัสเอกสาร'] ?? ''), ไลน์: String(row['ไลน์'] ?? '') });
      if (!ids.length) continue;
      const items = await rowValues(ids);
      const market = String(row.Market ?? '').trim().toLowerCase();
      // same country, and the same start time when the day row has one (a product can run twice on a line in a day)
      const time = String(row['เวลาเริ่ม'] ?? '').trim();
      const cands = [...items.values()].filter((x) => String(x['ประเทศ'] ?? '').trim().toLowerCase() === market);
      const item = (time ? cands.find((x) => String(x['เวลา'] ?? '').trim() === time) : null) ?? cands[0] ?? [...items.values()][0] ?? null;
      const mids = await rowsWhere(rf.file_id, 'วัตถุดิบ', { วันที่ผลิต: date, 'Doc.No (รายการ)': String(row['รหัสเอกสาร'] ?? ''), ไลน์: String(row['ไลน์'] ?? ''), เวลา: String(item?.['เวลา'] ?? ''), ประเทศ: String(item?.['ประเทศ'] ?? '') });
      const mats = await rowValues(mids);
      plan = { fileId: rf.file_id, fileName: rf.file_name, item, materials: mids.map((id) => mats.get(id) ?? {}) };
      break;
    }
    results.push({ fileId: h.file_id, fileName: h.file_name, sheetId: h.sheet_id, sheetName: h.sheet_name, rowId: h.row_id, row, plan });
  }
  return { q: text, total: results.length, truncated: hits.length >= 60, results };
}
