/**
 * Creates the InkCode folder in a running DocHUB and fills it from the Excel files.
 *
 *   1) python3 ../scripts/inkcode/extract.py "<Master_Database.xlsx>" [password]     (once; the JSON is already in the repo)
 *   2) npx ts-node --transpile-only scripts/seedInkCode.ts
 *        env: DOCHUB_URL=http://172.48.0.116:4000/api  DOCHUB_USER=<admin or master>  DOCHUB_PASSWORD=...
 *        add  --dry   to only print what would be created
 *
 * It talks to the normal HTTP API (same validation / permissions / audit as the screens), so it needs no SQL access.
 * Nothing is deleted or overwritten: if a file of the same name already exists in the folder it is skipped.
 */
import fs from 'fs';
import path from 'path';
import { ColDef, DB_FORMULAS, DB_KEY_MAP, DB_PLAIN, dbPreviewFormulas, HELP_COLUMNS, HELP_ROWS, printTemplate, printTemplateByCustomer, REF_SHEETS, SAMPLE_ROW, SHEETS, SheetDef, WS_INPUTS, worksheetFormulas } from '../src/modules/inkcode/model';

const BASE = (process.env.DOCHUB_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');
const DRY = process.argv.includes('--dry');
const DATA = path.resolve(__dirname, '../../scripts/inkcode/data');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

let token = '';
async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429 && attempt < 5) { await new Promise((s) => setTimeout(s, 3000 * (attempt + 1))); continue; }
    if (!r.ok || j.success === false) throw new Error(`${method} ${url} → ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
    return j.data as T;
  }
}

/** `refs`: sheet name → { id, columns by name } of the sheets already created (needed by drop-down columns) */
type Refs = Map<string, { id: string; cols: Map<string, string> }>;
const colInput = (c: ColDef, refs?: Refs) => {
  const body: Record<string, unknown> = { name: c.name, dataType: c.type, width: c.width ?? 160, isRequired: !!c.required };
  if (c.description) body.description = c.description;
  if (c.lookup) {
    const src = refs?.get(c.lookup.sheet);
    const colId = src?.cols.get(c.lookup.column);
    if (!src || !colId) throw new Error(`ไม่พบชีต/คอลัมน์ต้นทางของรายการเลือก "${c.name}" (${c.lookup.sheet} › ${c.lookup.column})`);
    body.validation = { lookup: { sheetId: src.id, columnId: colId } };
  }
  return body;
};
type SheetInfo = { id: string; name: string };

async function findOrCreateFolder(name: string): Promise<string> {
  if (DRY) { console.log(`[dry] โฟลเดอร์ "${name}"`); return 'dry-folder'; }
  const tree: any[] = await api('GET', '/folders/tree');
  const hit = tree.find((f) => f.name === name && !f.parentId);
  if (hit) { console.log(`• โฟลเดอร์ "${name}" มีอยู่แล้ว — ใช้ต่อ`); return hit.id; }
  const f = await api('POST', '/folders', { name, description: 'ระบบออกโค้ด Ink (ใบออกโค้ดนอกแผน)', color: '#1552F0' });
  console.log(`✓ สร้างโฟลเดอร์ "${name}"`);
  return f.id;
}
async function createFile(folderId: string, name: string, sheets: SheetDef[], refs?: Refs): Promise<{ id: string; sheets: SheetInfo[] } | null> {
  if (!DRY) {
    const c = await api('GET', `/folders/${folderId}/contents`).catch(() => null);
    if (c?.files?.some((f: any) => f.name === name)) { console.log(`• ไฟล์ "${name}" มีอยู่แล้ว — ข้าม (ไม่เขียนทับ)`); return null; }
  }
  console.log(`${DRY ? '[dry] ' : '✓ '}สร้างไฟล์ "${name}" (${sheets.map((s) => `${s.name}:${s.columns.length} คอลัมน์`).join(', ')})`);
  if (DRY) return null;
  const { id } = await api('POST', '/files', { name, folderId, color: '#1552F0', sheets: sheets.map((s) => ({ name: s.name, columns: s.columns.map((c) => colInput(c, refs)) })) });
  const f = await api('GET', `/files/${id}`);
  return { id, sheets: f.sheets.map((s: any) => ({ id: s.id, name: s.name })) };
}
const idOf = (sheets: SheetInfo[], name: string) => sheets.find((s) => s.name === name)!.id;
async function colMap(sheetId: string): Promise<Map<string, string>> {
  const d = await api('GET', `/sheets/${sheetId}`);
  return new Map<string, string>(d.columns.map((c: any) => [c.name, c.id]));
}
async function importRows(sheetId: string, rows: Record<string, unknown>[], label: string) {
  const cols = await colMap(sheetId);
  let n = 0, bad = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r, k) => ({ rowNo: i + k + 1, values: Object.fromEntries(Object.entries(r).filter(([k2, v]) => v !== null && v !== undefined && cols.has(k2)).map(([k2, v]) => [cols.get(k2)!, v])) }));
    const res = await api('POST', `/sheets/${sheetId}/rows/import`, { rows: batch, skipInvalid: true });
    n += res.inserted ?? res.imported ?? batch.length; bad += (res.errors?.length ?? 0);
    process.stdout.write(`\r  ${label}: ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  console.log(`\r  ${label}: นำเข้า ${rows.length} แถว${bad ? ` (มีปัญหา ${bad} เซลล์ — ดูรายงานด้านล่าง)` : ''}`);
}
async function addFormulas(sheetId: string, defs: ColDef[], ids: Map<string, string>) {
  for (const d of defs) {
    const body = { ...colInput(d), validation: { formula: { expr: d.formula!.expr, sources: d.formula!.sources.map((s) => ({ alias: s.alias, sheetId: ids.get(s.sheet)! })) } } };
    await api('POST', `/sheets/${sheetId}/columns`, body);
    console.log(`  + สูตร "${d.name}"`);
  }
}

