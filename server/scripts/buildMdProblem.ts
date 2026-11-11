/**
 * "MD Record Problem": the log of Metal Detector problems (form F3QCPP28 บันทึกการแก้ไขเครื่อง Metal Detector) as a sheet with drop-downs,
 * the rows of the company's Excel file, and a dashboard (filters for date / shift / type / machine / problem group / people, Pareto,
 * pie, per month / year / day, pivot tables, the records). Built through the API on a test database, then exported as the seed
 * database/seed/metal_detector_record_problem.sql (owner's request: the data ships with the seed):
 *
 *   set DOCHUB_URL=http://localhost:4000/api & set DOCHUB_USER=admin & set DOCHUB_PASSWORD=…
 *   npx ts-node --transpile-only scripts/buildMdProblem.ts --file "<F3QCPP28 … Metal Detector.xlsx>" [--dry]
 *   npx ts-node --transpile-only scripts/exportSeedSql.ts --file-id <id> --folder "DAILY METAL DETECTOR SENSITIVITY TEST REPORT" \
 *     --sub "MD Record Problem" --skip-names "บันทึกการแก้ไขเครื่อง Metal Detector (F3QCPP28)" --out ../database/seed/metal_detector_record_problem.sql
 *
 * Excel quirks handled: dates typed d/m on a computer that reads m/d (stored as 2026-03-11 for 3 Nov) are swapped back when that puts
 * them in the order of the log; dates kept as text ("30/10/26") are read d/m/y; machine numbers lose stray spaces; names in capitals
 * are written as Name.
 */
import crypto from 'crypto';
import * as XLSX from 'xlsx';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const FILE = arg('--file');
const DRY = process.argv.includes('--dry');
const BASE = process.env.DOCHUB_URL ?? 'http://localhost:4000/api';
const NAMES = { folder: 'DAILY METAL DETECTOR SENSITIVITY TEST REPORT', sub: 'MD Record Problem', file: 'บันทึกการแก้ไขเครื่อง Metal Detector (F3QCPP28)', sheet: 'บันทึกปัญหา', dashboard: 'MD Record Problem' };
const C = { date: 'วันที่', shift: 'กะ', type: 'MD Type', no: 'MD No.', group: 'กลุ่มปัญหา', detail: 'รายละเอียดปัญหา', fix: 'การแก้ไข', note: 'หมายเหตุ', by: 'บันทึกโดย', check: 'ตรวจสอบโดย' };

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
async function folder(name: string, parentId: string | null, color: string): Promise<string> {
  const tree: any[] = await api('GET', '/folders/tree');
  const hit = tree.find((f) => f.name === name && (f.parentId ?? null) === parentId);
  if (hit) return hit.id;
  return (await api('POST', '/folders', { name, parentId, color, description: parentId ? 'บันทึกปัญหา / การแก้ไขเครื่อง Metal Detector (F3QCPP28)' : undefined })).id;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const clean = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\r/g, '').trim());
const machine = (v: unknown) => clean(v).replace(/\s+/g, ' ').replace(/^(\d?[A-Z]+MD)\s*(\d+)$/i, (_, a, b) => `${a.toUpperCase()} ${b}`);
const person = (v: unknown) => { const s = clean(v); return /^[A-Z][A-Z .'-]+$/.test(s) ? s.toLowerCase().replace(/(^|[\s.'-])[a-z]/g, (m) => m.toUpperCase()) : s; };

type Rec = { rowNo: number; date: string | null; shift: string; type: string; no: string; group: string; detail: string; fix: string; note: string; by: string; check: string; dateNote?: string };

