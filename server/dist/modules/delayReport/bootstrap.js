"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.delayHubConfigured = void 0;
exports.delaySheetId = delaySheetId;
exports.ensureDelayConnector = ensureDelayConnector;
exports.delayTemplate = delayTemplate;
exports.runDelayBackfill = runDelayBackfill;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const logger_1 = require("../../shared/logger");
const secret_1 = require("../connectors/secret");
const safeFetch_1 = require("../connectors/safeFetch");
const runner_1 = require("../connectors/runner");
const columns_1 = require("./columns");
/**
 * DelayHUB → DocHUB, set up from .env (nothing to click):
 *   DELAYHUB_URL=http://<DelayHUB server>:<port>     DELAYHUB_EXPORT_KEY=<EXPORT_API_KEY of DelayHUB>     DELAYHUB_RUN_AT=05:00 (default)   DELAYHUB_DAYS=3 (default)
 * At start-up the connector "DelayHUB → รายงาน Delay F3PFPF67" is created (or brought up to date) for the sheet of the seeded file:
 * every day at DELAYHUB_RUN_AT it reads the finished rows of the last DELAYHUB_DAYS days and updates / adds them by mapping_id.
 */
const delayHubConfigured = () => !!(process.env.DELAYHUB_URL && process.env.DELAYHUB_EXPORT_KEY);
exports.delayHubConfigured = delayHubConfigured;
const base = () => String(process.env.DELAYHUB_URL ?? '').replace(/\/+$/, '').replace(/\/api$/, '');
const key = () => String(process.env.DELAYHUB_EXPORT_KEY ?? '');
async function delaySheetId() {
    const r = await (0, db_1.q1)(`SELECT TOP 1 s.sheet_id FROM Sheets s JOIN Files f ON f.file_id = s.file_id
                      WHERE f.is_deleted = 0 AND s.is_deleted = 0 AND f.file_name = @f AND s.sheet_name = @s ORDER BY f.created_at`, { f: columns_1.DELAY_NAMES.file, s: columns_1.DELAY_NAMES.sheet });
    return r ? String(r.sheet_id).toLowerCase() : null;
}
async function ensureDelayConnector() {
    if (!(0, exports.delayHubConfigured)())
        return null;
    const runAt = /^([01]\d|2[0-3]):[0-5]\d$/.test(process.env.DELAYHUB_RUN_AT ?? '') ? process.env.DELAYHUB_RUN_AT : '05:00';
    const days = Math.min(Math.max(Number(process.env.DELAYHUB_DAYS) || 3, 1), 62);
    const sheetId = await delaySheetId();
    if (!sheetId) {
        logger_1.logger.warn(`DelayHUB: ไม่พบไฟล์ "${columns_1.DELAY_NAMES.file}" (seed ยังไม่ลง?) — ยังไม่ตั้ง connector`);
        return null;
    }
    const cols = await (0, db_1.q)(`SELECT column_id, column_name FROM Columns WHERE sheet_id = @s AND is_deleted = 0`, { s: db_1.T.uuid(sheetId) });
    const byName = new Map(cols.map((c) => [String(c.column_name), String(c.column_id).toLowerCase()]));
    const mapping = columns_1.DELAY_COLS.filter((c) => byName.has(c.name)).map((c) => ({ source: c.field, columnId: byName.get(c.name) }));
    const keyCol = byName.get('mapping_id');
    if (!keyCol) {
        logger_1.logger.warn('DelayHUB: ชีตไม่มีคอลัมน์ mapping_id — ยังไม่ตั้ง connector');
        return null;
    }
    const owner = await (0, db_1.q1)(`SELECT TOP 1 u.user_id FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id JOIN Roles r ON r.role_id = ur.role_id
                          WHERE r.role_name IN (N'admin', N'root') AND u.is_active = 1 ORDER BY CASE r.role_name WHEN N'admin' THEN 0 ELSE 1 END, u.created_at`);
    if (!owner)
        return null;
    const config = { url: `${base()}/api/export/f3pfpf67?days=${days}`, method: 'GET', headers: {}, format: 'json', jsonPath: 'rows' };
    const secret = (0, secret_1.encryptJson)({ type: 'header', headerName: 'x-export-key', token: key() });
    const cur = await (0, db_1.q1)(`SELECT connector_id FROM Connectors WHERE is_deleted = 0 AND name = @n`, { n: columns_1.DELAY_CONNECTOR_NAME });
    const p = { n: columns_1.DELAY_CONNECTOR_NAME, c: db_1.T.text(JSON.stringify(config)), t: db_1.T.uuid(sheetId), m: db_1.T.text(JSON.stringify(mapping)), kc: db_1.T.uuid(keyCol), ra: runAt, sec: db_1.T.text(secret) };
    if (cur) {
        await (0, db_1.q)(`UPDATE Connectors SET kind = 'http', config_json = @c, target_sheet_id = @t, mapping_json = @m, key_column_id = @kc, schedule_min = 1440, run_at = @ra, secret_enc = @sec WHERE connector_id = @i`, { ...p, i: db_1.T.uuid(cur.connector_id) });
        return String(cur.connector_id);
    }
    const r = await (0, db_1.q1)(`INSERT INTO Connectors (name, kind, config_json, secret_enc, target_sheet_id, mapping_json, key_column_id, schedule_min, run_at, created_by)
                      OUTPUT inserted.connector_id VALUES (@n, 'http', @c, @sec, @t, @m, @kc, 1440, @ra, @u)`, { ...p, u: db_1.T.uuid(owner.user_id) });
    logger_1.logger.info(`DelayHUB: ตั้ง connector "${columns_1.DELAY_CONNECTOR_NAME}" ดึงทุกวัน ${runAt} น. (${days} วันล่าสุด)`);
    return String(r.connector_id);
}
/** The Excel form F3PFPV04 (blank template) is DelayHUB's: fetched from it and kept in UPLOAD_DIR/delayhub (refreshed once a day) */
const TEMPLATE = () => path_1.default.resolve(env_1.env.uploadDir, 'delayhub', 'F3PFPV04.xlsx');
async function delayTemplate() {
    const file = TEMPLATE();
    const st = fs_1.default.existsSync(file) ? fs_1.default.statSync(file) : null;
    if (st && Date.now() - st.mtimeMs < 24 * 3600_000)
        return fs_1.default.readFileSync(file);
    if (!(0, exports.delayHubConfigured)()) {
        if (st)
            return fs_1.default.readFileSync(file);
        throw new Error('ยังไม่ได้ตั้ง DELAYHUB_URL / DELAYHUB_EXPORT_KEY ใน .env ของ DocHUB');
    }
    try {
        const r = await (0, safeFetch_1.safeFetch)(`${base()}/api/export/f3pfpf67/template.xlsx`, { headers: { 'x-export-key': key() } });
        if (r.status !== 200 || r.body.length < 1000)
            throw new Error(`DelayHUB ตอบ ${r.status}`);
        fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
        fs_1.default.writeFileSync(file, r.body);
        return r.body;
    }
    catch (e) {
        if (st) {
            logger_1.logger.warn(`DelayHUB template: ${e.message} — ใช้สำเนาเดิม`);
            return fs_1.default.readFileSync(file);
        }
        throw new Error(`ดึงแบบฟอร์ม Excel จาก DelayHUB ไม่สำเร็จ: ${e.message}`);
    }
}
/**
 * One-time back-fill: DELAYHUB_BACKFILL_FROM=2026-01-01 pulls every finished row from that day up to today, 7 days at a time (light for
 * DelayHUB, under the per-run limits). Progress is kept in SystemSettings (`delayhub.backfill`): a restart carries on where it stopped,
 * and once it reaches today it is not done again (change the date to do it again). The daily 05:00 pull of the last 3 days goes on as usual.
 */
