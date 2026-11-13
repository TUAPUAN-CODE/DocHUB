/**
 * Notes written in a code line of the InkCode master database ("New Code 1/9/25 ตรวจ 100%", "Check ราคาจาก Mail PN") are printed
 * as if they had to be inked. This script:
 *   1) adds the column "Remark (ไม่ Ink)" to "InkCode - Master Database › ฐานข้อมูล" (when missing)
 *   2) moves every such line (rule isInkRemark in src/modules/inkcode/model.ts: starts with "New Code", or has Thai letters —
 *      whole lines only) from แบบโค้ดแถว 1-4 into that column (appended; nothing is deleted)
 *   3) adds the formula column "Remark (ไม่ Ink)" (looked up from the database) to every sheet under the folder InkCode that has
 *      "Code Format แถว 1" — the Worksheet, the day template and the day files already made — so the PDF prints it in the
 *      "หมายเหตุ (ไม่ Ink)" box under the code grid
 *
 *   npx ts-node --transpile-only scripts/fixInkCodeRemark.ts --dry     (only prints what it would move / add)
 *   npx ts-node --transpile-only scripts/fixInkCodeRemark.ts
 *        env: DOCHUB_URL=http://host:4000/api  DOCHUB_USER=<admin or master>  DOCHUB_PASSWORD=...
 *
 * Safe to run again (moved lines are no longer in the code columns; existing columns are not added twice).
 * Goes through the normal API: validation, the audit log and the cell history (undo) apply; the code lines of the sheets that
 * read the database are recalculated by the server.
 */
import { isInkRemark, REMARK_COL, remarkFormula, SHEETS, splitRemarks } from '../src/modules/inkcode/model';

const BASE = (process.env.DOCHUB_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');
const DRY = process.argv.includes('--dry');
const ROOT = 'InkCode', DB_FILE = 'InkCode - Master Database';
const TPL = [1, 2, 3, 4].map((n) => `แบบโค้ดแถว ${n}`);
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
  for (let p = 1; p <= 50; p++) {
    const r = await api('POST', `/sheets/${sheetId}/rows/query`, { page: p, pageSize: 1000, sorts: [], filters: [] });
    rows.push(...r.rows);
    if (r.rows.length < 1000) break;
  }
  return rows;
}

/** The file of that name in any folder under InkCode (the folders may have been moved / renamed — the file name is what counts) */
async function fileUnder(tree: any[], rootId: string, name: string): Promise<any> {
  const list = [rootId];
  for (let i = 0; i < list.length; i++) for (const f of tree) if (f.parentId === list[i]) list.push(f.id);
  for (const id of list) { const hit = (await api('GET', `/folders/${id}/contents`)).files.find((f: any) => f.name === name); if (hit) return hit; }
  return null;
}

async function main() {
  const user = process.env.DOCHUB_USER, password = process.env.DOCHUB_PASSWORD;
  if (!user || !password) throw new Error('ตั้ง DOCHUB_USER และ DOCHUB_PASSWORD (บัญชี master/admin)');
  token = (await api('POST', '/auth/login', { username: user, password })).accessToken;
  const tree = await api<any[]>('GET', '/folders/tree');
  const root = tree.find((f) => f.name === ROOT && !f.parentId);
  if (!root) throw new Error(`ไม่พบโฟลเดอร์ ${ROOT}`);
  const dbFile = await fileUnder(tree, root.id, DB_FILE);
  if (!dbFile) throw new Error(`ไม่พบไฟล์ "${DB_FILE}"`);
  const dbSheet = ((await api('GET', `/files/${dbFile.id}`)).sheets as { id: string; name: string }[]).find((s) => s.name === SHEETS.db);
  if (!dbSheet) throw new Error(`ไม่พบชีต "${SHEETS.db}"`);

  // 1) the column in the database
  let cols = await colMap(dbSheet.id);
  if (!cols.has(REMARK_COL)) {
    console.log(`${DRY ? '[dry] ' : '+ '}คอลัมน์ "${REMARK_COL}" ในชีต ${SHEETS.db}`);
    if (!DRY) {
      await api('POST', `/sheets/${dbSheet.id}/columns`, { name: REMARK_COL, dataType: 'text', width: 260, isRequired: false, description: 'หมายเหตุของโค้ด เช่น New Code 1/9/25 ตรวจ 100% — ไม่ถูก Ink (ไม่ลงช่องตำแหน่ง/QR) แสดงในกล่องหมายเหตุใต้ตารางใน PDF' });
      cols = await colMap(dbSheet.id);
    }
  }
  const missing = TPL.filter((n) => !cols.has(n));
  if (missing.length) throw new Error(`ชีต ${SHEETS.db} ไม่มีคอลัมน์ ${missing.join(', ')}`);

  // 2) move the note lines
  const updates: { rowId: string; columnId: string; value: unknown }[] = [];
  const seen = new Map<string, number>();
  let rowsMoved = 0;
  for (const r of await allRows(dbSheet.id)) {
    const byName: Record<string, unknown> = {};
    for (const n of [...TPL, REMARK_COL]) byName[n] = cols.has(n) ? r.values[cols.get(n)!] : null;
    const { moved, next } = splitRemarks(byName);
    if (!moved.length) continue;
    rowsMoved++;
    for (const m of moved) seen.set(m, (seen.get(m) ?? 0) + 1);
    for (const n of TPL) if (isInkRemark(byName[n])) updates.push({ rowId: r.id, columnId: cols.get(n)!, value: null });
    if (cols.has(REMARK_COL)) updates.push({ rowId: r.id, columnId: cols.get(REMARK_COL)!, value: next[REMARK_COL] });
  }
  console.log(`ย้ายบรรทัดหมายเหตุ: ${rowsMoved} แถว · ข้อความต่างกัน ${seen.size} แบบ`);
  for (const [t, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)} × ${t}`);
  if (!DRY) for (let i = 0; i < updates.length; i += 1000) await api('POST', `/sheets/${dbSheet.id}/cells/bulk`, { updates: updates.slice(i, i + 1000), source: 'edit' });

  // 3) the looked-up column in every sheet that prints code lines
  const under = new Set<string>([root.id]);
  for (let grew = true; grew;) { grew = false; for (const f of tree) if (f.parentId && under.has(f.parentId) && !under.has(f.id)) { under.add(f.id); grew = true; } }
  const def = remarkFormula();
  let added = 0;
  for (const folderId of under) {
    for (const file of (await api('GET', `/folders/${folderId}/contents`)).files ?? []) {
      for (const sh of (await api('GET', `/files/${file.id}`)).sheets as { id: string; name: string }[]) {
        const c = await colMap(sh.id);
        if (!c.has('Code Format แถว 1') || !c.has('Link') || c.has(REMARK_COL)) continue;
        console.log(`${DRY ? '[dry] ' : '+ '}สูตร "${REMARK_COL}" → ${file.name} › ${sh.name}`);
        added++;
        if (!DRY) await api('POST', `/sheets/${sh.id}/columns`, { name: def.name, dataType: def.type, width: def.width, isRequired: false, validation: { formula: { expr: def.formula!.expr, sources: [{ alias: SHEETS.db, sheetId: dbSheet.id }] } } });
      }
    }
  }
  console.log(`${DRY ? '[dry] ' : '✓ '}เสร็จ — ย้าย ${rowsMoved} แถว · เพิ่มคอลัมน์ในชีตงาน ${added} ชีต`);
}
main().catch((e) => { console.error('\n✗', e.message); process.exitCode = 1; });
