// Excel รายงานควบคุมเวลาการผลิต ตามแบบฟอร์ม F3PFPV04 (ไฟล์ต้นฉบับ src/assets/templates/F3PFPV04.xlsx)
// เปิดไฟล์ต้นฉบับแล้วเติมค่าลงเซลล์โดยตรง (แก้ XML ในไฟล์) — รูปแบบ เส้น โลโก้ ขนาดหน้ากระดาษคงเดิมทุกอย่าง
// 1 หน้า = 17 แถว (แถว 11–27) · เกิน 17 แถว = เพิ่มชีต "F3PFPV04 (หน้า n)" ทีละหน้า
// @ts-nocheck — ported from DelayHUB (frontend/src/component/Pack/ReportRawmatNotEditTIME/Asset/delayReportExcel.js) so the file is the same.
// The blank form F3PFPV04.xlsx is DelayHUB's: the DocHUB server fetches it from DelayHUB (GET /api/delay-report/template.xlsx); the values of
// every line were computed by DelayHUB and come from the sheet (./lines.ts → DelayLine).
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { http } from '@/api/client';
import type { DelayLine } from './lines';

const FIRST_ROW = 11;
const ROWS_PER_PAGE = 17;
const BATCH_COLS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const p2 = (n) => String(n).padStart(2, '0');
const toDate = (v) => { if (!v || v === '-') return null; const d = new Date(String(v).replace(' ', 'T')); return Number.isNaN(d.getTime()) ? null : d; };
const fmtDT = (v) => { const d = toDate(v); return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${String(d.getFullYear() + 543).slice(-2)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : ''; };
const fmtD = (v) => { const d = toDate(v); return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear() + 543}` : ''; };
const hours = (min) => (min === null || min === undefined || Number.isNaN(min) ? '' : Math.round((min / 60) * 100) / 100);

const colNo = (ref) => ref.replace(/\d+$/, '').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/** set (or create) cell `ref` in the sheet XML keeping its style; value '' clears it */
const setCell = (xml, ref, value) => {
  const rowNo = ref.replace(/^[A-Z]+/, '');
  const cellRe = new RegExp(`<c r="${ref}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(cellRe);
  const attrs = m ? m[1].replace(/\s+t="[^"]*"/, '') : '';
  let cell;
  if (value === '' || value === null || value === undefined) cell = `<c r="${ref}"${attrs}/>`;
  else if (typeof value === 'number') cell = `<c r="${ref}"${attrs}><v>${value}</v></c>`;
  else cell = `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  if (m) return xml.replace(cellRe, cell);
  // the cell does not exist yet: insert it in column order (Excel repairs the file when cells are out of order)
  const rowRe = new RegExp(`(<row r="${rowNo}"[^>]*>)([\\s\\S]*?)(</row>)`);
  const want = colNo(ref);
  return xml.replace(rowRe, (all, open, body, close) => {
    const cells = [...body.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];
    const after = cells.find((c) => colNo(c[1]) > want);
    if (!after) return `${open}${body}${cell}${close}`;
    return `${open}${body.slice(0, after.index)}${cell}${body.slice(after.index)}${close}`;
  });
};

/** 1 line of the form (values already computed by DelayHUB) */
const lineOf = (row: DelayLine) => ({
  A: row.production ?? '',
  B: row.mat_name ?? '',
  batch: String(row.batch ?? '').split(',')[0].trim(),
  M: row.weight === null || row.weight === undefined || row.weight === '' ? '' : Number(row.weight),
  N: row.group_no ?? '',
  O: fmtD(row.prep_date ?? row.time_a),
  P: row.hist ?? '',
  Q: row.color ?? '',
  R: row.odor ?? '',
  S: row.texture ?? '',
  T: fmtDT(row.time_a), U: fmtDT(row.time_b), V: fmtDT(row.time_c), W: fmtDT(row.time_d), X: fmtDT(row.time_e), Y: fmtDT(row.time_f),
  Z: hours(row.dbs1_h === null || row.dbs1_h === undefined ? null : row.dbs1_h * 60),
  AA: hours(row.dbs2_h === null || row.dbs2_h === undefined ? null : row.dbs2_h * 60),
  AB: hours(row.dbs3_h === null || row.dbs3_h === undefined ? null : row.dbs3_h * 60),
  AC: hours(row.dbs4_h === null || row.dbs4_h === undefined ? null : row.dbs4_h * 60),
  AD: row.remark ?? '',
});

const fillSheet = (xml, rows, meta, page, pages) => {
  let s = xml;
  s = setCell(s, 'A4', `Date: ${meta.exportDate || '................'}   Shift: ${meta.exportShift || '........'}   Line: ${meta.exportLine || '................'}`);
  s = setCell(s, 'T4', `Plant: ${meta.exportPlant || '................'}`);
  s = setCell(s, 'AD4', `Page ${page} / ${pages}`);
  for (let i = 0; i < ROWS_PER_PAGE; i += 1) {
    const r = FIRST_ROW + i;
    const v = rows[i] ? lineOf(rows[i]) : null;
    ['A', 'B', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD'].forEach((col) => { s = setCell(s, `${col}${r}`, v ? v[col] : ''); });
    BATCH_COLS.forEach((col, k) => { s = setCell(s, `${col}${r}`, v ? (v.batch[k] || '') : ''); });
  }
  if (meta.recordedBy) s = setCell(s, 'B35', meta.recordedBy);
  if (meta.reviewedBy) s = setCell(s, 'S35', meta.reviewedBy);
  if (meta.qcManager) s = setCell(s, 'AA35', meta.qcManager);
  return s;
};

/**
 * rows: แถวที่จะออกรายงาน (เรียงตามต้องการแล้ว) · meta: { exportDate, exportShift, exportLine, exportPlant, recordedBy, reviewedBy, qcManager }
 * ดาวน์โหลดไฟล์ .xlsx ทันที
 */
export const exportDelayReportExcel = async (rows: DelayLine[], meta: Record<string, string> = {}) => {
  const buf = new Uint8Array(await http.get('/delay-report/template.xlsx', { responseType: 'arraybuffer' }).then((r) => r.data as ArrayBuffer));
  const files = unzipSync(buf);
  const read = (p) => strFromU8(files[p]);
  const write = (p, t) => { files[p] = strToU8(t); };

  const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const baseSheet = read('xl/worksheets/sheet1.xml');
  const baseSheetRels = read('xl/worksheets/_rels/sheet1.xml.rels');
  const baseDrawing = files['xl/drawings/drawing1.xml'];
  const baseDrawingRels = files['xl/drawings/_rels/drawing1.xml.rels'];

  write('xl/worksheets/sheet1.xml', fillSheet(baseSheet, rows.slice(0, ROWS_PER_PAGE), meta, 1, pages));

  let workbook = read('xl/workbook.xml');
  let wbRels = read('xl/_rels/workbook.xml.rels');
  let types = read('[Content_Types].xml');
  const usedSheetIds = [...workbook.matchAll(/sheetId="(\d+)"/g)].map((x) => Number(x[1]));
  let nextSheetId = Math.max(...usedSheetIds) + 1;
  const extraSheets = [];
  for (let p = 2; p <= pages; p += 1) {
    const sheetFile = `sheet${100 + p}.xml`;
    const drawingFile = `drawing${100 + p}.xml`;
    const rid = `rIdP${p}`;
    write(`xl/worksheets/${sheetFile}`, fillSheet(baseSheet, rows.slice((p - 1) * ROWS_PER_PAGE, p * ROWS_PER_PAGE), meta, p, pages));
    write(`xl/worksheets/_rels/${sheetFile}.rels`, baseSheetRels.replace('../drawings/drawing1.xml', `../drawings/${drawingFile}`));
    files[`xl/drawings/${drawingFile}`] = baseDrawing;
    files[`xl/drawings/_rels/${drawingFile}.rels`] = baseDrawingRels;
    wbRels = wbRels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheetFile}"/></Relationships>`);
    types = types.replace('</Types>', `<Override PartName="/xl/worksheets/${sheetFile}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/${drawingFile}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    extraSheets.push(`<sheet name="F3PFPV04 (หน้า ${p})" sheetId="${nextSheetId}" r:id="${rid}"/>`);
    nextSheetId += 1;
  }
  if (extraSheets.length) {
    // ชีตหน้าถัดไปต่อจากชีตแรก (ก่อนชีตตาราง Delay อ้างอิง)
    workbook = workbook.replace(/(<sheet name="F3PFPV04 \(2\)"[^>]*\/>)/, `$1${extraSheets.join('')}`);
    workbook = workbook.replace(/localSheetId="(\d+)"/g, (all, n) => (Number(n) > 0 ? `localSheetId="${Number(n) + extraSheets.length}"` : all));
  }
  workbook = workbook.replace(/<sheet name="F3PFPV04 \(2\)"/, '<sheet name="F3PFPV04 (หน้า 1)"').replace(/'F3PFPV04 \(2\)'!/g, "'F3PFPV04 (หน้า 1)'!");
  write('xl/workbook.xml', workbook);
  write('xl/_rels/workbook.xml.rels', wbRels);
  write('[Content_Types].xml', types);
  // app.xml keeps a list of sheet names: Excel rebuilds it, an out-of-date list only confuses some viewers
  delete files['docProps/app.xml'];
  types = read('[Content_Types].xml').replace(/<Override PartName="\/docProps\/app\.xml"[^>]*\/>/, '');
  write('[Content_Types].xml', types);
  files['_rels/.rels'] = strToU8(read('_rels/.rels').replace(/<Relationship[^>]*docProps\/app\.xml"[^>]*\/>/, ''));

  const out = zipSync(files, { level: 6 });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `F3PFPV04_${meta.exportDate || new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};
