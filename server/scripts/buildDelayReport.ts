/**
 * Creates "Delay HUB / รายงาน Delay F3PFPF67" (sheet + dashboard) on a DocHUB test database — the structure only, no data. The data comes
 * every day from DelayHUB through the connector that the server sets up from .env (src/modules/delayReport/bootstrap.ts).
 *   DOCHUB_URL=http://localhost:4500/api DOCHUB_USER=admin DOCHUB_PASSWORD=… npx ts-node scripts/buildDelayReport.ts
 * then ship it as a start-up seed:  npx ts-node scripts/exportSeedSql.ts --file-id <id> > ../database/seed/delay_report_f3pfpf67.sql
 */
import crypto from 'crypto';
import { DELAY_COLS, DELAY_NAMES } from '../src/modules/delayReport/columns';

const BASE = process.env.DOCHUB_URL ?? 'http://localhost:4000/api';
let token = '';
async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`${method} ${url} → ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
  return j.data as T;
}
const COLORS = ['#1552F0', '#16A34A', '#F59E0B', '#E5484D', '#8B5CF6', '#0EA5E9', '#EC4899', '#14B8A6'];

async function main() {
  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;
  const tree: any[] = await api('GET', '/folders/tree');
  const folderId = tree.find((f) => f.name === DELAY_NAMES.folder && !f.parentId)?.id
    ?? (await api('POST', '/folders', { name: DELAY_NAMES.folder, parentId: null, color: '#E5484D', description: 'ข้อมูลจาก DelayHUB (ดึงอัตโนมัติทุกวัน)' })).id;
  const contents = await api('GET', `/folders/${folderId}/contents`).catch(() => null);
  if (contents?.files?.some((f: any) => f.name === DELAY_NAMES.file)) { console.log(`• "${DELAY_NAMES.file}" มีอยู่แล้ว — หยุด`); return; }

  const columns = DELAY_COLS.map((c) => ({
    name: c.name, dataType: c.dataType, width: c.width, ...(c.description ? { description: c.description } : {}),
    ...(c.options ? { options: c.options.map((v, i) => ({ value: v, label: v, color: COLORS[i % COLORS.length] })) } : {}),
  }));
  const { id: fileId } = await api('POST', '/files', { name: DELAY_NAMES.file, folderId, color: '#E5484D', description: 'รายงานควบคุมเวลาการผลิต (Delay Time for Production Control Report) F3PFPF67 — ดึงจาก DelayHUB ทุกวัน 05:00', sheets: [{ name: DELAY_NAMES.sheet, columns }] });
  const sheetId: string = (await api('GET', `/files/${fileId}`)).sheets[0].id;
  const col = new Map<string, string>((await api('GET', `/sheets/${sheetId}`)).columns.map((c: any) => [c.name, c.id]));
  const id = (n: string) => { const v = col.get(n); if (!v) throw new Error(`no column ${n}`); return v; };

  // ------------------------------------------------------------------ dashboard
  const W = 1280, M = 24;
  let z = 1;
  const w = (type: string, title: string, x: number, y: number, ww: number, h: number, dataSource: any, config: any = {}, style: any = { showTitle: true }) =>
    ({ id: crypto.randomUUID(), type, title, x, y, w: ww, h, z: z++, locked: false, dataSource, config, style });
  const ds = (x: string | null, extra: Record<string, unknown> = {}) => ({ sheetId, xColumnId: x, xBucket: 'none', series: [{ columnId: null, aggregation: 'count', label: 'จำนวนแถว' }], limit: 50, filters: [], ...extra });
  const over = [{ columnId: id('เกินมาตรฐาน'), mode: 'include', values: [true] }];
  const chart = { legend: false, grid: true, labels: true, decimals: 0, colors: COLORS };
  const slicer = (label: string, c: string, x: number, y: number, ww: number, mode: string, placeholder: string) =>
    w('slicer', '', x, y, ww, 96, ds(id(c)), { mode, multi: true, showLabel: true, placeholder, targets: [], label }, { showTitle: false });
  const avg = (n: number) => ({ columnId: id(`ช่วงที่ ${n} (ชม.)`), aggregation: 'avg', label: `ช่วงที่ ${n}` });
  const widgets = [
    w('text', '', M, 16, W - 2 * M, 56, null, { text: 'DELAY TIME — รายงานควบคุมเวลาการผลิต (F3PFPF67)', fontSize: 24, fontWeight: 700, align: 'left', color: '#E5484D', valign: 'middle' },
      { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 4 }),
    slicer('วันที่', 'วันที่', M, 84, 300, 'date', 'ช่วงวันที่'),
    slicer('กะ', 'กะ', M + 312, 84, 150, 'chips', 'กะ'),
    slicer('ไลน์', 'ไลน์', M + 474, 84, 240, 'dropdown_search', 'เลือกไลน์'),
    slicer('Code', 'Code', M + 726, 84, 250, 'dropdown_search', 'เลือก Code'),
    slicer('วัตถุดิบ', 'วัตถุดิบ (Raw Mat.)', M + 988, 84, 244, 'dropdown_search', 'เลือกวัตถุดิบ'),
    w('kpi', 'จำนวนรายการ', M, 192, 300, 132, ds(null), { decimals: 0, color: '#1552F0' }),
    w('kpi', 'เกินมาตรฐาน (รายการ)', M + 312, 192, 300, 132, ds(null, { filters: over }), { decimals: 0, color: '#E5484D' }),
    w('kpi', 'น้ำหนักรวม (kgs.)', M + 624, 192, 300, 132, { ...ds(null), series: [{ columnId: id('น้ำหนัก (kgs.)'), aggregation: 'sum', label: 'kgs.' }] }, { decimals: 0, color: '#16A34A' }),
    w('kpi', 'เฉลี่ย เตรียมเสร็จ - บรรจุเสร็จ (ชม.)', M + 936, 192, 296, 132, { ...ds(null), series: [avg(4)] }, { decimals: 2, color: '#F59E0B' }),
    w('pareto', 'เกินมาตรฐาน: วัตถุดิบไหนมากที่สุด', M, 338, 800, 340, ds(id('วัตถุดิบ (Raw Mat.)'), { sort: 'value_desc', filters: over }), { ...chart, legend: true }),
    w('pie', 'เกินมาตรฐาน: แยกไลน์', M + 812, 338, 420, 340, ds(id('ไลน์'), { sort: 'value_desc', filters: over }), { ...chart, legend: true }),
    w('bar', 'จำนวนรายการต่อวัน (แยก เกิน / ไม่เกินมาตรฐาน)', M, 690, W - 2 * M, 320, ds(id('วันที่'), { xBucket: 'day', sort: 'x_asc', limit: 400, groupByColumnId: id('เกินมาตรฐาน') }), { ...chart, legend: true, labels: false }),
    w('table', 'เวลาเฉลี่ยแต่ละช่วง (ชม.) ตามวัตถุดิบ', M, 1022, 760, 420, { ...ds(id('วัตถุดิบ (Raw Mat.)'), { sort: 'x_asc', limit: 500 }), series: [avg(1), avg(2), avg(3), avg(4)] }, { decimals: 2, categoryLabel: 'วัตถุดิบ' }),
    w('table', 'เกินมาตรฐานตาม Code', M + 772, 1022, 460, 420, ds(id('Code'), { sort: 'value_desc', filters: over, limit: 500 }), { decimals: 0, categoryLabel: 'Code' }),
    w('records', 'รายการทั้งหมด (ค้นหาได้ทุกช่อง)', M, 1454, W - 2 * M, 720, ds(null),
      { searchColumnIds: [], titleColumnIds: [id('Code'), id('วัตถุดิบ (Raw Mat.)'), id('บรรจุเสร็จ (F)')], fieldColumnIds: [], fieldColumnsAll: true, imageColumnId: null, pageSize: 30, placeholder: 'ค้นหา Code / วัตถุดิบ / Batch …' }),
  ];
  const dash = await api('POST', `/files/${fileId}/dashboards`, { name: DELAY_NAMES.dashboard });
  await api('PUT', `/dashboards/${dash.id}`, { name: DELAY_NAMES.dashboard, canvas: { width: W, height: 2210, gridSize: 8, snap: true }, background: { color: '#F4F6FB', imageUrl: null, fit: 'cover' }, widgets });
  console.log(`✓ ${DELAY_NAMES.file} (file ${fileId}, sheet ${sheetId}) · แดชบอร์ด ${dash.id}`);
}

if (require.main === module) main().catch((e) => { console.error('✗', e.message); process.exit(1); });
