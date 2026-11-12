/**
 * Folder "Bone": the bone check after hand sorting (form F3QCPF51, sheet "หลังคัดมือ" of the company's Excel) as an easy-to-fill sheet,
 * and the "Anatomy-Manual" presentation as a dashboard (picture of the fish with the count of each bone part, trends of bones found vs
 * carts by shift DS / NS, per day / month, pivot tables). Built through the API on a test database, then shipped as two seeds:
 *
 *   set DOCHUB_URL=http://localhost:4000/api & set DOCHUB_USER=admin & set DOCHUB_PASSWORD=…
 *   npx ts-node --transpile-only scripts/buildBone.ts --picture "<fish anatomy picture>"            → folder, file, columns, dashboard
 *   npx ts-node --transpile-only scripts/exportSeedSql.ts --file-id <id> --folder "Bone" --sub "" --no-history \
 *     --skip-names "ตรวจก้างหลังคัดมือ (F3QCPF51)" --out ../database/seed/bone_f3qcpf51.sql                → structure seed (no rows)
 *   npx ts-node --transpile-only scripts/buildBone.ts --file "<F3QCPF51 … .xlsx>" --data-sql ../database/seed/bone_f3qcpf51_data.sql
 *                                                                                                    → the old rows as a compact seed
 *
 * The Excel keeps each bone part in two columns (count + "Rec." = found again on re-check); the Excel totals add them up
 * (M0: SUM(K:L)), so the sheet has ONE count per part (the sum). Rows without a date are skipped.
 * pcs/100kg = bones × 100 / (carts × 0.5) as in the Excel (Trans Manual) → per cart: ก้าง/100kg = รวมก้าง × 200.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as XLSX from 'xlsx';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const BASE = process.env.DOCHUB_URL ?? 'http://localhost:4000/api';
const NAMES = { folder: 'Bone', file: 'ตรวจก้างหลังคัดมือ (F3QCPF51)', sheet: 'หลังคัดมือ', dashboard: 'Anatomy-Manual' };

/** the bone parts: column name, Excel columns (count, Rec.), picture label, max allowed per cart (Excel "Max") */
const PARTS = [
  { key: 'n1', name: 'No.1 ก้างเข็มหมุด', xl: ['K', 'L'], max: 0 },
  { key: 'n2a', name: 'No.2 ก้างข้างลำตัว <1 cm', xl: ['AA', 'AB'], max: 0 },
  { key: 'n2b', name: 'No.2 ก้างข้างลำตัว 1-2 cm', xl: ['AC', 'AD'], max: 1 },
  { key: 'n2c', name: 'No.2 ก้างข้างลำตัว >2 cm', xl: ['AE', 'AF'], max: 0 },
  { key: 'n3a', name: 'No.3 ก้างท้อง <1 cm', xl: ['AG', 'AH'], max: 9 },
  { key: 'n3b', name: 'No.3 ก้างท้อง 1-2 cm', xl: ['AI', 'AJ'], max: 1 },
  { key: 'n3c', name: 'No.3 ก้างท้อง >2 cm', xl: ['AK', 'AL'], max: 0 },
  { key: 'n4', name: 'No.4 ก้างลูกครีบ', xl: ['M', 'N'], max: 0 },
  { key: 'n5', name: 'No.5 ก้างแก้ม', xl: ['O', 'P'], max: 0 },
  { key: 'n6', name: 'No.6 ก้างกระดูกกระโดง', xl: ['Q', 'R'], max: 0 },
  { key: 'n7', name: 'No.7 ก้างปลายหาง', xl: ['S', 'T'], max: 0 },
  { key: 'n8', name: 'No.8 ก้าง Boomerang', xl: ['U', 'V'], max: 0 },
  { key: 'n9', name: 'No.9 ก้างกระดูกแตก', xl: ['W', 'X'], max: 0 },
  { key: 'n10', name: 'No.10 ก้าง Back bone', xl: ['Y', 'Z'], max: 0 },
];
const EXTRA = [
  { key: 'scale', name: 'เกล็ด', xl: ['AM', 'AN'] },
  { key: 'skin', name: 'หนัง', xl: ['AO', 'AP'] },
];
const C = {
  date: 'วันที่', shift: 'กะ', time: 'เวลา', plant: 'โรงผลิต', customer: 'ลูกค้า', area: 'พื้นที่', batch: 'Batch', code: 'Code', round: 'รอบอบ',
  j: 'จำนวน (คอลัมน์ J เดิม)', total: 'รวมก้าง', per100: 'ก้าง/100kg', pass: 'PASS / Not Pass', method: 'TOMRA/LEO', remark: 'Remark',
};