async function main() {
  if (!fs.existsSync(path.join(DATA, 'products.json'))) throw new Error('ไม่พบ scripts/inkcode/data/products.json — รัน extract.py ก่อน');
  const ref = read('ref.json'); const products: Record<string, any>[] = read('products.json'); const tokens = Object.keys(read('tokens.json').tokens);
  if (!DRY) {
    const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
    if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
    token = (await api('POST', '/auth/login', { username: user, password })).accessToken;
  }
  const folder = await findOrCreateFolder('InkCode');

  const refs: Refs = new Map();
  const remember = async (name: string, id: string) => { sheetIds.set(name, id); refs.set(name, { id, cols: await colMap(id) }); };
  const sheetIds = new Map<string, string>();
  // 1) reference tables (+ the sample date / line used to preview the codes in the database)
  const refFile = await createFile(folder, 'InkCode - รหัสอ้างอิง', REF_SHEETS);
  if (refFile) {
    const sets: [string, Record<string, unknown>[]][] = [[SHEETS.year, ref.years], [SHEETS.month, ref.months], [SHEETS.day, ref.days], [SHEETS.line, ref.lines], [SHEETS.shift, ref.shifts], [SHEETS.sample, [SAMPLE_ROW]], [SHEETS.calendar, ref.calendar]];
    for (const [name, rows] of sets) { await remember(name, idOf(refFile.sheets, name)); await importRows(idOf(refFile.sheets, name), rows, name); }
  }
  // 2) database (+ help sheet + preview columns that show the real codes for the sample date / line)
  const dbFile = await createFile(folder, 'InkCode - Master Database', [{ name: SHEETS.db, columns: DB_PLAIN }, { name: SHEETS.help, columns: HELP_COLUMNS }]);
  if (dbFile) {
    const dbId = idOf(dbFile.sheets, SHEETS.db); await remember(SHEETS.db, dbId);
    const rows = products.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [DB_KEY_MAP[k] ?? k, v])));
    await importRows(dbId, rows, SHEETS.db);
    await importRows(idOf(dbFile.sheets, SHEETS.help), HELP_ROWS, SHEETS.help);
    await addFormulas(dbId, [...DB_FORMULAS, ...dbPreviewFormulas(tokens)], sheetIds);
  }
  // 3) daily worksheet + print form
  if (refFile && dbFile) {
    const wsFile = await createFile(folder, 'InkCode - ใบออกโค้ดนอกแผน', [{ name: SHEETS.ws, columns: WS_INPUTS }], refs);
    if (wsFile) {
      const wsId = idOf(wsFile.sheets, SHEETS.ws);
      await addFormulas(wsId, worksheetFormulas(tokens), sheetIds);
      await api('PUT', `/files/${wsFile.id}/pdf-templates`, { templates: [printTemplate(wsId), printTemplateByCustomer(wsId)] });
      console.log('  + รูปแบบ PDF "ใบออกโค้ดนอกแผน 4 ส่วน" และ "แยกตามลูกค้า"');
    }
  } else if (!DRY) console.log('• ข้ามไฟล์ใบออกโค้ดนอกแผน เพราะไฟล์รหัสอ้างอิง/Master Database มีอยู่เดิม — ลบแล้วรันใหม่ถ้าต้องการสร้างทั้งชุด');

  const review: any[] = read('needs_review.json');
  console.log(`\nเสร็จ. ผลิตภัณฑ์ ${products.length} แถว · แถวที่แปลงสูตรโค้ดอัตโนมัติไม่ได้ ${review.length} แถว (ดูคอลัมน์ "สูตรเดิมที่ต้องตรวจ" ใน InkCode - Master Database)`);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
