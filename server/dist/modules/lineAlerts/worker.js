"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOnce = runOnce;
exports.startLineWorker = startLineWorker;
const db_1 = require("../../config/db");
const cellValue_1 = require("../../shared/cellValue");
const http_1 = require("../../shared/http");
const logger_1 = require("../../shared/logger");
const cellWriter_1 = require("../../services/cellWriter");
const config_1 = require("./config");
const logic_1 = require("./logic");
const line_1 = require("./line");
const MAX_ROWS_PER_COLUMN = 2000;
const MAX_ITEMS_PER_MESSAGE = 15;
const FAIL_BACKOFF_MS = 5 * 60_000;
const failedUntil = new Map(); // target → time to retry (a bad token / blocked group must not be retried every minute)
let running = false;
const pad = (n) => String(n).padStart(2, '0');
const local = (d) => { const t = new Date(d.getTime() + config_1.lineConfig.tzOffsetMinutes * 60000); return `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`; };
/** One pass: for every column that has LINE notification on, tell the target about rows that reached a new level */
async function runOnce(now = new Date()) {
    const cols = await (0, db_1.q)(`SELECT c.column_id, c.sheet_id, c.column_name, c.validation_rule, sh.sheet_name, f.file_id, f.file_name
     FROM Columns c JOIN Sheets sh ON sh.sheet_id = c.sheet_id JOIN Files f ON f.file_id = sh.file_id
     WHERE c.is_deleted = 0 AND f.is_deleted = 0 AND c.validation_rule LIKE N'%"notify"%'`);
    let sent = 0;
    for (const col of cols) {
        const cfg = (0, http_1.safeJson)(col.validation_rule, null)?.alert;
        const target = cfg?.notify?.targetId;
        if (!cfg || !target || !cfg.levels?.length)
            continue;
        if ((failedUntil.get(target) ?? 0) > Date.now())
            continue;
        try {
            sent += await handleColumn(col, cfg, now);
        }
        catch (e) {
            failedUntil.set(target, Date.now() + FAIL_BACKOFF_MS);
            logger_1.logger.error(`LINE alert failed (${col.file_name} / ${col.column_name}): ${e.message}`);
        }
    }
    return { sent };
}
async function handleColumn(col, cfg, now) {
    const notify = cfg.notify;
    const rows = await (0, db_1.q)(`SELECT TOP (${MAX_ROWS_PER_COLUMN}) r.row_id, r.row_order, s.value_date AS start_at, e.value_date AS end_at,
            COALESCE(l.value_float, CAST(l.value_int AS FLOAT)) AS limit_min
     FROM Rows r
     JOIN Cells s ON s.row_id = r.row_id AND s.column_id = @start AND s.value_date IS NOT NULL
     JOIN Cells l ON l.row_id = r.row_id AND l.column_id = @limit AND COALESCE(l.value_float, CAST(l.value_int AS FLOAT)) > 0
     LEFT JOIN Cells e ON e.row_id = r.row_id AND e.column_id = @end
     WHERE r.sheet_id = @sheet AND r.is_deleted = 0 AND e.value_date IS NULL AND s.value_date > DATEADD(DAY, -@days, SYSUTCDATETIME())
     ORDER BY s.value_date`, { start: db_1.T.uuid(cfg.startColumnId), limit: db_1.T.uuid(cfg.limitColumnId), end: db_1.T.uuid(cfg.endColumnId ?? '00000000-0000-0000-0000-000000000000'), sheet: db_1.T.uuid(col.sheet_id), days: db_1.T.int(config_1.lineConfig.windowDays) });
    const levels = (0, logic_1.sortedLevels)(cfg.levels);
    const hits = [];
    for (const r of rows) {
        const pct = (0, logic_1.ratioPct)(new Date(r.start_at).getTime(), null, now.getTime(), Number(r.limit_min));
        if (pct === null)
            continue;
        const level = (0, logic_1.levelToNotify)(cfg.levels, pct, notify.levelIdx);
        if (level >= 0)
            hits.push({ row: r, level, pct });
    }
    if (!hits.length)
        return 0;
    // claim: the unique key lets only one run announce a (row, level) — a higher level already sent covers the lower ones
    const fresh = [];
    for (const h of hits) {
        const done = await (0, db_1.q)(`SELECT 1 AS x FROM AlertNotified WHERE column_id = @c AND row_id = @r AND level_idx >= @l`, { c: db_1.T.uuid(col.column_id), r: db_1.T.uuid(h.row.row_id), l: db_1.T.int(h.level) });
        if (done.length)
            continue;
        try {
            await (0, db_1.q)(`INSERT INTO AlertNotified (column_id, row_id, level_idx) VALUES (@c, @r, @l)`, { c: db_1.T.uuid(col.column_id), r: db_1.T.uuid(h.row.row_id), l: db_1.T.int(h.level) });
            fresh.push(h);
        }
        catch { /* claimed by another run */ }
    }
    if (!fresh.length)
        return 0;
    const labels = await labelValues(col.sheet_id, notify.labelColumnIds ?? [], fresh.map((h) => h.row.row_id));
    const items = fresh.map((h) => ({
        rowNo: h.row.row_order, pct: h.pct, levelLabel: levels[h.level].label || `เกิน ${levels[h.level].atPct}%`,
        elapsedMin: (now.getTime() - new Date(h.row.start_at).getTime()) / 60000, limitMin: Number(h.row.limit_min),
        startedAt: local(new Date(h.row.start_at)), labels: labels.get(h.row.row_id) ?? [],
    }));
    const link = config_1.lineConfig.appUrl ? `${config_1.lineConfig.appUrl}/files/${col.file_id}` : null;
    try {
        for (let i = 0; i < items.length; i += MAX_ITEMS_PER_MESSAGE) {
            await (0, line_1.pushText)(notify.targetId, (0, logic_1.buildMessage)(`${col.file_name} › ${col.sheet_name}: ${col.column_name}`, items.slice(i, i + MAX_ITEMS_PER_MESSAGE), link));
        }
    }
    catch (e) {
        // not delivered: release the claims so the next pass tries again
        for (const h of fresh)
            await (0, db_1.q)(`DELETE FROM AlertNotified WHERE column_id = @c AND row_id = @r AND level_idx = @l`, { c: db_1.T.uuid(col.column_id), r: db_1.T.uuid(h.row.row_id), l: db_1.T.int(h.level) }).catch(() => undefined);
        throw e;
    }
    return fresh.length;
}
async function labelValues(sheetId, columnIds, rowIds) {
    const out = new Map();
    if (!columnIds.length || !rowIds.length)
        return out;
    const defs = new Map((await (0, cellWriter_1.loadColumns)(sheetId)).map((c) => [String(c.column_id).toLowerCase(), c]));
    for (const rowId of rowIds) {
        const parts = [];
        for (const cid of columnIds.slice(0, 4)) {
            const c = defs.get(cid.toLowerCase());
            if (!c)
                continue;
            const [cell] = await (0, db_1.q)(`SELECT value_text, value_int, value_float, value_date, value_bool, value_json FROM Cells WHERE row_id = @r AND column_id = @c`, { r: db_1.T.uuid(rowId), c: db_1.T.uuid(c.column_id) });
            const v = (0, cellValue_1.fromStorage)((0, cellValue_1.toColumnDef)(c).data_type, cell);
            if (v === null || v === '')
                continue;
            parts.push(c.data_type === 'datetime' ? local(new Date(String(v))) : Array.isArray(v) ? v.join(',') : String(v));
        }
        out.set(rowId, parts);
    }
    return out;
}
function startLineWorker() {
    if (!(0, config_1.lineEnabled)()) {
        logger_1.logger.info('LINE alerts off (LINE_CHANNEL_ACCESS_TOKEN is not set)');
        return;
    }
    const tick = async () => {
        if (running)
            return;
        running = true;
        try {
            await runOnce();
        }
        catch (e) {
            logger_1.logger.error(`LINE alert pass failed: ${e.message}`);
        }
        finally {
            running = false;
        }
    };
    const timer = setInterval(() => void tick(), config_1.lineConfig.intervalSec * 1000);
    timer.unref();
    logger_1.logger.info(`LINE alerts on (every ${config_1.lineConfig.intervalSec}s)`);
    return () => clearInterval(timer);
}
//# sourceMappingURL=worker.js.map