let token = '';
async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const isForm = body instanceof FormData;
    const r = await fetch(BASE + url, { method, headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429 && attempt < 5) { await new Promise((s) => setTimeout(s, 3000 * (attempt + 1))); continue; }
    if (!r.ok || j.success === false) throw new Error(`${method} ${url} → ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
    return j.data as T;
  }
}
async function login() {
  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;
}
async function findFile(): Promise<{ fileId: string; sheetId: string } | null> {
  const tree: any[] = await api('GET', '/folders/tree');
  const top = tree.find((f) => f.name === NAMES.folder && !f.parentId);
  if (!top) return null;
  const contents = await api('GET', `/folders/${top.id}/contents`);
  const f = contents?.files?.find((x: any) => x.name === NAMES.file);
  if (!f) return null;
  return { fileId: f.id, sheetId: (await api('GET', `/files/${f.id}`)).sheets[0].id };
}

/* ------------------------------------------------------------------ structure + dashboard */
async function build(picture: string) {
  await login();
  if (await findFile()) { console.log(`• "${NAMES.file}" มีอยู่แล้ว — หยุด`); return; }
  const tree: any[] = await api('GET', '/folders/tree');
  const top = tree.find((f) => f.name === NAMES.folder && !f.parentId)?.id
    ?? (await api('POST', '/folders', { name: NAMES.folder, parentId: null, color: '#0EA5E9', description: 'ตรวจก้างปลา (F3QCPF51) — ลงข้อมูลหลังคัดมือ และ Anatomy' })).id;

  const count = (name: string, max?: number) => ({ name, dataType: 'int', width: 92, defaultValue: 0, validation: { min: 0 },
    ...(max !== undefined ? { description: max === 0 ? 'ห้ามพบ' : `ยอมรับไม่เกิน ${max} ชิ้น/คัน` } : {}) });
  const columns = [
    { name: C.date, dataType: 'date', isRequired: true, width: 116 },
    { name: C.shift, dataType: 'select', isRequired: true, width: 76, options: [{ value: 'DS', label: 'DS', color: '#F59E0B' }, { value: 'NS', label: 'NS', color: '#1552F0' }] },
    { name: C.time, dataType: 'varchar', width: 76, placeholder: '13.50', description: 'เวลาที่สุ่ม (ชม.นาที)' },
    { name: C.plant, dataType: 'select', width: 90, defaultValue: 'PF1', options: ['PF1', 'PF2', 'PF3', 'PF4', 'PF5', 'PF6'].map((v) => ({ value: v, label: v })) },
    { name: C.customer, dataType: 'varchar', width: 100, defaultValue: 'ทั่วไป' },
    { name: C.area, dataType: 'select', width: 120, defaultValue: 'Tomra', options: [{ value: 'Tomra', label: 'Tomra' }, { value: 'คัดมือ TN 100%', label: 'คัดมือ TN 100%' }] },
    { name: C.batch, dataType: 'varchar', width: 130 },
    { name: C.code, dataType: 'varchar', width: 90 },
    { name: C.round, dataType: 'varchar', width: 76 },
    { name: C.j, dataType: 'int', width: 110, description: 'คอลัมน์ J ใน Excel เดิม (หัวคอลัมน์อ่านไม่ออก) — แก้ชื่อได้ที่ ตั้งค่าคอลัมน์' },
    ...PARTS.map((p) => count(p.name, p.max)),
    ...EXTRA.map((p) => count(p.name)),
    { name: C.pass, dataType: 'varchar', width: 120 },
    { name: C.method, dataType: 'varchar', width: 120 },
    { name: C.remark, dataType: 'text', width: 220 },
  ];
  const { id: fileId } = await api('POST', '/files', { name: NAMES.file, folderId: top, color: '#0EA5E9', description: 'ตรวจก้างหลังคัดมือ — 1 แถว = 1 คันรถเข็นที่สุ่ม', sheets: [{ name: NAMES.sheet, columns }] });
  const sheetId: string = (await api('GET', `/files/${fileId}`)).sheets[0].id;
  // the two computed columns
  await api('POST', `/sheets/${sheetId}/columns`, { name: C.total, dataType: 'int', width: 90, description: 'รวมก้าง No.1–No.10 (ไม่รวมเกล็ด/หนัง)',
    validation: { formula: { expr: `SUM(${PARTS.map((p) => `[${p.name}]`).join(', ')})` } } });
  await api('POST', `/sheets/${sheetId}/columns`, { name: C.per100, dataType: 'float', width: 100, description: 'ก้าง × 100 / (1 คัน × 0.5 kg) — เฉลี่ยของคอลัมน์นี้ = pcs/100kg ของช่วงที่เลือก',
    validation: { formula: { expr: `[${C.total}] * 100 / 0.5` }, decimals: 1 } });
  const cols = new Map<string, string>((await api('GET', `/sheets/${sheetId}`)).columns.map((c: any) => [c.name, c.id]));
  const id = (n: string) => { const v = cols.get(n); if (!v) throw new Error(`ไม่พบคอลัมน์ ${n}`); return v; };

  // the form (+ เพิ่มแถว): 3 per line on a computer, the counts together
  const order = [C.date, C.shift, C.time, C.plant, C.area, C.code, C.batch, C.round, C.customer, C.j, ...PARTS.map((p) => p.name), ...EXTRA.map((p) => p.name), C.pass, C.method, C.remark];
  await api('PUT', `/sheets/${sheetId}/form-layout`, { layout: { perRow: 3, fields: order.map((n) => ({ columnId: id(n), ...(n === C.remark ? { span: 3 } : {}) })) } });
  await api('PUT', `/files/${fileId}/doc-type`, { docType: 'record' });

  // picture of the fish for the dashboard
  const fd = new FormData();
  const ext = path.extname(picture).slice(1).toLowerCase();
  fd.append('file', new Blob([new Uint8Array(fs.readFileSync(picture))], { type: ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg' }), path.basename(picture));
  const pic = (await api<{ url: string }>('POST', '/uploads/image', fd)).url;

  // ------------------------------------------------------------------ dashboard
  const W = 1280, M = 24;
  let z = 1;
  const ds = (x: string | null, extra: Record<string, unknown> = {}) => ({ sheetId, xColumnId: x, xBucket: 'none', series: [{ columnId: null, aggregation: 'count', label: 'จำนวนคัน' }], limit: 60, filters: [], ...extra });
  const sum = (n: string, label?: string) => ({ columnId: id(n), aggregation: 'sum', label: label ?? n });
  const w = (type: string, title: string, x: number, y: number, ww: number, h: number, dataSource: any, config: any = {}, style: any = { showTitle: true }) =>
    ({ id: crypto.randomUUID(), type, title, x: Math.round(x), y: Math.round(y), w: Math.round(ww), h: Math.round(h), z: z++, locked: false, dataSource, config, style });
  const COLORS = ['#DC2626', '#1552F0', '#F59E0B', '#16A34A', '#7C3AED', '#0EA5E9', '#DB2777', '#64748B', '#EA580C', '#0D9488', '#9333EA', '#65A30D', '#BE123C', '#0369A1'];
  const chart = { legend: true, grid: true, labels: false, decimals: 0, colors: COLORS };
  const slicer = (c: string, x: number, y: number, ww: number, mode: string, placeholder: string) =>
    w('slicer', '', x, y, ww, 96, ds(id(c)), { mode, multi: true, showLabel: true, placeholder, targets: [] }, { showTitle: false });
  const kpiStyle = { showTitle: true, titleSize: 12, padding: 8 };
  const kpi = (title: string, n: string, x: number, y: number, ww: number, h: number, color = '#DC2626') =>
    w('kpi', title, x, y, ww, h, { ...ds(null), series: [sum(n, n)] }, { decimals: 0, color, prefix: '', suffix: '' }, kpiStyle);

  // picture: 1408 × 690 → 1232 wide
  const IMG = { x: M, y: 410, w: W - 2 * M, h: Math.round((W - 2 * M) * 690 / 1408) };
  const sx = (px: number) => IMG.x + px * IMG.w / 1408;
  const TW = 150;
  const above = [['n8', 213], ['n9', 505], ['n4', 712], ['n6', 952], ['n7', 1316]] as const;   // parts whose photo is above the fish (No.7 on the right)
  const bottom = [['n5', 110], ['n1', 790], ['n10', 1095]] as const;
  const sized = [['n3', 382, 'No.3 ก้างท้อง'], ['n2', 585, 'No.2 ก้างข้างลำตัว']] as const;
  const part = (k: string) => PARTS.find((p) => p.key === k)!;
  const widgets: any[] = [
    w('text', '', M, 14, W - 2 * M, 44, null, { text: 'ANATOMY — ก้างที่พบหลังคัดมือ (F3QCPF51)', fontSize: 24, fontWeight: 700, align: 'left', color: '#0EA5E9', valign: 'middle' },
      { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 4 }),
    w('text', '', M, 56, W - 2 * M, 26, null, { text: 'UNIT: Pieces (ชิ้น) · 1 แถว = 1 คันรถเข็นที่สุ่ม · เลือกวันที่ / กะ ด้านล่าง ตัวเลขบนรูปเปลี่ยนตาม', fontSize: 13, fontWeight: 500, align: 'left', color: '#475569', valign: 'middle' },
      { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 4 }),
    slicer(C.date, M, 90, 300, 'date', 'ช่วงวันที่'),
    slicer(C.shift, M + 312, 90, 160, 'chips', 'กะ'),
    slicer(C.plant, M + 484, 90, 260, 'dropdown', 'โรงผลิต'),
    slicer(C.code, M + 756, 90, 230, 'dropdown_search', 'Code'),
    slicer(C.batch, M + 998, 90, 234, 'dropdown_search', 'Batch'),
    w('kpi', 'จำนวนคันที่สุ่ม', M, 198, 236, 100, ds(null), { decimals: 0, color: '#1552F0', prefix: '', suffix: ' คัน' }, kpiStyle),
    kpi('ก้างที่พบรวม (No.1–10)', C.total, M + 249, 198, 236, 100),
    w('kpi', 'pcs / 100 kg', M + 498, 198, 236, 100, { ...ds(null), series: [{ columnId: id(C.per100), aggregation: 'avg', label: 'pcs/100kg' }] }, { decimals: 1, color: '#F59E0B', prefix: '', suffix: '' }, kpiStyle),
    kpi('เกล็ด', 'เกล็ด', M + 747, 198, 236, 100, '#64748B'),
    kpi('หนัง', 'หนัง', M + 996, 198, 236, 100, '#64748B'),
    w('image', '', IMG.x, IMG.y, IMG.w, IMG.h, null, { url: pic, fit: 'contain' }, { showTitle: false, padding: 0, bg: '#FFFFFF' }),
    // counts above the picture (top photos) …
    ...above.map(([k, cx]) => kpi(part(k).name, part(k).name, Math.min(sx(cx) - TW / 2, W - M - TW), 316, TW, 86)),
    // … and below it
    ...bottom.map(([k, cx]) => kpi(part(k).name, part(k).name, Math.max(M, sx(cx) - TW / 2), IMG.y + IMG.h + 8, TW, 86)),
    ...sized.flatMap(([k, cx, label]) => (['a', 'b', 'c'] as const).map((s, i) =>
      kpi(`${label} ${['<1 cm', '1-2 cm', '>2 cm'][i]}`, part(k + s).name, sx(cx) - TW / 2, IMG.y + IMG.h + 8 + i * 92, TW, 86, i === 0 ? '#F59E0B' : '#DC2626'))),
  ];
  let y = IMG.y + IMG.h + 8 + 3 * 92 + 12;
  widgets.push(
    w('bar', 'ก้างแต่ละส่วน แยกกะ (ชิ้น)', M, y, W - 2 * M, 380, { ...ds(id(C.shift), { sort: 'x_asc' }), series: PARTS.map((p) => sum(p.name)) }, { ...chart, labels: true }),
  );
  y += 392;
  const shiftF = (v: string) => [{ columnId: id(C.shift), mode: 'include', values: [v] }];
  const trend = (title: string, v: string, x: number) => w('line', title, x, y, 610, 340,
    { ...ds(id(C.date), { xBucket: 'day', sort: 'x_asc', limit: 400, filters: shiftF(v) }), series: [sum(C.total, 'ก้างที่พบ (ชิ้น)'), { columnId: null, aggregation: 'count', label: 'จำนวนคัน' }] }, chart);
  widgets.push(trend('เทรนด์ กะ DS: ก้างที่พบ vs จำนวนคัน (ต่อวัน)', 'DS', M), trend('เทรนด์ กะ NS: ก้างที่พบ vs จำนวนคัน (ต่อวัน)', 'NS', M + 622));
  y += 352;
  widgets.push(
    w('line', 'pcs / 100 kg ต่อวัน แยกกะ', M, y, W - 2 * M, 320, { ...ds(id(C.date), { xBucket: 'day', sort: 'x_asc', limit: 400, groupByColumnId: id(C.shift) }), series: [{ columnId: id(C.per100), aggregation: 'avg', label: 'pcs/100kg' }] }, { ...chart, decimals: 1 }),
  );
  y += 332;
  widgets.push(
    w('bar', 'ก้างที่พบรายเดือน แยกกะ', M, y, 610, 340, { ...ds(id(C.date), { xBucket: 'month', sort: 'x_asc', groupByColumnId: id(C.shift) }), series: [sum(C.total, 'ก้างที่พบ')] }, { ...chart, labels: true }),
    w('pareto', 'Pareto: Code ที่พบก้างมากที่สุด', M + 622, y, 610, 340, { ...ds(id(C.code), { sort: 'value_desc', limit: 20 }), series: [sum(C.total, 'ก้างที่พบ')] }, { ...chart, labels: true }),
  );
  y += 352;
  widgets.push(
    w('table', 'สรุปรายวัน (คลิกหัวคอลัมน์เพื่อเรียง)', M, y, 610, 420, { ...ds(id(C.date), { xBucket: 'day', sort: 'x_desc', limit: 400 }),
      series: [{ columnId: null, aggregation: 'count', label: 'จำนวนคัน' }, sum(C.total, 'ก้างที่พบ'), { columnId: id(C.per100), aggregation: 'avg', label: 'pcs/100kg' }] }, { decimals: 0, categoryLabel: 'วันที่' }),
    w('table', 'สรุปรายเดือน แยกกะ', M + 622, y, 610, 420, { ...ds(id(C.date), { xBucket: 'month', sort: 'x_desc', groupByColumnId: id(C.shift) }), series: [sum(C.total, 'ก้างที่พบ')] }, { decimals: 0, categoryLabel: 'เดือน' }),
  );
  y += 432;
  widgets.push(
    w('table', 'สรุปก้างแต่ละส่วน แยกกะ (คลิกหัวคอลัมน์เพื่อเรียง)', M, y, W - 2 * M, 200, { ...ds(id(C.shift), { sort: 'x_asc' }), series: [...PARTS.map((p) => sum(p.name)), sum('เกล็ด'), sum('หนัง')] }, { decimals: 0, categoryLabel: 'กะ' }),
  );
  y += 212;
  const dash = await api('POST', `/files/${fileId}/dashboards`, { name: NAMES.dashboard });
  await api('PUT', `/dashboards/${dash.id}`, { name: NAMES.dashboard, canvas: { width: W, height: y + 16, gridSize: 8, snap: true }, background: { color: '#F4F6FB', imageUrl: null, fit: 'cover' }, widgets });
  console.log(`✓ ${NAMES.file} (file ${fileId}, sheet ${sheetId}) · แดชบอร์ด ${dash.id} (${widgets.length} วิดเจ็ต)`);
}

/* ------------------------------------------------------------------ the Excel rows → compact seed */
const pad = (n: number) => String(n).padStart(2, '0');
const clean = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\r/g, '').trim());
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(clean(v)); return Number.isFinite(n) ? n : 0; };

function readRows(file: string) {
  const wb = XLSX.readFile(file, { cellDates: false, dense: false });
  const ws = wb.Sheets['หลังคัดมือ'];
  if (!ws) throw new Error('ไม่พบชีต หลังคัดมือ');
  const v = (r: number, col: string) => ws[`${col}${r}`]?.v;
  const out: any[] = [];
  const skipped: number[] = [];
  const filled: number[] = [];
  let lastDate: string | null = null, lastShift = '';
  const fixedDates: string[] = [];
  const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
  for (let r = 8; r <= 20000; r++) {
    const raw = v(r, 'A');
    const hasData = !!(clean(v(r, 'G')) || clean(v(r, 'F')) || clean(v(r, 'H')));
    let date: string | null = null;
    if (typeof raw === 'number') { const p = XLSX.SSF.parse_date_code(raw); date = `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
    else if (raw !== undefined && raw !== null) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(clean(raw)); if (m) date = `${m[3].length === 2 ? 2000 + Number(m[3]) : m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`; }
    // a cart written without a date (or "/3/2026"): the log is in date order, so it is the date of the cart before it
    let note = '';
    if (!date) {
      if (!hasData) continue;
      if (!lastDate) { skipped.push(r); continue; }
      date = lastDate; note = 'วันที่/กะ ตามแถวก่อนหน้า (Excel ไม่ได้ระบุ)'; filled.push(r);
    }
    // a wrong year (2025-01-15 between 2026-01-14 and 2026-01-16, 2029-06-29, 1900-06-22): the log is in date order — the same day in the
    // year of the cart before it when that fits (within 7 days of it), otherwise the date of the cart before it
    const today = new Date().toISOString().slice(0, 10);
    if (lastDate && (date > today || daysBetween(lastDate, date) < -180)) {
      const fixedYear = [Number(lastDate.slice(0, 4)), Number(lastDate.slice(0, 4)) + 1].map((y) => `${y}${date!.slice(4)}`)
        .find((d) => Math.abs(daysBetween(lastDate!, d)) <= 7 && d <= today);
      fixedDates.push(`${r}: ${date} → ${fixedYear ?? lastDate}`);
      date = fixedYear ?? lastDate;
    }
    lastDate = date;
    let shift = clean(v(r, 'E')).toUpperCase();
    if (shift !== 'DS' && shift !== 'NS') shift = lastShift; else lastShift = shift;
    const t = v(r, 'F');
    const time = typeof t === 'number' ? (() => { const all = Math.round(t * 100); const h = Math.floor(all / 100), mi = all % 100; return `${pad(h)}.${pad(mi)}`; })() : clean(t);
    const area = /tom/i.test(clean(v(r, 'D'))) ? 'Tomra' : clean(v(r, 'D')) ? 'คัดมือ TN 100%' : '';
    const plant = /^PF\d$/i.test(clean(v(r, 'B'))) ? clean(v(r, 'B')).toUpperCase() : '';
    const counts = [...PARTS, ...EXTRA].map((p) => Math.trunc(num(v(r, p.xl[0]))) + Math.trunc(num(v(r, p.xl[1]))));
    const total = counts.slice(0, PARTS.length).reduce((s, x) => s + x, 0);
    const jv = v(r, 'J');
    out.push([date, shift, time, plant, clean(v(r, 'C')), area, clean(v(r, 'G')), clean(v(r, 'H')),
      clean(v(r, 'I')), typeof jv === 'number' ? jv : null, ...counts, total, clean(v(r, 'AQ')), clean(v(r, 'AR')), [clean(v(r, 'AS')), note].filter(Boolean).join(' · ')]);
  }
  if (fixedDates.length) console.log(`  • ${fixedDates.length} แถวปีผิด → แก้ตามลำดับวันที่ (${fixedDates.join(' · ')})`);
  if (filled.length) console.log(`  • ${filled.length} แถวไม่มีวันที่ใน Excel → ใช้วันที่/กะของแถวก่อนหน้า (แถว ${filled.join(', ')})`);
  return { out, skipped };
}

