/**
 * Builds the working tree of InkCode inside the existing "InkCode" folder:
 *
 *   InkCode / InkCode - ใบออกโค้ด / PF1 | PF2 / <ปี> / <เดือน> (โฟลเดอร์)  →  <YYYY-MM-DD> (1 ไฟล์ต่อวัน)  →  ชีต Pouch | Can | Cup | อื่นๆ
 *   InkCode / InkCode - ใบออกโค้ด / แม่แบบ / แม่แบบรายวัน   (ไฟล์ต้นแบบของไฟล์รายวัน)
 *
 * The day files are NOT all made up front: the first plan imported for a date creates its day file from the template (see
 * "นำเข้าแผนผลิต" in the menu, or the drop folder below). `--pre YYYY-MM` makes every day file of that month now.
 * Every file of the tree uses the PDF layouts of "InkCode - ใบออกโค้ดนอกแผน" (edit them there once).
 *
 *   npx ts-node --transpile-only scripts/seedInkCodeTree.ts [--from 2026] [--to 2036] [--plants PF1,PF2] [--pre 2026-10] [--plan-dir D:\InkCodePlans] [--dry]
 *        env: DOCHUB_URL=http://host:4000/api  DOCHUB_USER=<admin or master>  DOCHUB_PASSWORD=...
 *
 * `--plan-dir` also makes the drop folders  <plan-dir>\<ปี>\<เดือน>  on this computer for the plan files (set INKCODE_PLAN_DIR /
 * INKCODE_PLAN_USER in the server .env to import what is dropped there by itself).
 * Needs the files made by seedInkCode.ts first. Safe to run again: what exists is skipped, nothing is deleted or overwritten.
 */
import fs from 'fs';
import path from 'path';
import { AREAS, monthFolderName, TREE } from '../src/modules/inkcode/model';

const BASE = (process.env.DOCHUB_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry');
const FROM = Number(arg('from', '2026')), TO = Number(arg('to', '2036'));
const PLANTS = arg('plants', 'PF1,PF2').split(',').map((s) => s.trim()).filter(Boolean);
const PRE = arg('pre', '');
const PLAN_DIR = arg('plan-dir', '');
const MASTER_FILE = 'InkCode - ใบออกโค้ดนอกแผน', MASTER_SHEET = 'Worksheet';
const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

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
  const siblings = parentId ? (await contents(parentId)).subfolders : (await api<any[]>('GET', '/folders/tree')).filter((f) => !f.parentId);
  const hit = siblings.find((f) => f.name === name);
  if (hit) return hit.id;
  const f = await api('POST', '/folders', { name, parentId, description: desc ?? null, color: '#1552F0' });
  console.log(`✓ โฟลเดอร์ ${name}`);
  return f.id;
}

/** Day template: a copy of the Worksheet file whose sheet is renamed to the first area and copied (structure only) for the others */
async function dayTemplate(folderId: string, masterFileId: string): Promise<string> {
  const have = (await contents(folderId)).files.find((f) => f.name === TREE.dayTemplate);
  if (have) return have.id;
  const { id } = await api('POST', `/files/${masterFileId}/duplicate`, { name: TREE.dayTemplate, folderId, includeData: false });
  const f = await api('GET', `/files/${id}`);
  const first = f.sheets.find((s: any) => s.name === MASTER_SHEET) ?? f.sheets[0];
  await api('PUT', `/sheets/${first.id}`, { name: AREAS[0] });
  for (const area of AREAS.slice(1)) await api('POST', `/files/${id}/sheets`, { name: area, copyStructureFrom: first.id });
  console.log(`✓ ไฟล์แม่แบบ "${TREE.dayTemplate}" (ชีต ${AREAS.join(', ')})`);
  return id;
}

