/**
 * Puts the factory's rule "which plant (PF1 / PF2) and which area (Pouch / Can / Cup) is each production line" into the sheet
 * "ตั้งค่าไลน์" of "InkCode - รหัสอ้างอิง" (made here when it does not exist) and adds the lines that are missing from the sheet "ไลน์"
 * (Can A, Spout 1-3, Pouch PF2 ชั้นบน) so they appear in the drop-downs. The plan import reads the plant / area from "ตั้งค่าไลน์".
 * The rule is LINE_SPEC in src/modules/inkcode/model.ts. Existing columns of "ไลน์" (Plant, รหัสไลน์ …, they feed the code text) are not touched.
 *
 *   npx ts-node --transpile-only scripts/fixInkCodeLines.ts [--dry]
 *        env: DOCHUB_URL=http://host:4000/api  DOCHUB_USER=<admin or master>  DOCHUB_PASSWORD=...
 *
 * Safe to run again (only differences are written). Goes through the normal API: validation and the audit log apply.
 */
import { LINE_SPEC, REF_SHEETS, SHEETS } from '../src/modules/inkcode/model';

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
const colMap = async (sheetId: string): Promise<Map<string, string>> => new Map((await api('GET', `/sheets/${sheetId}`)).columns.map((c: any) => [c.name, c.id]));
async function allRows(sheetId: string) {
  const rows: { id: string; values: Record<string, unknown> }[] = [];
  for (let p = 1; p <= 20; p++) {
    const r = await api('POST', `/sheets/${sheetId}/rows/query`, { page: p, pageSize: 1000, sorts: [], filters: [] });
    rows.push(...r.rows);
    if (r.rows.length < 1000) break;
  }
  return rows;
}

async function main() {
  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;
  const root = (await api<any[]>('GET', '/folders/tree')).find((f) => f.name === ROOT && !f.parentId);
  if (!root) throw new Error(`ไม่พบโฟลเดอร์ ${ROOT}`);
  const file = (await api('GET', `/folders/${root.id}/contents`)).files.find((f: any) => f.name === REF_FILE);
  if (!file) throw new Error(`ไม่พบไฟล์ "${REF_FILE}"`);
  let sheets = (await api('GET', `/files/${file.id}`)).sheets as { id: string; name: string }[];
  const lineSheet = sheets.find((s) => s.name === SHEETS.line);
  if (!lineSheet) throw new Error(`ไม่พบชีต "${SHEETS.line}"`);

  // 1) the sheet "ตั้งค่าไลน์"
  let setup = sheets.find((s) => s.name === SHEETS.lineSetup);
  if (!setup) {
    console.log(`${DRY ? '[dry] ' : '+ '}สร้างชีต "${SHEETS.lineSetup}" ในไฟล์ ${REF_FILE}`);
    if (!DRY) {
      const def = REF_SHEETS.find((s) => s.name === SHEETS.lineSetup)!;
      const columns = def.columns.map((c) => ({ name: c.name, dataType: c.type, width: c.width ?? 140, isRequired: !!c.required, ...(c.options ? { options: c.options.map((o) => ({ value: o, label: o })) } : {}) }));
      setup = await api('POST', `/files/${file.id}/sheets`, { name: SHEETS.lineSetup, columns });
    }
  }
  const setupCols = setup ? await colMap(setup.id) : new Map<string, string>();
  const setupRows = setup ? await allRows(setup.id) : [];
  const cl = setupCols.get('ไลน์'), cp = setupCols.get('โรงงาน'), ca = setupCols.get('พื้นที่');
  const byLine = new Map(setupRows.map((r) => [String(r.values[cl ?? ''] ?? '').trim().toLowerCase(), r]));
  const updates: { rowId: string; columnId: string; value: string }[] = [];
  const addSetup: typeof LINE_SPEC = [];
  for (const sp of LINE_SPEC) {
    const row = byLine.get(sp.line.toLowerCase());
    if (!row) { addSetup.push(sp); continue; }
    if (cp && row.values[cp] !== sp.plant) updates.push({ rowId: row.id, columnId: cp, value: sp.plant });
    if (ca && row.values[ca] !== sp.area) updates.push({ rowId: row.id, columnId: ca, value: sp.area });
  }

  // 2) lines missing from the "ไลน์" sheet (names only — the code letters of the old table are not invented)
  const lcols = await colMap(lineSheet.id);
  const lineRows = await allRows(lineSheet.id);
  const have = new Set(lineRows.map((r) => String(r.values[lcols.get('ไลน์')!] ?? '').trim().toLowerCase()));
  const addLines = LINE_SPEC.filter((s) => !have.has(s.line.toLowerCase()));

  console.log(`ตั้งค่าไลน์: เพิ่ม ${addSetup.length} แถว แก้ ${updates.length} เซลล์ · ชีตไลน์: เพิ่ม ${addLines.length} ไลน์${addLines.length ? ` (${addLines.map((l) => l.line).join(', ')})` : ''}`);
  const known = new Set(LINE_SPEC.map((s) => s.line.toLowerCase()));
  const left = lineRows.map((r) => String(r.values[lcols.get('ไลน์')!] ?? '').trim()).filter((n) => n && !known.has(n.toLowerCase()));
  if (left.length) console.log(`! ไลน์ในตารางที่ไม่อยู่ในกติกา (ไม่แตะ — ระบบเดาพื้นที่จากชื่อ และข้ามแถวถ้าไม่ทราบโรงงาน): ${left.join(', ')}`);
  if (DRY) return;

  for (const sp of addSetup) await api('POST', `/sheets/${setup!.id}/rows`, { values: { [cl!]: sp.line, [cp!]: sp.plant, [ca!]: sp.area } });
  for (let i = 0; i < updates.length; i += 500) await api('POST', `/sheets/${setup!.id}/cells/bulk`, { updates: updates.slice(i, i + 500), source: 'edit' });
  for (const l of addLines) { await api('POST', `/sheets/${lineSheet.id}/rows`, { values: { [lcols.get('ไลน์')!]: l.line } }); console.log(`+ ไลน์ ${l.line}`); }
  console.log(`✓ เสร็จ — ตั้งค่าไลน์ +${addSetup.length}/แก้ ${updates.length} · ไลน์ใหม่ ${addLines.length}`);
}
main().catch((e) => { console.error('\n✗', e.message); process.exitCode = 1; });
