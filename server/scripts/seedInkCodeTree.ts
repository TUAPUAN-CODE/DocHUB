/**
 * Builds the working tree of InkCode inside the existing "InkCode" folder:
 *
 *   InkCode / InkCode - ใบออกโค้ด / PF1 | PF2 / <ปี> / "<ปี>-<เดือน> <ชื่อเดือน>" (1 ไฟล์ต่อเดือน)  →  ชีต "01" … "31" (1 ชีตต่อวัน)
 *
 * Every day sheet is a copy of the Worksheet of "InkCode - ใบออกโค้ดนอกแผน" (same columns, formulas and drop-downs, no rows).
 * All files of the tree then use the PDF layouts of that file (master) — edit the layout there once and every file follows.
 *
 *   npx ts-node --transpile-only scripts/seedInkCodeTree.ts [--from 2026] [--to 2036] [--plants PF1,PF2] [--dry]
 *        env: DOCHUB_URL=http://host:4000/api  DOCHUB_USER=<admin or master>  DOCHUB_PASSWORD=...
 *
 * Needs the files made by seedInkCode.ts first. Safe to run again: folders / files that exist are skipped, so a run that was
 * stopped half way continues where it ended (and a later `--to` adds more years). Nothing is deleted or overwritten.
 * The month files are made from 4 templates (28 / 29 / 30 / 31 days) kept in "InkCode - ใบออกโค้ด / แม่แบบรายเดือน".
 */
const BASE = (process.env.DOCHUB_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const FROM = Number(arg('from', '2026')), TO = Number(arg('to', '2036'));
const PLANTS = arg('plants', 'PF1,PF2').split(',').map((s) => s.trim()).filter(Boolean);
const ROOT = 'InkCode', TREE = 'InkCode - ใบออกโค้ด', TEMPLATES = 'แม่แบบรายเดือน', MASTER_FILE = 'InkCode - ใบออกโค้ดนอกแผน', MASTER_SHEET = 'Worksheet';
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const pad = (n: number) => String(n).padStart(2, '0');
export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthFileName = (y: number, m: number) => `${y}-${pad(m)} ${MONTHS[m - 1]}`;

let token = '';
async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429 && attempt < 8) { await new Promise((s) => setTimeout(s, 3000 * (attempt + 1))); continue; }
    if (!r.ok || j.success === false) throw new Error(`${method} ${url} → ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
    return j.data as T;
  }
}

const contents = (folderId: string) => api<{ subfolders: { id: string; name: string }[]; files: { id: string; name: string }[] }>('GET', `/folders/${folderId}/contents`);
async function folder(parentId: string | null, name: string, desc?: string): Promise<string> {
  if (DRY) { console.log(`[dry] โฟลเดอร์ ${name}`); return `dry-${name}`; }
  const siblings = parentId ? (await contents(parentId)).subfolders : (await api<any[]>('GET', '/folders/tree')).filter((f) => !f.parentId);
  const hit = siblings.find((f) => f.name === name);
  if (hit) return hit.id;
  const f = await api('POST', '/folders', { name, parentId, description: desc ?? null, color: '#1552F0' });
  console.log(`✓ โฟลเดอร์ ${name}`);
  return f.id;
}

/** Month template with `days` sheets named "01" … : a copy of the Worksheet file, its sheet renamed and copied (structure only) */
async function monthTemplate(folderId: string, masterFileId: string, days: number): Promise<string> {
  const name = `แม่แบบ ${days} วัน`;
  const have = (await contents(folderId)).files.find((f) => f.name === name);
  if (have) return have.id;
  const { id } = await api('POST', `/files/${masterFileId}/duplicate`, { name, folderId, includeData: false });
  const f = await api('GET', `/files/${id}`);
  const first = f.sheets.find((s: any) => s.name === MASTER_SHEET) ?? f.sheets[0];
  await api('PUT', `/sheets/${first.id}`, { name: '01' });
  for (let d = 2; d <= days; d++) await api('POST', `/files/${id}/sheets`, { name: pad(d), copyStructureFrom: first.id });
  console.log(`✓ แม่แบบ ${days} วัน`);
  return id;
}

async function main() {
  if (!Number.isInteger(FROM) || !Number.isInteger(TO) || FROM > TO || FROM < 2000 || TO > 2100) throw new Error('--from / --to ไม่ถูกต้อง');
  const nMonths = (TO - FROM + 1) * 12 * PLANTS.length;
  if (DRY) {
    console.log(`[dry] ${PLANTS.join(', ')} × ปี ${FROM}–${TO} = ${nMonths} ไฟล์รายเดือน (ชีตรายวันรวมประมาณ ${Math.round(nMonths * 30.4).toLocaleString()} ชีต)`);
    console.log(`[dry] ตัวอย่างชื่อไฟล์: ${monthFileName(FROM, 1)} … ${monthFileName(TO, 12)} · กุมภาพันธ์ ${FROM}: ${daysIn(FROM, 2)} วัน`);
    return;
  }
  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;

  const root = await folder(null, ROOT);
  const master = (await contents(root)).files.find((f) => f.name === MASTER_FILE);
  if (!master) throw new Error(`ไม่พบไฟล์ "${MASTER_FILE}" ในโฟลเดอร์ ${ROOT} — รัน seedInkCode.ts ก่อน`);
  const masterSheets = (await api('GET', `/files/${master.id}`)).sheets as { id: string; name: string }[];
  if (!masterSheets.some((s) => s.name === MASTER_SHEET)) throw new Error(`ไฟล์ "${MASTER_FILE}" ไม่มีชีต "${MASTER_SHEET}"`);

  const tree = await folder(root, TREE, 'ใบออกโค้ดนอกแผน แยกโรงงาน › ปี › เดือน (1 ไฟล์) › วัน (1 ชีต)');
  const tplFolder = await folder(tree, TEMPLATES, 'แม่แบบที่ใช้สร้างไฟล์รายเดือน — ห้ามลบ (ใช้สร้างปีถัดไป)');
  const tpl = new Map<number, string>();
  let made = 0, skipped = 0;
  for (const plant of PLANTS) {
    const pf = await folder(tree, plant);
    for (let y = FROM; y <= TO; y++) {
      const yf = await folder(pf, String(y));
      const existing = new Set((await contents(yf)).files.map((f) => f.name));
      for (let m = 1; m <= 12; m++) {
        const name = monthFileName(y, m);
        if (existing.has(name)) { skipped++; continue; }
        const days = daysIn(y, m);
        if (!tpl.has(days)) tpl.set(days, await monthTemplate(tplFolder, master.id, days));
        await api('POST', `/files/${tpl.get(days)}/duplicate`, { name, folderId: yf, includeData: false });
        made++;
        process.stdout.write(`\r  ${plant} ${y}: ${name} (${made} ไฟล์ใหม่)   `);
      }
    }
    console.log(`\n✓ ${plant} เสร็จ`);
  }
  // one layout for the whole tree: the PDF layouts of the Worksheet file
  const r = await api('POST', `/folders/${tree}/pdf-master`, { masterFileId: master.id });
  console.log(`\nเสร็จ — สร้างไฟล์รายเดือนใหม่ ${made} ไฟล์ (มีอยู่แล้ว ${skipped}) · ตั้งรูปแบบ PDF กลางให้ ${r.files} ไฟล์ (แก้ที่ "${MASTER_FILE}" ที่เดียว ทุกไฟล์เปลี่ยนตาม)`);
}
main().catch((e) => { console.error('\n✗', e.message); process.exitCode = 1; });