async function dataSql(file: string, outPath: string) {
  await login();
  const f = await findFile();
  if (!f) throw new Error('สร้างไฟล์ก่อน (รันโดยไม่ใส่ --data-sql)');
  const cols = (await api('GET', `/sheets/${f.sheetId}`)).columns as { id: string; name: string; dataType: string }[];
  const byName = (n: string) => { const c = cols.find((x) => x.name === n); if (!c) throw new Error(`ไม่พบคอลัมน์ ${n}`); return c; };
  // the order of the values in each JSON array, and where each one is stored
  const fields = [C.date, C.shift, C.time, C.plant, C.customer, C.area, C.batch, C.code, C.round, C.j, ...PARTS.map((p) => p.name), ...EXTRA.map((p) => p.name), C.total, C.pass, C.method, C.remark]
    .map((n) => byName(n));
  const { out, skipped } = readRows(file);
  // per100 is computed in SQL from รวมก้าง (index of total)
  const totalIdx = fields.findIndex((c) => c.name === C.total);
  const per100 = byName(C.per100);
  const slot = (t: string) => (t === 'int' ? 'value_int' : t === 'float' ? 'value_float' : t === 'date' ? 'value_date' : 'value_text');
  const sqlType = (t: string) => (t === 'int' ? 'BIGINT' : t === 'float' ? 'FLOAT' : t === 'date' ? 'DATE' : 'NVARCHAR(4000)');
  const lit = (s: string) => `N'${s.replace(/'/g, "''")}'`;
  const CHUNK = 1500;
  const chunks: string[] = [];
  for (let i = 0; i < out.length; i += CHUNK) chunks.push(JSON.stringify(out.slice(i, i + CHUNK)));
  const cellsFor = (src: string) => fields.map((c, i) => {
    const s = slot(c.dataType);
    // zero counts are not stored (empty = 0 in sums); text: empty = not stored
    const keep = c.dataType === 'int' ? `TRY_CAST(JSON_VALUE(${src}.[value], '$[${i}]') AS BIGINT) <> 0` : `NULLIF(JSON_VALUE(${src}.[value], '$[${i}]'), N'') IS NOT NULL`;
    return `SELECT r.row_id AS row_id, CAST('${c.id}' AS UNIQUEIDENTIFIER) AS column_id, ${s === 'value_text' ? `JSON_VALUE(${src}.[value], '$[${i}]')` : 'CAST(NULL AS NVARCHAR(MAX))'} AS value_text, ${s === 'value_int' ? `TRY_CAST(JSON_VALUE(${src}.[value], '$[${i}]') AS BIGINT)` : 'CAST(NULL AS BIGINT)'} AS value_int, ${s === 'value_float' ? `TRY_CAST(JSON_VALUE(${src}.[value], '$[${i}]') AS FLOAT)` : 'CAST(NULL AS FLOAT)'} AS value_float, ${s === 'value_date' ? `TRY_CAST(JSON_VALUE(${src}.[value], '$[${i}]') AS DATETIME2)` : 'CAST(NULL AS DATETIME2)'} AS value_date
  FROM @rows r JOIN OPENJSON(@d) ${src} ON TRY_CAST(${src}.[key] AS INT) = r.k WHERE ${keep}`;
  }).join('\n  UNION ALL ');
  void sqlType;
  const sql = `-- DocHUB seed: the rows of sheet "${NAMES.sheet}" (Excel F3QCPF51 sheet หลังคัดมือ, ${out.length} rows; ${skipped.length} rows without a date skipped).
-- Generated by server/scripts/buildBone.ts --data-sql — do not edit by hand. Runs after bone_f3qcpf51.sql (the file); once per database;
-- does nothing when the sheet is missing or already has rows. Compact: one JSON array per row, ${chunks.length} chunks of ≤${CHUNK} rows.
-- Each array: ${fields.map((c) => c.name).join(' | ')}
SET NOCOUNT ON;
DECLARE @s UNIQUEIDENTIFIER = '${f.sheetId}';
IF NOT EXISTS (SELECT 1 FROM Sheets WHERE sheet_id = @s AND is_deleted = 0) BEGIN SELECT N'skipped (no sheet)' AS result; RETURN; END;
IF EXISTS (SELECT 1 FROM Rows WHERE sheet_id = @s) BEGIN SELECT N'skipped (sheet has rows)' AS result; RETURN; END;
DECLARE @u UNIQUEIDENTIFIER = (SELECT TOP 1 u.user_id FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id JOIN Roles r ON r.role_id = ur.role_id
                               WHERE r.role_name = N'admin' AND u.is_active = 1 ORDER BY u.created_at);
IF @u IS NULL SET @u = (SELECT TOP 1 user_id FROM Users WHERE is_active = 1 ORDER BY created_at);
DECLARE @d NVARCHAR(MAX), @base INT = 0;
DECLARE @rows TABLE (k INT PRIMARY KEY, row_id UNIQUEIDENTIFIER);
${chunks.map((c) => `
SET @d = ${lit(c)};
DELETE FROM @rows;
INSERT INTO @rows (k, row_id) SELECT TRY_CAST([key] AS INT), NEWID() FROM OPENJSON(@d);
INSERT INTO Rows (row_id, sheet_id, row_order, created_by, updated_by) SELECT row_id, @s, @base + k + 1, @u, @u FROM @rows;
INSERT INTO Cells (row_id, column_id, value_text, value_int, value_float, value_date, updated_by)
SELECT x.row_id, x.column_id, x.value_text, x.value_int, x.value_float, x.value_date, @u FROM (
  ${cellsFor('j')}
  UNION ALL SELECT r.row_id, '${per100.id}', NULL, NULL, TRY_CAST(JSON_VALUE(j.[value], '$[${totalIdx}]') AS FLOAT) * 100 / 0.5, NULL
  FROM @rows r JOIN OPENJSON(@d) j ON TRY_CAST(j.[key] AS INT) = r.k
) x;
SET @base = @base + (SELECT COUNT(*) FROM @rows);`).join('\n')}
SELECT N'inserted' AS result;
`;
  fs.writeFileSync(outPath, sql, 'utf8');
  console.log(`✓ ${outPath} (${(sql.length / 1024 / 1024).toFixed(2)} MB) · ${out.length} แถว · ข้าม ${skipped.length} แถวที่ไม่มีวันที่${skipped.length ? ` (${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ' …' : ''})` : ''}`);
}

async function main() {
  const file = arg('--file'), dataOut = arg('--data-sql'), picture = arg('--picture');
  if (dataOut) { if (!file) throw new Error('ใส่ --file'); return dataSql(file, path.resolve(dataOut)); }
  if (!picture) throw new Error('ใส่ --picture "<รูปก้างปลา>"');
  return build(picture);
}
if (require.main === module) main().catch((e) => { console.error('✗', e.message); process.exit(1); });
