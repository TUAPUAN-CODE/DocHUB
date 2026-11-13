"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_FAILED = exports.PLAN_DONE = void 0;
exports.waitingFiles = waitingFiles;
exports.scanOnce = scanOnce;
exports.startPlanFolderWatcher = startPlanFolderWatcher;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const logger_1 = require("../../shared/logger");
const auto_1 = require("./auto");
/**
 * Drop folder for the daily plan files:  <INKCODE_PLAN_DIR>/<year>/<month>/<plan>.xlsx
 * Every minute the server that holds the lease looks for new .xlsx files there and imports them like the "นำเข้าแผนผลิต" page does
 * (rows go to the day file of PF1 / PF2 by the date inside the plan). A handled file is moved to a "เสร็จแล้ว" sub-folder next to it,
 * a file that could not be imported to "ผิดพลาด", each with a <name>.txt report.
 *
 *   INKCODE_PLAN_DIR   = D:\InkCodePlans            (off when empty)
 *   INKCODE_PLAN_USER  = <username of a master/admin>  (rows and files are created as this user)
 */
exports.PLAN_DONE = 'เสร็จแล้ว', exports.PLAN_FAILED = 'ผิดพลาด';
const SETTLE_MS = 15_000; // a file still being copied / saved is left alone
const EVERY_MS = 60_000;
let busy = false;
/** xlsx files waiting in <dir>/<year>/<month>/ (not in the handled folders, not Excel lock files) */
function waitingFiles(dir, now = Date.now()) {
    const out = [];
    const list = (d) => { try {
        return fs_1.default.readdirSync(d, { withFileTypes: true });
    }
    catch {
        return [];
    } };
    for (const y of list(dir)) {
        if (!y.isDirectory())
            continue;
        for (const m of list(path_1.default.join(dir, y.name))) {
            if (!m.isDirectory())
                continue;
            for (const f of list(path_1.default.join(dir, y.name, m.name))) {
                if (!f.isFile() || !/\.xlsx$/i.test(f.name) || f.name.startsWith('~$'))
                    continue;
                const full = path_1.default.join(dir, y.name, m.name, f.name);
                try {
                    if (now - fs_1.default.statSync(full).mtimeMs < SETTLE_MS)
                        continue;
                }
                catch {
                    continue;
                }
                out.push(full);
            }
        }
    }
    return out;
}
function archive(file, folder, report) {
    const dest = path_1.default.join(path_1.default.dirname(file), folder);
    fs_1.default.mkdirSync(dest, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const base = `${stamp} ${path_1.default.basename(file)}`;
    fs_1.default.renameSync(file, path_1.default.join(dest, base));
    fs_1.default.writeFileSync(path_1.default.join(dest, `${base}.txt`), report, 'utf8');
}
async function scanOnce(dir, username) {
    const files = waitingFiles(dir);
    if (!files.length)
        return 0;
    const row = await (0, db_1.q1)(`SELECT user_id FROM Users WHERE username = @u AND is_active = 1`, { u: db_1.T.text(username) });
    const user = row ? await (0, auth_1.loadAuthUser)(row.user_id) : null;
    if (!user) {
        logger_1.logger.error(`inkcode plan folder: user "${username}" not found / inactive (INKCODE_PLAN_USER)`);
        return 0;
    }
    let n = 0;
    for (const file of files) {
        try {
            const r = await (0, auto_1.importAuto)(user, fs_1.default.readFileSync(file), { onlyMatched: true });
            const lines = [`วันที่ผลิต ${r.date} · ทั้งหมด ${r.total} รายการ · ข้าม (ไม่ทราบโรงงาน) ${r.skippedNoPlant}`,
                ...r.targets.map((t) => `${t.plant} / ${t.area}: เพิ่ม ${t.result.created} · มีอยู่แล้ว ${t.result.duplicate} · ไม่พบในฐานข้อมูล ${t.result.skippedNotInDb}${t.result.failed.length ? ` · ผิดพลาด ${t.result.failed.length}: ${t.result.failed.slice(0, 5).map((f) => `${f.doc} (${f.line}) ${f.reason}`).join('; ')}` : ''}${t.fileCreated ? ` · สร้างไฟล์ ${t.folderPath}/${t.fileName}` : ''}`)];
            archive(file, exports.PLAN_DONE, lines.join('\n'));
            logger_1.logger.info(`inkcode plan folder: ${path_1.default.basename(file)} → ${r.targets.reduce((s, t) => s + t.result.created, 0)} rows (${r.date})`);
            n++;
        }
        catch (e) {
            logger_1.logger.error(`inkcode plan folder: ${path_1.default.basename(file)} failed: ${e.message}`);
            try {
                archive(file, exports.PLAN_FAILED, e.message);
            }
            catch (e2) {
                logger_1.logger.error(`inkcode plan folder: cannot move ${file}: ${e2.message}`);
            }
        }
    }
    return n;
}
function startPlanFolderWatcher() {
    const dir = process.env.INKCODE_PLAN_DIR, user = process.env.INKCODE_PLAN_USER;
    if (!dir) {
        logger_1.logger.info('inkcode plan folder: off (INKCODE_PLAN_DIR is not set)');
        return;
    }
    if (!user) {
        logger_1.logger.warn('inkcode plan folder: INKCODE_PLAN_USER is not set — off');
        return;
    }
    logger_1.logger.info(`inkcode plan folder: watching ${dir}`);
    const tick = async () => { if (busy)
        return; busy = true; try {
        await scanOnce(dir, user);
    }
    catch (e) {
        logger_1.logger.error(`inkcode plan folder: ${e.message}`);
    }
    finally {
        busy = false;
    } };
    void tick();
    const t = setInterval(() => void tick(), EVERY_MS);
    return () => clearInterval(t);
}
//# sourceMappingURL=watcher.js.map