/**
 * Creates "Quality Hilight / Master" in a running DocHUB from the QUALITY HIGHLIGHT Excel file (sheet "Master"):
 *   folder Quality Hilight → sub-folder Master → file "Quality Hilight - Master" (sheet Master),
 *   pictures embedded in the Excel → the "รูปภาพ" column of their row, the first Rev (REV.N of the file name),
 *   and the dashboard "Quality Hilight" (search Sub Doc No. / Short Code → details + pictures, latest Rev changes).
 *
 *   cd server
 *   set DOCHUB_URL=http://localhost:4000/api      (Linux/macOS: export …)
 *   set DOCHUB_USER=<master or admin>
 *   set DOCHUB_PASSWORD=<password>
 *   npx ts-node --transpile-only scripts/seedQualityHighlight.ts --file "C:\path\REV.8_..._QUALITY_HIGHLIGHT_....xlsx" --dry
 *   npx ts-node --transpile-only scripts/seedQualityHighlight.ts --file "C:\path\REV.8_..._QUALITY_HIGHLIGHT_....xlsx"
 *     --rev 8   first Rev number (default: the number after "REV." in the file name, else 1)
 *     --folder "Quality Highlight Report" --sub "Data"   put it in these folders (default Quality Hilight / Master; existing ones are reused)
 *     --name "Quality Highlight - Master"  --dashboard "Quality Highlight"   file / dashboard names
 *
 * The Excel is read on this machine: the company's notes are never copied into the repository.
 * It talks to the normal HTTP API (same validation / permissions / audit as the screens). Nothing is deleted or
 * overwritten: if the file already exists in Quality Hilight / Master, the script stops.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const BASE = (process.env.DOCHUB_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const DRY = process.argv.includes('--dry');

/** Where it goes; every name can be changed, e.g. --folder "Quality Highlight Report" --sub "Data" (existing folders are reused) */
const NAMES = {
  folder: arg('--folder') ?? 'Quality Hilight', sub: arg('--sub') ?? 'Master', file: arg('--name') ?? 'Quality Hilight - Master', sheet: 'Master',
  dashboard: arg('--dashboard') ?? 'Quality Hilight',
};
const COL = {
  sub: 'Sub Doc No.', material: 'Material', short: 'Short Code', note: 'ให้Spread', images: 'รูปภาพ',
  date: 'วันที่ Update ข้อมูล', by: 'Updated by', dateNote: 'วันที่ Update (ข้อความเดิมใน Excel)',
};

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */
export interface Rec {
  excelRow: number; lastExcelRow: number; sub: string; material: string | null; short: string | null; note: string | null;
  date: string | null; by: string | null; dateNote: string | null; images: string[]; merged: number;
}
export interface Pic { record: number; excelRow: number; file: string; mime: string; data: Buffer }

const clean = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim());
const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const ymd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};

/** A date cell: an Excel date, or text with one or more d/m/yyyy dates (the latest is kept, the text is kept beside it) */
export function readDate(v: unknown): { date: string | null; text: string | null } {
  if (typeof v === 'number' && v > 0) {
    const d = XLSX.SSF.parse_date_code(v);
    return { date: d ? ymd(d.y, d.m, d.d) : null, text: null };
  }
  const s = clean(v);
  if (!s) return { date: null, text: null };
  const all = [...s.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/g)]
    .map((m) => ymd(Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1])))
    .filter((x): x is string => !!x).sort();
  return { date: all[all.length - 1] ?? null, text: s };
}