async function main() {
  if (!Number.isInteger(FROM) || !Number.isInteger(TO) || FROM > TO || FROM < 2000 || TO > 2100) throw new Error('--from / --to ไม่ถูกต้อง');
  if (PRE && !/^\d{4}-\d{2}$/.test(PRE)) throw new Error('--pre ต้องเป็น YYYY-MM เช่น 2026-10');
  const nFolders = PLANTS.length * (TO - FROM + 1) * 13;
  if (DRY) {
    console.log(`[dry] ${PLANTS.join(', ')} × ปี ${FROM}–${TO} = ${nFolders} โฟลเดอร์ (ปี + 12 เดือน) · ไฟล์รายวันสร้างเมื่อนำเข้าแผน${PRE ? ` · สร้างล่วงหน้าเดือน ${PRE}` : ''}`);
    console.log(`[dry] ตัวอย่าง: ${TREE.tree} / ${PLANTS[0]} / ${FROM} / ${monthFolderName(10)} / ${FROM}-10-03 › ชีต ${AREAS.join(' | ')}`);
    if (PLAN_DIR) console.log(`[dry] โฟลเดอร์วางแผน: ${PLAN_DIR}\\${FROM}\\${monthFolderName(1)} …`);
    return;
  }
  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;

  const root = await folder(null, TREE.root);
  const master = (await contents(root)).files.find((f) => f.name === MASTER_FILE);
  if (!master) throw new Error(`ไม่พบไฟล์ "${MASTER_FILE}" ในโฟลเดอร์ ${TREE.root} — รัน seedInkCode.ts ก่อน`);
  const masterSheets = (await api('GET', `/files/${master.id}`)).sheets as { id: string; name: string }[];
  if (!masterSheets.some((s) => s.name === MASTER_SHEET)) throw new Error(`ไฟล์ "${MASTER_FILE}" ไม่มีชีต "${MASTER_SHEET}"`);

  const tree = await folder(root, TREE.tree, 'ใบออกโค้ดนอกแผน แยกโรงงาน › ปี › เดือน › วัน (1 ไฟล์) › พื้นที่ (1 ชีต)');
  const tplFolder = await folder(tree, TREE.templateFolder, 'ไฟล์แม่แบบของไฟล์รายวัน — ห้ามลบ');
  const tpl = await dayTemplate(tplFolder, master.id);
  // the template (and so every day file made from it) follows the PDF layouts of the Worksheet file
  await api('POST', `/files/${tpl}/pdf-templates/master`, { masterFileId: master.id });

  const monthIds = new Map<string, string>();   // "PF1/2026/10" → folder id
  for (const plant of PLANTS) {
    const pf = await folder(tree, plant);
    for (let y = FROM; y <= TO; y++) {
      const yf = await folder(pf, String(y));
      for (let m = 1; m <= 12; m++) monthIds.set(`${plant}/${y}/${m}`, await folder(yf, monthFolderName(m)));
    }
    console.log(`✓ ${plant}: โฟลเดอร์ปี/เดือน ${FROM}–${TO}`);
  }

  if (PRE) {
    const [y, m] = PRE.split('-').map(Number);
    let made = 0;
    for (const plant of PLANTS) {
      const mf = monthIds.get(`${plant}/${y}/${m}`);
      if (!mf) { console.log(`• ข้าม ${plant} ${PRE} (นอกช่วง --from/--to)`); continue; }
      const have = new Set((await contents(mf)).files.map((f) => f.name));
      for (let d = 1; d <= daysIn(y, m); d++) {
        const name = `${y}-${pad(m)}-${pad(d)}`;
        if (have.has(name)) continue;
        await api('POST', `/files/${tpl}/duplicate`, { name, folderId: mf, includeData: false });
        made++; process.stdout.write(`\r  ${plant} ${name} (${made} ไฟล์ใหม่)   `);
      }
    }
    console.log(`\n✓ สร้างไฟล์รายวันล่วงหน้า ${made} ไฟล์`);
  }

  if (PLAN_DIR) {
    let dirs = 0;
    for (let y = FROM; y <= TO; y++) for (let m = 1; m <= 12; m++) { const d = path.join(PLAN_DIR, String(y), monthFolderName(m)); if (!fs.existsSync(d)) { fs.mkdirSync(d, { recursive: true }); dirs++; } }
    console.log(`✓ โฟลเดอร์วางไฟล์แผนผลิต ${PLAN_DIR} (สร้างใหม่ ${dirs} โฟลเดอร์)`);
  }

  const r = await api('POST', `/folders/${tree}/pdf-master`, { masterFileId: master.id });
  console.log(`\nเสร็จ — รูปแบบ PDF กลางตั้งให้ ${r.files} ไฟล์ (แก้ที่ "${MASTER_FILE}" ที่เดียว ทุกไฟล์เปลี่ยนตาม)`);
}
main().catch((e) => { console.error('\n✗', e.message); process.exitCode = 1; });
