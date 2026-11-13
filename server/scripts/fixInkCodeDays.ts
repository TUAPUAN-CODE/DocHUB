/**
 * Day folders for the InkCode day files: under each plant folder (PF1 / PF2, wherever it is under "InkCode") makes
 *     <ปี> / <MM เดือน> / <DD>        e.g.  PF1 / 2027 / 01 มกราคม / 01 … 31
 * for every year asked, moves the day files already made (2026-10-03, which used to sit in the month folder) into their day folder,
 * and makes "แผนผลิต / <ปี> / <MM เดือน>" (the folders where plan files are dropped) for the same years.
 * New day files are made in the day folder by the plan import itself (src/modules/inkcode/auto.ts).
 *
 *   npx ts-node --transpile-only scripts/fixInkCodeDays.ts --from 2026 --to 2027 --dry
 *   npx ts-node --transpile-only scripts/fixInkCodeDays.ts --from 2026 --to 2027
 *        env: DOCHUB_URL=http://host:4000/api  DOCHUB_USER=<admin or master>  DOCHUB_PASSWORD=...
 *
 * Safe to run again: only missing folders are made, nothing is deleted or renamed. Goes through the normal API (audit log applies).
 */
import { monthFolderName, TREE } from '../src/modules/inkcode/model';

const BASE = (process.env.DOCHUB_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');
const DRY = process.argv.includes('--dry');
const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const FROM = arg('--from', new Date().getFullYear()), TO = arg('--to', FROM);
let token = '';
async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429 && attempt < 20) { await new Promise((s) => setTimeout(s, 3000 * Math.min(attempt + 1, 5))); continue; }
    if (!r.ok || j.success === false) throw new Error(`${method} ${url} → ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
    return j.data as T;
  }
}

type F = { id: string; name: string; parentId: string | null };
let tree: F[] = [];
let made = 0;
const child = (parentId: string, name: string) => tree.find((f) => f.parentId === parentId && f.name.trim() === name);
async function ensure(parentId: string, name: string, label: string): Promise<string> {
  const have = child(parentId, name);
  if (have) return have.id;
  made++;
  if (DRY) { const id = `dry-${made}`; tree.push({ id, name, parentId }); return id; }
  const f = await api('POST', '/folders', { name, parentId });
  tree.push({ id: f.id, name, parentId });
  if (made % 50 === 0) process.stdout.write(`\r  สร้างแล้ว ${made} โฟลเดอร์ (${label})   `);
  return f.id;
}
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();
const p2 = (n: number) => String(n).padStart(2, '0');

async function main() {
  if (!(FROM >= 2000 && TO >= FROM && TO - FROM < 20)) throw new Error('ใช้ --from <ปี> --to <ปี> เช่น --from 2026 --to 2027');
  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;
  tree = (await api<any[]>('GET', '/folders/tree')).map((f) => ({ id: f.id, name: String(f.name), parentId: f.parentId ?? null }));
  const root = tree.find((f) => f.name === TREE.root && !f.parentId);
  if (!root) throw new Error(`ไม่พบโฟลเดอร์ ${TREE.root}`);
  const under: F[] = [root];
  for (let i = 0; i < under.length; i++) for (const f of tree) if (f.parentId === under[i].id) under.push(f);
  const pathOf = (f: F) => { const out: string[] = []; for (let p = f.parentId; p;) { const x = tree.find((y) => y.id === p); if (!x) break; out.push(x.name.trim()); p = x.parentId; } return out; };

  // plant folders (not inside the plan-drop folders)
  const plants = TREE.plants.map((pl) => ({ pl, f: under.find((f) => f.name.trim().toUpperCase() === pl && !pathOf(f).includes(TREE.plans)) }));
  for (const { pl, f } of plants) if (!f) console.log(`! ไม่พบโฟลเดอร์ ${pl} ใต้ ${TREE.root} — ข้าม`);
  let moved = 0;
  for (const { pl, f } of plants) {
    if (!f) continue;
    for (let y = FROM; y <= TO; y++) {
      const yId = await ensure(f.id, String(y), `${pl} ${y}`);
      for (let m = 1; m <= 12; m++) {
        const mId = await ensure(yId, monthFolderName(m), `${pl} ${y}`);
        for (let d = 1; d <= daysIn(y, m); d++) await ensure(mId, p2(d), `${pl} ${y}`);
        // day files made before day folders existed: <month folder>/YYYY-MM-DD → <month folder>/<DD>/YYYY-MM-DD
        if (mId.startsWith('dry-')) continue;
        const files = (await api('GET', `/folders/${mId}/contents`)).files as { id: string; name: string }[];
        for (const file of files) {
          const hit = new RegExp(`^${y}-${p2(m)}-(\\d{2})$`).exec(file.name.trim());
          if (!hit) continue;
          const dId = child(mId, hit[1]) ? child(mId, hit[1])!.id : await ensure(mId, hit[1], `${pl} ${y}`);
          console.log(`\r${DRY ? '[dry] ' : '→ '}ย้าย ${pl} / ${y} / ${monthFolderName(m)} / ${file.name} → โฟลเดอร์ ${hit[1]}`);
          if (!DRY) await api('POST', `/files/${file.id}/move`, { folderId: dId });
          moved++;
        }
      }
    }
  }
  // plan-drop folders: แผนผลิต / <year> / <month>
  const plans = under.find((f) => f.name.trim() === TREE.plans);
  if (plans) for (let y = FROM; y <= TO; y++) { const yId = await ensure(plans.id, String(y), `${TREE.plans} ${y}`); for (let m = 1; m <= 12; m++) await ensure(yId, monthFolderName(m), `${TREE.plans} ${y}`); }
  else console.log(`! ไม่พบโฟลเดอร์ ${TREE.plans} ใต้ ${TREE.root} — ไม่ได้สร้างโฟลเดอร์ปีของแผนผลิต`);
  console.log(`\r${DRY ? '[dry] ' : '✓ '}เสร็จ — ${DRY ? 'จะสร้าง' : 'สร้าง'} ${made} โฟลเดอร์ · ${DRY ? 'จะย้าย' : 'ย้าย'}ไฟล์รายวัน ${moved} ไฟล์ (ปี ${FROM}–${TO})`);
}
main().catch((e) => { console.error('\n✗', e.message); process.exitCode = 1; });
