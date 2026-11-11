/**
 * Builds "Quality Highlight - Incoming" (an empty Master Data sheet: Material / Description / รูปภาพ / วันที่ Update ข้อมูล / Update By)
 * and its dashboard "Quality Highlight Incoming" (search a Material → its details and pictures, latest Rev changes) through the API,
 * in the folder Quality Highlight Report / Data. The seed database/seed/quality_highlight_incoming.sql is exported from it:
 *
 *   set DOCHUB_URL=http://localhost:4000/api & set DOCHUB_USER=admin & set DOCHUB_PASSWORD=…
 *   npx ts-node --transpile-only scripts/buildQualityHighlightIncoming.ts
 *   npx ts-node --transpile-only scripts/exportSeedSql.ts --file-id <id> --folder "Quality Highlight Report" --sub "Data" \
 *     --skip-names "Quality Highlight - Incoming" --out ../database/seed/quality_highlight_incoming.sql
 *
 * The dashboard shows every column of the sheet except Material and the pictures (fieldColumnsAll), so columns added later
 * appear there by themselves.
 */
import crypto from 'crypto';

const BASE = process.env.DOCHUB_URL ?? 'http://localhost:4000/api';
const NAMES = { folder: 'Quality Highlight Report', sub: 'Data', file: 'Quality Highlight - Incoming', sheet: 'Incoming', dashboard: 'Quality Highlight Incoming' };
const COL = { material: 'Material', desc: 'Description', images: 'รูปภาพ', date: 'วันที่ Update ข้อมูล', by: 'Update By' };

let token = '';
async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`${method} ${url} → ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
  return j.data as T;
}

async function folder(name: string, parentId: string | null, color: string): Promise<string> {
  const tree: any[] = await api('GET', '/folders/tree');
  const hit = tree.find((f) => f.name === name && (f.parentId ?? null) === parentId);
  if (hit) return hit.id;
  return (await api('POST', '/folders', { name, parentId, color })).id;
}

const blankDs = (sheetId: string) => ({ sheetId, xColumnId: null, xBucket: 'none', series: [{ columnId: null, aggregation: 'count' }], limit: 20 });

async function main() {
  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;

  const top = await folder(NAMES.folder, null, '#1552F0');
  const sub = await folder(NAMES.sub, top, '#16A34A');
  const contents = await api('GET', `/folders/${sub}/contents`).catch(() => null);
  if (contents?.files?.some((f: any) => f.name === NAMES.file)) { console.log(`• "${NAMES.file}" มีอยู่แล้ว — หยุด`); return; }

  const columns = [
    { name: COL.material, dataType: 'varchar', isRequired: true, width: 180 },
    { name: COL.desc, dataType: 'text', width: 460 },
    { name: COL.images, dataType: 'image', width: 160 },
    { name: COL.date, dataType: 'date', width: 150, validation: { autoStamp: 'updatedAt' } },
    { name: COL.by, dataType: 'varchar', width: 150, validation: { autoStamp: 'updatedBy' } },
  ];
  const { id: fileId } = await api('POST', '/files', {
    name: NAMES.file, folderId: sub, color: '#0EA5E9', description: 'Quality Highlight ของวัตถุดิบรับเข้า (Incoming) — ค้นหาจาก Material', sheets: [{ name: NAMES.sheet, columns }],
  });
  const sheetId: string = (await api('GET', `/files/${fileId}`)).sheets[0].id;
  const cols = new Map<string, string>((await api('GET', `/sheets/${sheetId}`)).columns.map((c: any) => [c.name, c.id]));
  const id = (n: string) => cols.get(n)!;

  await api('PUT', `/sheets/${sheetId}/revisions/settings`, { keyColumnIds: [id(COL.material)] });
  await api('PUT', `/files/${fileId}/doc-type`, { docType: 'master_data' }); // Master Data → first Rev

  const dash = await api('POST', `/files/${fileId}/dashboards`, { name: NAMES.dashboard });
  const W = 1280;
  const widgets = [
    { id: crypto.randomUUID(), type: 'text', title: '', x: 24, y: 16, w: W - 48, h: 64, z: 1, locked: false, dataSource: null,
      config: { text: 'QUALITY HIGHLIGHT — INCOMING', fontSize: 24, fontWeight: 700, align: 'left', color: '#0EA5E9', valign: 'middle' },
      style: { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 4 } },
    { id: crypto.randomUUID(), type: 'records', title: 'ค้นหา Material', x: 24, y: 96, w: 820, h: 760, z: 2, locked: false, dataSource: blankDs(sheetId),
      config: {
        searchColumnIds: [id(COL.material)], titleColumnIds: [id(COL.material)], fieldColumnIds: [id(COL.desc), id(COL.date), id(COL.by)], fieldColumnsAll: true,
        imageColumnId: id(COL.images), pageSize: 20, placeholder: 'พิมพ์ Material (บางส่วนก็ได้)', showRev: true, fontSize: 14,
      },
      style: { showTitle: true } },
    { id: crypto.randomUUID(), type: 'revision', title: 'Rev ล่าสุด และสิ่งที่เปลี่ยน', x: 868, y: 96, w: W - 868 - 24, h: 760, z: 3, locked: false, dataSource: blankDs(sheetId),
      config: { limit: 10, fontSize: 13 }, style: { showTitle: true } },
  ];
  await api('PUT', `/dashboards/${dash.id}`, { name: NAMES.dashboard, canvas: { width: W, height: 880, gridSize: 8, snap: true }, background: { color: '#F4F6FB', imageUrl: null, fit: 'cover' }, widgets });
  console.log(`✓ ${NAMES.file} (file ${fileId}) · แดชบอร์ด ${dash.id}`);
}

if (require.main === module) main().catch((e) => { console.error('✗', e.message); process.exit(1); });