export function parseWorkbook(file: string): { records: Rec[]; pics: Pic[]; warnings: string[]; heading: string | null } {
  const wb = XLSX.readFile(file, { cellDates: false, bookFiles: true });
  const name = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'master');
  if (!name) throw new Error(`ไม่พบชีต "Master" ในไฟล์ (มี: ${wb.SheetNames.join(', ')})`);
  const ws = wb.Sheets[name];
  const start = XLSX.utils.decode_range(ws['!ref'] ?? 'A1').s.c;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const warnings: string[] = [];

  // header row: the one with "Sub Doc No."
  const hr = grid.findIndex((r) => (r ?? []).some((c) => key(clean(c)) === key(COL.sub)));
  if (hr < 0) throw new Error('ไม่พบหัวคอลัมน์ "Sub Doc No." ในชีต Master');
  const idx = (label: string) => (grid[hr] ?? []).findIndex((c) => key(clean(c)) === key(label));
  const at = { sub: idx(COL.sub), material: idx(COL.material), short: idx(COL.short), note: idx(COL.note), date: idx(COL.date), by: idx(COL.by) };
  for (const [k, i] of Object.entries(at)) if (i < 0) throw new Error(`ไม่พบหัวคอลัมน์ "${(COL as any)[k]}" ในแถวหัวตาราง (แถว ${hr + 1})`);
  const heading = (grid.slice(0, hr).flat().map(clean).find((s) => /note/i.test(s)) ?? null) || null;

  const records: Rec[] = [];
  for (let i = hr + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const v = (j: number) => r[j];
    const sub = clean(v(at.sub)), material = clean(v(at.material)), short = clean(v(at.short)), note = clean(v(at.note)), by = clean(v(at.by));
    const d = readDate(v(at.date));
    const excelRow = i + 1;
    if (!sub && !material && !short) {
      // a note that continues on the next Excel rows: add it to the record above
      const extra = [note, d.date ? '' : d.text ?? ''].filter(Boolean);
      if (!extra.length && !by) continue;
      const prev = records[records.length - 1];
      if (!prev) { warnings.push(`แถว ${excelRow}: ไม่มี Sub Doc No. และไม่มีแถวก่อนหน้า — ข้าม`); continue; }
      prev.note = [prev.note, ...extra].filter(Boolean).join('\n');
      prev.lastExcelRow = excelRow;
      prev.merged++;
      continue;
    }
    if (!sub) warnings.push(`แถว ${excelRow}: ไม่มี Sub Doc No. (Material ${material || '-'}) — นำเข้าโดยใช้ "(ไม่ระบุ)"`);
    if (d.text && !d.date) warnings.push(`แถว ${excelRow} (${sub}): อ่านวันที่ "${d.text.replace(/\n/g, ' ')}" ไม่ได้ — เก็บเป็นข้อความ`);
    records.push({
      excelRow, lastExcelRow: excelRow, sub: sub || '(ไม่ระบุ)', material: material || null, short: short || null, note: note || null,
      date: d.date, by: by || null, dateNote: d.text, images: [], merged: 0,
    });
  }
  void start;

  // pictures: workbook → sheet file → its drawing → each anchor's top-left row and picture
  const files: Record<string, { content: any }> = (wb as any).files ?? {};
  const read = (p: string) => { const f = files[p] ?? files[`/${p}`]; return f ? Buffer.from(f.content) : null; };
  const rels = (p: string) => {
    const xml = read(p)?.toString('utf8') ?? '';
    return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({
      id: /\bId="([^"]+)"/.exec(m[0])?.[1] ?? '', type: /\bType="([^"]+)"/.exec(m[0])?.[1] ?? '', target: /\bTarget="([^"]+)"/.exec(m[0])?.[1] ?? '',
    }));
  };
  const resolve = (fromDir: string, target: string) => (target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(fromDir, target)));
  const pics: Pic[] = [];
  const wbXml = read('xl/workbook.xml')?.toString('utf8') ?? '';
  const sheetTag = [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => /\bname="([^"]+)"/.exec(t)?.[1] === name);
  const sheetRid = sheetTag ? /r:id="([^"]+)"/.exec(sheetTag)?.[1] : undefined;
  const sheetTarget = rels('xl/_rels/workbook.xml.rels').find((r) => r.id === sheetRid)?.target;
  if (sheetTarget) {
    const sheetPath = resolve('xl', sheetTarget);
    const sheetDir = path.posix.dirname(sheetPath);
    for (const d of rels(`${sheetDir}/_rels/${path.posix.basename(sheetPath)}.rels`).filter((r) => /\/drawing$/.test(r.type))) {
      const drawingPath = resolve(sheetDir, d.target);
      const drawingDir = path.posix.dirname(drawingPath);
      const media = new Map(rels(`${drawingDir}/_rels/${path.posix.basename(drawingPath)}.rels`).map((r) => [r.id, resolve(drawingDir, r.target)]));
      const xml = read(drawingPath)?.toString('utf8') ?? '';
      for (const a of xml.matchAll(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/(?:\w+:)?\1>/g)) {
        const row = /<(?:\w+:)?from>[\s\S]*?<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/.exec(a[0]);
        const embed = /r:embed="([^"]+)"/.exec(a[0]);
        if (!row || !embed) continue;
        const target = media.get(embed[1]);
        const data = target ? read(target) : null;
        const ext = (target ?? '').split('.').pop()!.toLowerCase();
        const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[ext];
        const excelRow = Number(row[1]) + 1;
        if (!data || !mime) { warnings.push(`รูปที่แถว ${excelRow}: ชนิดไฟล์ ${ext || '?'} ไม่รองรับ — ข้าม`); continue; }
        // the record whose rows cover the picture's top-left corner, else the nearest one above it
        let rec = records.findIndex((r) => r.excelRow <= excelRow && excelRow <= r.lastExcelRow);
        if (rec < 0) rec = records.reduce((best, r, k) => (r.excelRow <= excelRow ? k : best), -1);
        if (rec < 0) { warnings.push(`รูปที่แถว ${excelRow}: ไม่มีแถวข้อมูลให้ผูก — ข้าม`); continue; }
        pics.push({ record: rec, excelRow, file: path.posix.basename(target!), mime, data });
      }
    }
  }
  return { records, pics, warnings, heading };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */
