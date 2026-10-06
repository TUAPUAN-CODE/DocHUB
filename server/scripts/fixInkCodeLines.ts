/**
 * Sets the plant (PF1 / PF2) and the area (Pouch / Can / Cup / …) of every production line in the line table
 * ("InkCode - รหัสอ้างอิง" › ไลน์) from the factory's rule (LINE_SPEC in src/modules/inkcode/model.ts), and adds the lines that are missing
 * (Can A, Spout 1-3, Pouch PF2 ชั้นบน). It adds the columns "โรงงาน" and "พื้นที่" when the sheet does not have them and writes only those
 * two columns — the old "Plant" / "รหัสไลน์" columns (they feed the code text) are not touched.
 *
 *   npx ts-node --transpile-only scripts/fixInkCodeLines.ts [--dry]
 *        env: DOCHUB_URL=http://host:4000/api  DOCHUB_USER=<admin or master>  DOCHUB_PASSWORD=...
 *
 * Safe to run again (only differences are written). Goes through the normal API: validation and the audit log apply.
 */
import { LINE_SPEC, SHEETS } from '../src/modules/inkcode/model';

const BASE = (process.env.DOCHUB_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');
const DRY = process.argv.includes('--dry');
const REF_FILE = 'InkCode - รหัสอ้างอิง', ROOT = 'InkCode';
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

async function main() {
  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;
  const root = (await api<any[]>('GET', '/folders/tree')).find((f) => f.name === ROOT && !f.parentId);
  if (!root) throw new Error(`ไม่พบโฟลเดอร์ ${ROOT}`);
  const file = (await api('GET', `/folders/${root.id}/contents`)).files.find((f: any) => f.name === REF_FILE);
  if (!file) throw new Error(`ไม่พบไฟล์ "${REF_FILE}"`);
  const sheet = (await api('GET', `/files/${file.id}`)).sheets.find((s: any) => s.name === SHEETS.line);
  if (!sheet) throw new Error(`ไม่พบชีต "${SHEETS.line}"`);

  let cols: Map<string, string> = new Map((await api('GET', `/sheets/${sheet.id}`)).columns.map((c: any) => [c.name, c.id]));
  if (!cols.has('ไลน์')) throw new Error('ชีตไลน์ไม่มีคอลัมน์ "ไลน์"');
  for (const name of ['โรงงาน', 'พื้นที่']) {
    if (cols.has(name)) continue;
    console.log(`${DRY ? '[dry] ' : '+ '}เพิ่มคอลัมน์ "${name}"`);
    if (!DRY) await api('POST', `/sheets/${sheet.id}/columns`, { name, dataType: 'varchar', width: 100, isRequired: false });
  }
  if (!DRY) cols = new Map((await api('GET', `/sheets/${sheet.id}`)).columns.map((c: any) => [c.name, c.id]));
  const cLine = cols.get('ไลน์')!, cPlant = cols.get('โรงงาน'), cArea = cols.get('พื้นที่');

  const rows: { id: string; values: Record<string, unknown> }[] = [];
  for (let p = 1; p <= 20; p++) {
    const r = await api('POST', `/sheets/${sheet.id}/rows/query`, { page: p, pageSize: 1000, sorts: [], filters: [] });
    rows.push(...r.rows);
    if (r.rows.length < 1000) break;
  }
  const byLine = new Map(rows.map((r) => [String(r.values[cLine] ?? '').trim().toLowerCase(), r]));
  const updates: { rowId: string; columnId: string; value: string }[] = [];
  const adds: string[] = [];
  for (const sp of LINE_SPEC) {
    const row = byLine.get(sp.line.toLowerCase());
    if (!row) { adds.push(sp.line); continue; }
    if (cPlant && row.values[cPlant] !== sp.plant) updates.push({ rowId: row.id, columnId: cPlant, value: sp.plant });
    if (cArea && row.values[cArea] !== sp.area) updates.push({ rowId: row.id, columnId: cArea, value: sp.area });
  }
  console.log(`ไลน์ในตาราง ${rows.length} · ตามกติกา ${LINE_SPEC.length} · ต้องเพิ่ม ${adds.length}${adds.length ? ` (${adds.join(', ')})` : ''} · เซลล์ที่ต้องแก้ ${updates.length}`);
  const known = new Set(LINE_SPEC.map((s) => s.line.toLowerCase()));
  const left = rows.map((r) => String(r.values[cLine] ?? '').trim()).filter((n) => n && !known.has(n.toLowerCase()));
  if (left.length) console.log(`! ไลน์ที่ไม่อยู่ในกติกา (ไม่แตะ): ${left.join(', ')}`);
  if (DRY) return;

  for (const name of adds) {
    const sp = LINE_SPEC.find((s) => s.line === name)!;
    await api('POST', `/sheets/${sheet.id}/rows`, { values: { [cLine]: sp.line, ...(cPlant ? { [cPlant]: sp.plant } : {}), ...(cArea ? { [cArea]: sp.area } : {}) } });
    console.log(`+ เพิ่มไลน์ ${name} (${sp.plant} / ${sp.area})`);
  }
  for (let i = 0; i < updates.length; i += 500) await api('POST', `/sheets/${sheet.id}/cells/bulk`, { updates: updates.slice(i, i + 500), source: 'edit' });
  console.log(`✓ เสร็จ — เพิ่ม ${adds.length} ไลน์ แก้ ${updates.length} เซลล์`);
}
main().catch((e) => { console.error('\n✗', e.message); process.exitCode = 1; });