const BF_KEY = 'delayhub.backfill';
const CHUNK_DAYS = 7;
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const thaiToday = () => ymd(new Date(Date.now() + env_1.env.tzOffsetMinutes * 60_000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let backfilling = false;
async function runDelayBackfill(connectorId) {
    const from = String(process.env.DELAYHUB_BACKFILL_FROM ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || backfilling)
        return;
    backfilling = true;
    try {
        const stored = await (0, db_1.q1)(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k: BF_KEY });
        let st = (() => { try {
            return JSON.parse(stored?.setting_value ?? '');
        }
        catch {
            return null;
        } })() ?? { from, next: from };
        if (st.from !== from)
            st = { from, next: from }; // a new start date = start again
        if (st.done)
            return;
        const save = () => (0, db_1.q)(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
                          WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_at = SYSUTCDATETIME()
                          WHEN NOT MATCHED THEN INSERT (setting_key, setting_value) VALUES (@k, @v);`, { k: BF_KEY, v: db_1.T.text(JSON.stringify(st)) });
        logger_1.logger.info(`DelayHUB back-fill: ${st.next} → ${thaiToday()} (ทีละ ${CHUNK_DAYS} วัน)`);
        let fails = 0;
        while (st.next <= thaiToday()) {
            const to = [addDays(st.next, CHUNK_DAYS - 1), thaiToday()].sort()[0];
            const url = `${base()}/api/export/f3pfpf67?date_from=${st.next}&date_to=${to}`;
            try {
                const r = await (0, runner_1.runConnector)(connectorId, { url });
                logger_1.logger.info(`DelayHUB back-fill ${st.next} – ${to}: อ่าน ${r.read} · เพิ่ม ${r.created} · อัปเดต ${r.updated}${r.skipped ? ` · ข้าม ${r.skipped}` : ''}`);
                st.next = addDays(to, 1);
                fails = 0;
                await save();
                await sleep(20_000); // breathe between weeks (DelayHUB runs the same query as its Done page)
            }
            catch (e) {
                const msg = e.message;
                if (++fails >= 15) {
                    logger_1.logger.warn(`DelayHUB back-fill หยุดที่ ${st.next}: ${msg} — แก้แล้ว restart เพื่อทำต่อ`);
                    return;
                }
                logger_1.logger.warn(`DelayHUB back-fill ${st.next} – ${to}: ${msg} — ลองใหม่ใน 2 นาที`);
                await sleep(120_000); // the daily pull is running, DelayHUB is busy / down …: try the same week again
            }
        }
        st.done = true;
        await save();
        logger_1.logger.info(`DelayHUB back-fill เสร็จ (${from} → ${thaiToday()})`);
    }
    finally {
        backfilling = false;
    }
}
//# sourceMappingURL=bootstrap.js.map