let token = '';
async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const r = await fetch(BASE + url, {
      method,
      headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429 && attempt < 5) { await new Promise((s) => setTimeout(s, 3000 * (attempt + 1))); continue; }
    if (!r.ok || j.success === false) throw new Error(`${method} ${url} → ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
    return j.data as T;
  }
}

async function folder(name: string, parentId: string | null, color: string): Promise<string> {
  const tree: any[] = await api('GET', '/folders/tree');
  const hit = tree.find((f) => f.name === name && (f.parentId ?? null) === parentId);
  if (hit) { console.log(`• โฟลเดอร์ "${name}" มีอยู่แล้ว — ใช้ต่อ`); return hit.id; }
  const f = await api('POST', '/folders', { name, parentId, color, description: parentId ? 'ข้อมูลหลัก Quality Highlight' : 'Note การผลิตที่รวบรวมจากปัญหาที่เคยพบ' });
  console.log(`✓ สร้างโฟลเดอร์ "${name}"`);
  return f.id;
}

const blankDs = (sheetId: string) => ({ sheetId, xColumnId: null, xBucket: 'none', series: [{ columnId: null, aggregation: 'count' }], limit: 20 });

async function main() {
  const file = arg('--file');
  if (!file) throw new Error('ระบุไฟล์ Excel: --file "<path>.xlsx"');
  if (!fs.existsSync(file)) throw new Error(`ไม่พบไฟล์ ${file}`);
  const revFromName = /REV\.?\s*(\d+)/i.exec(path.basename(file))?.[1];
  const firstRev = Number(arg('--rev') ?? revFromName ?? 1);

  const { records, pics, warnings, heading } = parseWorkbook(file);
  const multi = new Map<string, number>();
  records.forEach((r) => multi.set(r.sub, (multi.get(r.sub) ?? 0) + 1));
  console.log(`อ่านไฟล์: ${records.length} แถว (Sub Doc No. ${multi.size} รหัส, ${[...multi.values()].filter((n) => n > 1).length} รหัสมีหลายแถว)`);
  console.log(`  รวมแถวต่อของ Note เข้ากับแถวด้านบน ${records.reduce((n, r) => n + r.merged, 0)} แถว · วันที่ที่เป็นข้อความ ${records.filter((r) => r.dateNote).length} แถว · รูป ${pics.length} รูป`);
  for (const p of pics) console.log(`  รูปแถว ${p.excelRow} → ${records[p.record].sub}${records[p.record].short ? ` (${records[p.record].short})` : ''}`);
  for (const w of warnings) console.log(`  ! ${w}`);
  console.log(`  Rev แรก = Rev.${firstRev}`);
  console.log(`  ปลายทาง: ${NAMES.folder} / ${NAMES.sub} / ${NAMES.file} · แดชบอร์ด "${NAMES.dashboard}"`);
  if (DRY) { console.log('\n[dry] ยังไม่ได้สร้างอะไร — รันอีกครั้งโดยไม่ใส่ --dry'); return; }

  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;

  const top = await folder(NAMES.folder, null, '#1552F0');
  const master = await folder(NAMES.sub, top, '#16A34A');
  const contents = await api('GET', `/folders/${master}/contents`).catch(() => null);
  if (contents?.files?.some((f: any) => f.name === NAMES.file)) {
    console.log(`• ไฟล์ "${NAMES.file}" มีอยู่แล้วใน ${NAMES.folder} / ${NAMES.sub} — หยุด (ไม่เขียนทับ) ลบไฟล์เดิมก่อนถ้าต้องการนำเข้าใหม่`);
    return;
  }

  // pictures first, so the rows are imported with them
  for (const p of pics) {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(p.data)], { type: p.mime }), p.file);
    const up = await api<{ url: string }>('POST', '/uploads/image', fd);
    records[p.record].images.push(up.url);
  }
  if (pics.length) console.log(`✓ อัปโหลดรูป ${pics.length} รูป`);

  const hasDateNote = records.some((r) => r.dateNote);
  const columns = [
    { name: COL.sub, dataType: 'varchar', isRequired: true, width: 120 },
    { name: COL.material, dataType: 'varchar', width: 200 },
    { name: COL.short, dataType: 'varchar', width: 190 },
    { name: COL.note, dataType: 'text', width: 460, description: 'สิ่งที่ต้องแจ้ง / ควบคุมในการผลิต' },
    { name: COL.images, dataType: 'image', width: 160 },
    { name: COL.date, dataType: 'date', width: 150, validation: { autoStamp: 'updatedAt' } },
    { name: COL.by, dataType: 'varchar', width: 140, validation: { autoStamp: 'updatedBy' } },
    ...(hasDateNote ? [{ name: COL.dateNote, dataType: 'text', width: 220, description: 'วันที่ที่ Excel เขียนเป็นข้อความ (หลายวันในช่องเดียว)' }] : []),
  ];
  const { id: fileId } = await api('POST', '/files', { name: NAMES.file, folderId: master, color: '#1552F0', description: `นำเข้าจาก ${path.basename(file)}`, sheets: [{ name: NAMES.sheet, columns }] });
  const f = await api('GET', `/files/${fileId}`);
  const sheetId: string = f.sheets[0].id;
  const cols = new Map<string, string>((await api('GET', `/sheets/${sheetId}`)).columns.map((c: any) => [c.name, c.id]));
  const id = (n: string) => cols.get(n)!;
  console.log(`✓ สร้างไฟล์ "${NAMES.file}" (${columns.length} คอลัมน์)`);

  let inserted = 0;
  const problems: any[] = [];
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500).map((r, k) => ({
      rowNo: i + k + 1,
      values: Object.fromEntries(Object.entries({
        [id(COL.sub)]: r.sub, [id(COL.material)]: r.material, [id(COL.short)]: r.short, [id(COL.note)]: r.note,
        [id(COL.images)]: r.images.length ? r.images : null, [id(COL.date)]: r.date, [id(COL.by)]: r.by,
        ...(hasDateNote ? { [id(COL.dateNote)]: r.dateNote } : {}),
      }).filter(([, v]) => v !== null && v !== undefined)),
    }));
    const res = await api('POST', `/sheets/${sheetId}/rows/import`, { rows: batch, skipInvalid: true });
    inserted += res.inserted ?? 0;
    problems.push(...(res.errors ?? []));
  }
  console.log(`✓ นำเข้า ${inserted} จาก ${records.length} แถว${problems.length ? ` — มีปัญหา ${problems.length} เซลล์:` : ''}`);
  for (const p of problems.slice(0, 30)) console.log(`  ! แถว ${p.rowNo} ${p.columnName}: ${p.message}`);

  await api('PUT', `/sheets/${sheetId}/revisions/settings`, { keyColumnIds: [id(COL.sub), id(COL.short)] });
  const rev = await api('POST', `/sheets/${sheetId}/revisions`, { note: `นำเข้าจาก Excel ${path.basename(file)}`, firstRevNo: firstRev });
  console.log(`✓ ออก Rev.${rev.revNo} (ข้อมูลตั้งต้น ${rev.rowCount} แถว)`);

  const dash = await api('POST', `/files/${fileId}/dashboards`, { name: NAMES.dashboard });
  const W = 1280;
  const widgets = [
    { id: crypto.randomUUID(), type: 'text', title: '', x: 24, y: 16, w: W - 48, h: 64, z: 1, locked: false, dataSource: null,
      config: { text: `QUALITY HIGHLIGHT${heading ? ` — ${heading}` : ''}`, fontSize: 24, fontWeight: 700, align: 'left', color: '#1552F0', valign: 'middle' },
      style: { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 4 } },
    { id: crypto.randomUUID(), type: 'records', title: 'ค้นหา Sub Doc No. / Short Code', x: 24, y: 96, w: 820, h: 760, z: 2, locked: false, dataSource: blankDs(sheetId),
      config: {
        searchColumnIds: [id(COL.sub), id(COL.short)], titleColumnIds: [id(COL.sub), id(COL.short), id(COL.material)],
        fieldColumnIds: [id(COL.note), id(COL.date), id(COL.by), ...(hasDateNote ? [id(COL.dateNote)] : [])], imageColumnId: id(COL.images),
        pageSize: 20, placeholder: 'พิมพ์ Sub Doc No. หรือ Short Code', showRev: true, fontSize: 14,
      },
      style: { showTitle: true } },
    { id: crypto.randomUUID(), type: 'revision', title: 'Rev ล่าสุด และสิ่งที่เปลี่ยน', x: 868, y: 96, w: W - 868 - 24, h: 760, z: 3, locked: false, dataSource: blankDs(sheetId),
      config: { limit: 10, fontSize: 13 }, style: { showTitle: true } },
  ];
  await api('PUT', `/dashboards/${dash.id}`, { name: NAMES.dashboard, canvas: { width: W, height: 880, gridSize: 8, snap: true }, background: { color: '#F4F6FB', imageUrl: null, fit: 'cover' }, widgets });
  console.log(`✓ สร้างแดชบอร์ด "${NAMES.dashboard}" → /files/${fileId}/dashboards/${dash.id}`);
  console.log('\nเสร็จ.');
}

if (require.main === module) main().catch((e) => { console.error('✗', e.message); process.exit(1); });
