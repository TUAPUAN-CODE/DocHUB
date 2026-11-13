import fs from 'fs';
import path from 'path';
import { q1, T } from '../../config/db';
import { loadAuthUser } from '../../middleware/auth';
import { logger } from '../../shared/logger';
import { importAuto } from './auto';

/**
 * Drop folder for the daily plan files:  <INKCODE_PLAN_DIR>/<year>/<month>/<plan>.xlsx
 * Every minute the server that holds the lease looks for new .xlsx files there and imports them like the "นำเข้าแผนผลิต" page does
 * (rows go to the day file of PF1 / PF2 by the date inside the plan). A handled file is moved to a "เสร็จแล้ว" sub-folder next to it,
 * a file that could not be imported to "ผิดพลาด", each with a <name>.txt report.
 *
 *   INKCODE_PLAN_DIR   = D:\InkCodePlans            (off when empty)
 *   INKCODE_PLAN_USER  = <username of a master/admin>  (rows and files are created as this user)
 */
export const PLAN_DONE = 'เสร็จแล้ว', PLAN_FAILED = 'ผิดพลาด';
const SETTLE_MS = 15_000;   // a file still being copied / saved is left alone
const EVERY_MS = 60_000;
let busy = false;

/** xlsx files waiting in <dir>/<year>/<month>/ (not in the handled folders, not Excel lock files) */
export function waitingFiles(dir: string, now = Date.now()): string[] {
  const out: string[] = [];
  const list = (d: string) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
  for (const y of list(dir)) {
    if (!y.isDirectory()) continue;
    for (const m of list(path.join(dir, y.name))) {
      if (!m.isDirectory()) continue;
      for (const f of list(path.join(dir, y.name, m.name))) {
        if (!f.isFile() || !/\.xlsx$/i.test(f.name) || f.name.startsWith('~$')) continue;
        const full = path.join(dir, y.name, m.name, f.name);
        try { if (now - fs.statSync(full).mtimeMs < SETTLE_MS) continue; } catch { continue; }
        out.push(full);
      }
    }
  }
  return out;
}

function archive(file: string, folder: string, report: string) {
  const dest = path.join(path.dirname(file), folder);
  fs.mkdirSync(dest, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const base = `${stamp} ${path.basename(file)}`;
  fs.renameSync(file, path.join(dest, base));
  fs.writeFileSync(path.join(dest, `${base}.txt`), report, 'utf8');
}

export async function scanOnce(dir: string, username: string): Promise<number> {
  const files = waitingFiles(dir);
  if (!files.length) return 0;
  const row = await q1(`SELECT user_id FROM Users WHERE username = @u AND is_active = 1`, { u: T.text(username) });
  const user = row ? await loadAuthUser(row.user_id) : null;
  if (!user) { logger.error(`inkcode plan folder: user "${username}" not found / inactive (INKCODE_PLAN_USER)`); return 0; }
  let n = 0;
  for (const file of files) {
    try {
      const r = await importAuto(user, fs.readFileSync(file), { onlyMatched: true });
      const lines = [`วันที่ผลิต ${r.date} · ทั้งหมด ${r.total} รายการ · ข้าม (ไม่ทราบโรงงาน) ${r.skippedNoPlant}`,
        ...r.targets.map((t) => `${t.plant} / ${t.area}: เพิ่ม ${t.result.created} · มีอยู่แล้ว ${t.result.duplicate} · ไม่พบในฐานข้อมูล ${t.result.skippedNotInDb}${t.result.failed.length ? ` · ผิดพลาด ${t.result.failed.length}: ${t.result.failed.slice(0, 5).map((f) => `${f.doc} (${f.line}) ${f.reason}`).join('; ')}` : ''}${t.fileCreated ? ` · สร้างไฟล์ ${t.folderPath}/${t.fileName}` : ''}`)];
      archive(file, PLAN_DONE, lines.join('\n'));
      logger.info(`inkcode plan folder: ${path.basename(file)} → ${r.targets.reduce((s, t) => s + t.result.created, 0)} rows (${r.date})`);
      n++;
    } catch (e) {
      logger.error(`inkcode plan folder: ${path.basename(file)} failed: ${(e as Error).message}`);
      try { archive(file, PLAN_FAILED, (e as Error).message); } catch (e2) { logger.error(`inkcode plan folder: cannot move ${file}: ${(e2 as Error).message}`); }
    }
  }
  return n;
}

export function startPlanFolderWatcher(): (() => void) | void {
  const dir = process.env.INKCODE_PLAN_DIR, user = process.env.INKCODE_PLAN_USER;
  if (!dir) { logger.info('inkcode plan folder: off (INKCODE_PLAN_DIR is not set)'); return; }
  if (!user) { logger.warn('inkcode plan folder: INKCODE_PLAN_USER is not set — off'); return; }
  logger.info(`inkcode plan folder: watching ${dir}`);
  const tick = async () => { if (busy) return; busy = true; try { await scanOnce(dir, user); } catch (e) { logger.error(`inkcode plan folder: ${(e as Error).message}`); } finally { busy = false; } };
  void tick();
  const t = setInterval(() => void tick(), EVERY_MS);
  return () => clearInterval(t);
}