function readExcel(file: string) {
  const wb = XLSX.readFile(file, { cellDates: false });
  const ws = wb.Sheets['Form'];
  const data = wb.Sheets['Data'];
  if (!ws || !data) throw new Error('ไม่พบชีต Form / Data');
  const cell = (s: XLSX.WorkSheet, r: number, c: number) => s[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
  const val = (s: XLSX.WorkSheet, r: number, c: number) => cell(s, r, c)?.v;
  // lists of the drop-downs (sheet Data) + whatever the log uses
  const list = (col: number) => { const out: string[] = []; for (let r = 2; r <= 200; r++) { const v = clean(val(data, r, col)); if (v) out.push(v); } return out; };
  const shifts = list(1), types = list(2), machines = list(3).map(machine), groups = list(4);

  const recs: Rec[] = [];
  let maxSoFar = '';
  const today = new Date().toISOString().slice(0, 10);
  for (let r = 5; r <= 2000; r++) {
    const row = Array.from({ length: 10 }, (_, i) => val(ws, r, i + 1));
    if (row.every((x) => clean(x) === '')) continue;
    const raw = row[0];
    let date: string | null = null, dateNote: string | undefined;
    if (typeof raw === 'number') {
      const p = XLSX.SSF.parse_date_code(raw);
      date = iso(p.y, p.m, p.d);
      // typed d/m on a computer that reads m/d: swap back when that puts the date in the log's order (and not in the future)
      if (p.d <= 12 && maxSoFar && date < maxSoFar) {
        const swapped = iso(p.y, p.d, p.m);
        if (swapped >= maxSoFar && swapped <= today) { dateNote = `Excel: ${date} → ${swapped}`; date = swapped; }
      }
    } else if (raw) {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(clean(raw));
      if (m) date = iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
    }
    if (date && date > maxSoFar) maxSoFar = date;
    recs.push({
      rowNo: r, date, dateNote, shift: clean(row[1]).toUpperCase(), type: clean(row[2]), no: machine(row[3]), group: clean(row[4]),
      detail: clean(row[5]), fix: clean(row[6]), note: clean(row[7]), by: person(row[8]), check: person(row[9]),
    });
  }
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  return {
    recs,
    shifts: uniq([...shifts, ...recs.map((x) => x.shift)]),
    types: uniq([...types, ...recs.map((x) => x.type)]),
    machines: uniq([...machines, ...recs.map((x) => x.no)]).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    groups: uniq([...groups, ...recs.map((x) => x.group)]),
  };
}

const COLORS = ['#1552F0', '#DC2626', '#F59E0B', '#16A34A', '#7C3AED', '#0EA5E9', '#DB2777', '#64748B'];
const opts = (xs: string[], colors = true) => xs.map((v, i) => ({ value: v, label: v, ...(colors ? { color: COLORS[i % COLORS.length] } : {}) }));
const ds = (sheetId: string, x: string | null, extra: Record<string, unknown> = {}) => ({ sheetId, xColumnId: x, xBucket: 'none', series: [{ columnId: null, aggregation: 'count', label: 'จำนวนครั้ง' }], limit: 50, filters: [], ...extra });

async function main() {
  if (!FILE) throw new Error('ใส่ --file "<ไฟล์ Excel F3QCPP28>"');
  const x = readExcel(FILE);
  console.log(`อ่าน ${x.recs.length} แถว · กะ ${x.shifts.join('/')} · ประเภท ${x.types.join('/')} · เครื่อง ${x.machines.length} · กลุ่มปัญหา ${x.groups.length}`);
  for (const r of x.recs) if (r.dateNote || !r.date) console.log(`  ! แถว ${r.rowNo}: ${r.dateNote ?? 'วันที่อ่านไม่ได้'}`);
  if (DRY) return;

  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;
  const top = await folder(NAMES.folder, null, '#DC2626');
  const sub = await folder(NAMES.sub, top, '#F59E0B');
  const contents = await api('GET', `/folders/${sub}/contents`).catch(() => null);
  if (contents?.files?.some((f: any) => f.name === NAMES.file)) { console.log(`• "${NAMES.file}" มีอยู่แล้ว — หยุด`); return; }

  const columns = [
    { name: C.date, dataType: 'date', isRequired: true, width: 120 },
    { name: C.shift, dataType: 'select', isRequired: true, width: 80, options: opts(x.shifts), description: 'DS = กะเช้า · NS = กะดึก' },
    { name: C.type, dataType: 'select', isRequired: true, width: 120, options: opts(x.types) },
    { name: C.no, dataType: 'select', isRequired: true, width: 120, options: opts(x.machines, false) },
    { name: C.group, dataType: 'select', isRequired: true, width: 300, options: opts(x.groups) },
    { name: C.detail, dataType: 'text', width: 380 },
    { name: C.fix, dataType: 'text', width: 340 },
    { name: C.note, dataType: 'text', width: 200 },
    { name: C.by, dataType: 'varchar', width: 130 },
    { name: C.check, dataType: 'varchar', width: 130 },
  ];
  const { id: fileId } = await api('POST', '/files', { name: NAMES.file, folderId: sub, color: '#DC2626', description: 'บันทึกการแก้ไขเครื่อง Metal Detector (F3QCPP28) — นำเข้าจาก Excel', sheets: [{ name: NAMES.sheet, columns }] });
  const sheetId: string = (await api('GET', `/files/${fileId}`)).sheets[0].id;
  const col = new Map<string, string>((await api('GET', `/sheets/${sheetId}`)).columns.map((c: any) => [c.name, c.id]));
  const id = (n: string) => col.get(n)!;

  const rows = x.recs.map((r, i) => ({
    rowNo: i + 1,
    values: Object.fromEntries(Object.entries({
      [id(C.date)]: r.date, [id(C.shift)]: r.shift, [id(C.type)]: r.type, [id(C.no)]: r.no, [id(C.group)]: r.group,
      [id(C.detail)]: r.detail, [id(C.fix)]: r.fix, [id(C.note)]: r.note, [id(C.by)]: r.by, [id(C.check)]: r.check,
    }).filter(([, v]) => v !== null && v !== '')),
  }));
  const res = await api('POST', `/sheets/${sheetId}/rows/import`, { rows, skipInvalid: true });
  console.log(`✓ นำเข้า ${res.inserted} จาก ${rows.length} แถว`);
  for (const p of (res.errors ?? []).slice(0, 30)) console.log(`  ! แถว ${p.rowNo} ${p.columnName}: ${p.message}`);

  await api('PUT', `/files/${fileId}/doc-type`, { docType: 'record' });

  // ------------------------------------------------------------------ dashboard
  const W = 1280, M = 24, G = 12;
  const wid = () => crypto.randomUUID();
  let z = 1;
  const w = (type: string, title: string, x0: number, y: number, ww: number, h: number, dataSource: any, config: any = {}, style: any = { showTitle: true }) =>
    ({ id: wid(), type, title, x: x0, y, w: ww, h, z: z++, locked: false, dataSource, config, style });
  const chart = { legend: false, grid: true, labels: true, decimals: 0, colors: COLORS };
  const slicer = (title: string, c: string, x0: number, y: number, ww: number, mode: string, placeholder: string) =>
    w('slicer', '', x0, y, ww, 96, ds(sheetId, id(c)), { mode, multi: true, showLabel: true, placeholder, targets: [], label: title }, { showTitle: false });
  const widgets = [
    w('text', '', M, 16, W - 2 * M, 56, null, { text: 'MD RECORD PROBLEM — สรุปปัญหาเครื่อง Metal Detector', fontSize: 24, fontWeight: 700, align: 'left', color: '#DC2626', valign: 'middle' },
      { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 4 }),
    // filters: every chart below follows them
    slicer('วันที่', C.date, M, 84, 280, 'date', 'ช่วงวันที่'),
    slicer('กะ', C.shift, M + 292, 84, 140, 'chips', 'กะ'),
    slicer('MD Type', C.type, M + 444, 84, 240, 'chips', 'ประเภท'),
    slicer('MD No.', C.no, M + 696, 84, 250, 'dropdown_search', 'เลือกเครื่อง'),
    slicer('กลุ่มปัญหา', C.group, M + 958, 84, 274, 'dropdown_search', 'เลือกกลุ่มปัญหา'),
    slicer('บันทึกโดย', C.by, M, 192, 270, 'dropdown_search', 'ผู้บันทึก'),
    slicer('ตรวจสอบโดย', C.check, M + 282, 192, 270, 'dropdown_search', 'ผู้ตรวจสอบ'),
    w('kpi', 'จำนวนปัญหาทั้งหมด (ครั้ง)', M + 564, 192, 215, 110, ds(sheetId, null), { decimals: 0, color: '#DC2626', prefix: '', suffix: '' }),
    w('kpi', 'จำนวนเครื่องที่มีปัญหา', M + 791, 192, 215, 110, { ...ds(sheetId, null), series: [{ columnId: id(C.no), aggregation: 'count_distinct', label: 'เครื่อง' }] }, { decimals: 0, color: '#1552F0', prefix: '', suffix: '' }),
    w('kpi', 'จำนวนวันที่เกิดปัญหา', M + 1018, 192, 214, 110, { ...ds(sheetId, null), series: [{ columnId: id(C.date), aggregation: 'count_distinct', label: 'วัน' }] }, { decimals: 0, color: '#F59E0B', prefix: '', suffix: '' }),
    // Pareto + pie
    w('pareto', 'Pareto: เครื่องไหนเกิดปัญหามากที่สุด (MD No.)', M, 316, 800, 340, ds(sheetId, id(C.no), { sort: 'value_desc' }), { ...chart, legend: true }),
    w('pie', 'สัดส่วนตามกลุ่มปัญหา', M + 812, 316, 420, 340, ds(sheetId, id(C.group), { sort: 'value_desc' }), { ...chart, legend: true }),
    w('pareto', 'Pareto: กลุ่มปัญหา', M, 668, 610, 340, ds(sheetId, id(C.group), { sort: 'value_desc' }), { ...chart, legend: true }),
    w('pie', 'สัดส่วนตามกะ', M + 622, 668, 300, 340, ds(sheetId, id(C.shift), { sort: 'value_desc' }), { ...chart, legend: true }),
    w('doughnut', 'สัดส่วนตาม MD Type', M + 934, 668, 298, 340, ds(sheetId, id(C.type), { sort: 'value_desc' }), { ...chart, legend: true }),
    w('bar', 'จำนวนปัญหารายเดือน (แยกกลุ่มปัญหา)', M, 1020, 610, 340, ds(sheetId, id(C.date), { xBucket: 'month', sort: 'x_asc', limit: 60, groupByColumnId: id(C.group) }), { ...chart, legend: true, labels: false, stacked: true }),
    w('bar', 'จำนวนปัญหารายปี', M + 622, 1020, 300, 340, ds(sheetId, id(C.date), { xBucket: 'year', sort: 'x_asc' }), chart),
    w('pareto', 'Pareto: กะ', M + 934, 1020, 298, 340, ds(sheetId, id(C.shift), { sort: 'value_desc' }), { ...chart, legend: true }),
    w('bar', 'จำนวนปัญหาต่อวัน', M, 1372, W - 2 * M, 300, ds(sheetId, id(C.date), { xBucket: 'day', sort: 'x_asc', limit: 400 }), { ...chart, labels: false }),
    w('table', 'สรุปเครื่อง × กลุ่มปัญหา (คลิกหัวคอลัมน์เพื่อเรียง)', M, 1684, 760, 420, ds(sheetId, id(C.no), { sort: 'value_desc', groupByColumnId: id(C.group) }), { decimals: 0, categoryLabel: 'MD No.' }),
    w('table', 'สรุปตามผู้บันทึก', M + 772, 1684, 460, 200, ds(sheetId, id(C.by), { sort: 'value_desc' }), { decimals: 0, categoryLabel: 'บันทึกโดย' }),
    w('table', 'สรุปรายเดือน', M + 772, 1896, 460, 208, ds(sheetId, id(C.date), { xBucket: 'month', sort: 'x_desc', groupByColumnId: id(C.type) }), { decimals: 0, categoryLabel: 'เดือน' }),
    w('records', 'รายละเอียดปัญหาทั้งหมด (ค้นหาได้ทุกช่อง)', M, 2116, W - 2 * M, 720, ds(sheetId, null),
      { searchColumnIds: [], titleColumnIds: [id(C.no), id(C.date), id(C.group)], fieldColumnIds: [], fieldColumnsAll: true, imageColumnId: null, pageSize: 30, placeholder: 'ค้นหา เครื่อง / ปัญหา / ชื่อ / Code …', showRev: false, fontSize: 13 }),
  ];
  const dash = await api('POST', `/files/${fileId}/dashboards`, { name: NAMES.dashboard });
  await api('PUT', `/dashboards/${dash.id}`, { name: NAMES.dashboard, canvas: { width: W, height: 2860, gridSize: 8, snap: true }, background: { color: '#F4F6FB', imageUrl: null, fit: 'cover' }, widgets });
  console.log(`✓ ${NAMES.file} (file ${fileId}) · แดชบอร์ด ${dash.id} (${widgets.length} วิดเจ็ต)`);
}

if (require.main === module) main().catch((e) => { console.error('✗', e.message); process.exit(1); });
