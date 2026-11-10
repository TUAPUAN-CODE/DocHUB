"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readUnionConfig = exports.SOURCE_COLUMN = void 0;
exports.diffSignatures = diffSignatures;
exports.assertUnionSources = assertUnionSources;
exports.createUnionSheet = createUnionSheet;
exports.syncUnion = syncUnion;
exports.syncUnionIfStale = syncUnionIfStale;
exports.unionStatus = unionStatus;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
const logger_1 = require("../shared/logger");
const http_2 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const socket_1 = require("../socket");
const cellWriter_1 = require("./cellWriter");
const hooks_1 = require("./hooks");
exports.SOURCE_COLUMN = 'แหล่งที่มา';
const readUnionConfig = (sheet) => (0, http_2.safeJson)(sheet.union_config ?? null, null);
exports.readUnionConfig = readUnionConfig;
const stable = (v) => {
    if (v === null || v === undefined)
        return '';
    if (Array.isArray(v))
        return `[${v.map(stable).join(',')}]`;
    if (typeof v === 'object') {
        const o = v;
        const keys = Object.keys(o).filter((k) => o[k] !== null && o[k] !== undefined && o[k] !== '').sort();
        return keys.length ? `{${keys.map((k) => `${k}:${stable(o[k])}`).join(',')}}` : '';
    }
    return JSON.stringify(v);
};
/** Formulas keep column ids, which differ between sheets: compare them by the column names they refer to */
function comparableValidation(raw, names) {
    const v = (0, http_2.safeJson)(raw, null);
    if (v?.alert)
        for (const k of ['startColumnId', 'endColumnId', 'limitColumnId'])
            if (v.alert[k])
                v.alert[k] = (names.get(String(v.alert[k]).toLowerCase()) ?? '?').toLowerCase();
    if (v?.formula?.expr)
        v.formula.expr = v.formula.expr.replace(/\[#([0-9a-fA-F-]{36})\]/g, (_m, id) => `[${(names.get(id.toLowerCase()) ?? '?').toLowerCase()}]`);
    return v;
}
async function signature(sheetId) {
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const names = new Map(cols.map((c) => [String(c.column_id).toLowerCase(), String(c.column_name).trim()]));
    return cols.map((c) => ({
        name: String(c.column_name).trim().toLowerCase(),
        type: c.data_type,
        required: !!c.is_required,
        validation: stable(comparableValidation(c.validation_rule, names)),
        options: stable(((0, http_2.safeJson)(c.select_options, []) ?? []).map((o) => [o.value, o.label])),
    }));
}
const TYPE_LABEL = { varchar: 'ข้อความสั้น', text: 'ข้อความยาว', int: 'จำนวนเต็ม', float: 'ทศนิยม', date: 'วันที่', datetime: 'วันที่และเวลา', boolean: 'ใช่/ไม่ใช่', select: 'ตัวเลือกเดียว', multi_select: 'หลายตัวเลือก', url: 'ลิงก์', email: 'อีเมล', image: 'รูปภาพ', doc_number: 'เลขที่เอกสารอัตโนมัติ' };
/** Human readable differences between two column sets (names are matched case-insensitively; order does not matter) */
function diffSignatures(base, other) {
    const out = [];
    const bm = new Map(base.map((s) => [s.name, s]));
    const om = new Map(other.map((s) => [s.name, s]));
    for (const [n] of bm)
        if (!om.has(n))
            out.push(`ไม่มีคอลัมน์ “${n}”`);
    for (const [n] of om)
        if (!bm.has(n))
            out.push(`มีคอลัมน์เกิน “${n}”`);
    for (const [n, a] of bm) {
        const b = om.get(n);
        if (!b)
            continue;
        if (a.type !== b.type)
            out.push(`คอลัมน์ “${n}” ชนิดข้อมูลต่างกัน (${TYPE_LABEL[a.type] ?? a.type} ≠ ${TYPE_LABEL[b.type] ?? b.type})`);
        else {
            if (a.required !== b.required)
                out.push(`คอลัมน์ “${n}” การบังคับกรอกต่างกัน`);
            if (a.options !== b.options)
                out.push(`คอลัมน์ “${n}” ตัวเลือกต่างกัน`);
            if (a.validation !== b.validation)
                out.push(`คอลัมน์ “${n}” กฎตรวจสอบ/การตั้งค่าต่างกัน`);
        }
    }
    return out;
}
async function describeSource(sheetId) {
    const r = await (0, db_1.q1)(`SELECT s.sheet_id, s.sheet_name, f.file_name, s.union_config FROM Sheets s JOIN Files f ON f.file_id = s.file_id
     WHERE s.sheet_id = @id AND s.is_deleted = 0 AND f.is_deleted = 0`, { id: db_1.T.uuid(sheetId) });
    return r ? { sheetId: r.sheet_id, fileName: r.file_name, sheetName: r.sheet_name, label: `${r.file_name} / ${r.sheet_name}` } : null;
}
/** Validates the chosen sources (readable, not unions, identical structure). Throws a 400 listing every difference. */
async function assertUnionSources(user, sourceIds, exceptUnionId) {
    const ids = [...new Set(sourceIds.map((s) => s.toLowerCase()))];
    if (!ids.length)
        throw (0, http_1.badRequest)('กรุณาเลือกชีตต้นทางอย่างน้อย 1 ชีต');
    if (ids.length > 50)
        throw (0, http_1.badRequest)('รวมได้สูงสุด 50 ชีต');
    const infos = [];
    for (const id of ids) {
        if (id === exceptUnionId)
            throw (0, http_1.badRequest)('ชีตรวมข้อมูลไม่สามารถใช้ตัวเองเป็นต้นทางได้');
        const { sheet } = await (0, permissions_1.requireSheet)(user, id, permissions_1.LV.read);
        if (sheet.union_config)
            throw (0, http_1.badRequest)(`“${sheet.file_name} / ${sheet.sheet_name}” เป็นชีตรวมข้อมูลอยู่แล้ว ไม่รองรับการรวมซ้อนกัน`);
        infos.push({ sheetId: sheet.sheet_id, fileName: sheet.file_name, sheetName: sheet.sheet_name, label: `${sheet.file_name} / ${sheet.sheet_name}` });
    }
    const base = await signature(infos[0].sheetId);
    if (!base.length)
        throw (0, http_1.badRequest)(`“${infos[0].label}” ยังไม่มีคอลัมน์`);
    const problems = [];
    for (const info of infos.slice(1)) {
        const d = diffSignatures(base, await signature(info.sheetId));
        if (d.length)
            problems.push({ source: info.label, differences: d });
    }
    if (problems.length)
        throw (0, http_1.badRequest)(`โครงสร้างคอลัมน์ไม่ตรงกับ “${infos[0].label}”: ${problems.map((p) => `${p.source} → ${p.differences[0]}${p.differences.length > 1 ? ` (+${p.differences.length - 1})` : ''}`).join('; ')}`, { problems });
    return infos;
}
/** Creates the union sheet (columns copied from the first source + a "source" column). Runs inside a transaction. */
async function createUnionSheet(tx, fileId, name, sort, sources, userId) {
    const cfg = { sources: sources.map((s) => ({ sheetId: s.sheetId })), createdBy: userId, lastSyncAt: null, results: [] };
    const sh = await (0, db_1.q1)(`INSERT INTO Sheets (file_id, sheet_name, sort_order, created_by, union_config) OUTPUT inserted.sheet_id VALUES (@f, @n, @o, @u, @cfg)`, { f: db_1.T.uuid(fileId), n: name, o: db_1.T.int(sort), u: db_1.T.uuid(userId), cfg: db_1.T.text(JSON.stringify(cfg)) }, tx);
    const sheetId = sh.sheet_id;
    const srcCols = await (0, cellWriter_1.loadColumns)(sources[0].sheetId);
    const taken = new Set(srcCols.map((c) => String(c.column_name).trim().toLowerCase()));
    let label = exports.SOURCE_COLUMN;
    while (taken.has(label.toLowerCase()))
        label += ' (รวม)';
    await (0, db_1.q)(`INSERT INTO Columns (sheet_id, column_name, data_type, display_order, width, is_required, created_by) VALUES (@s, @n, N'varchar', 0, 220, 0, @u)`, { s: db_1.T.uuid(sheetId), n: label, u: db_1.T.uuid(userId) }, tx);
    const columnMap = [];
    for (const [i, c] of srcCols.entries()) {
        const ins = await (0, db_1.q1)(`INSERT INTO Columns (sheet_id, column_name, data_type, display_order, width, is_required, default_value, placeholder, validation_rule, select_options, description, created_by)
       OUTPUT inserted.column_id
       VALUES (@s, @n, @t, @o, @w, @r, @dv, @ph, @vr, @so, @d, @u)`, { s: db_1.T.uuid(sheetId), n: c.column_name, t: c.data_type, o: db_1.T.int(i + 1), w: db_1.T.int(c.width), r: db_1.T.bit(!!c.is_required), dv: db_1.T.text(c.default_value), ph: db_1.T.text(c.placeholder),
            vr: db_1.T.text(c.validation_rule), so: db_1.T.text(c.select_options), d: db_1.T.text(c.description), u: db_1.T.uuid(userId) }, tx);
        columnMap.push({ old_id: c.column_id, new_id: ins.column_id });
    }
    // the union's columns are copies of the first source's: modules re-point references that contain column ids (formulas)
    await (0, hooks_1.runAfterSheetCopied)({ tx, oldSheetId: sources[0].sheetId, newSheetId: sheetId, columnMap });
    return sheetId;
}
/* ---------------- sync ---------------- */
const running = new Map();
const CHUNK = 1500;
function syncUnion(sheetId) {
    const hit = running.get(sheetId);
    if (hit)
        return hit;
    const p = doSync(sheetId).finally(() => running.delete(sheetId));
    running.set(sheetId, p);
    return p;
}
async function doSync(unionId) {
    const sheet = await (0, db_1.q1)(`SELECT sheet_id, union_config FROM Sheets WHERE sheet_id = @id AND is_deleted = 0`, { id: db_1.T.uuid(unionId) });
    const cfg = sheet && (0, exports.readUnionConfig)(sheet);
    if (!sheet || !cfg)
        throw (0, http_1.badRequest)('ไม่ใช่ชีตรวมข้อมูล');
    const ucols = (await (0, cellWriter_1.loadColumns)(unionId)).filter((c) => !c.is_deleted);
    const unionSig = await signature(unionId);
    // The first column is the "source" column; the rest must equal the sources
    const labelCol = ucols[0];
    const dataCols = ucols.slice(1);
    const dataSig = unionSig.slice(1);
    const byName = new Map(dataCols.map((c) => [String(c.column_name).trim().toLowerCase(), c.column_id]));
    const results = [];
    const order = [];
    let changed = false;
    for (const [idx, src] of cfg.sources.entries()) {
        order.push({ sheet_id: src.sheetId, idx });
        const info = await describeSource(src.sheetId);
        if (!info) {
            results.push({ sheetId: src.sheetId, ok: false, message: 'ไม่พบชีตต้นทาง (ถูกลบแล้ว) — คงข้อมูลเดิมไว้' });
            continue;
        }
        const diff = diffSignatures(dataSig, await signature(src.sheetId));
        if (diff.length) {
            results.push({ sheetId: src.sheetId, ok: false, message: `โครงสร้างไม่ตรงกันแล้ว: ${diff[0]}${diff.length > 1 ? ` (+${diff.length - 1})` : ''} — คงข้อมูลเดิมไว้` });
            continue;
        }
        const scols = await (0, cellWriter_1.loadColumns)(src.sheetId);
        const colMap = scols.map((c) => ({ src: c.column_id, dst: byName.get(String(c.column_name).trim().toLowerCase()) })).filter((m) => m.dst);
        const srcRows = await (0, db_1.q)(`SELECT row_id, updated_at FROM Rows WHERE sheet_id = @s AND is_deleted = 0`, { s: db_1.T.uuid(src.sheetId) });
        const mirror = await (0, db_1.q)(`SELECT row_id, source_row_id, updated_at FROM Rows WHERE sheet_id = @u AND source_sheet_id = @s`, { u: db_1.T.uuid(unionId), s: db_1.T.uuid(src.sheetId) });
        const mByS = new Map(mirror.map((m) => [m.source_row_id, m]));
        const sSet = new Set(srcRows.map((r) => r.row_id));
        const toDelete = mirror.filter((m) => !sSet.has(m.source_row_id)).map((m) => m.row_id);
        const toInsert = srcRows.filter((r) => !mByS.has(r.row_id)).map((r) => r.row_id);
        const toUpdate = srcRows.filter((r) => { const m = mByS.get(r.row_id); return m && new Date(m.updated_at).getTime() !== new Date(r.updated_at).getTime(); }).map((r) => ({ src: r.row_id, dst: mByS.get(r.row_id).row_id }));
        if (toDelete.length || toInsert.length || toUpdate.length)
            changed = true;
        await (0, db_1.withTx)(async (tx) => {
            for (let i = 0; i < toDelete.length; i += CHUNK) {
                const ids = (0, db_1.jsonParam)(toDelete.slice(i, i + CHUNK));
                await (0, db_1.q)(`DELETE FROM Cells WHERE row_id IN ${(0, db_1.idList)('@ids')}`, { ids }, tx);
                await (0, db_1.q)(`DELETE FROM Rows WHERE row_id IN ${(0, db_1.idList)('@ids')}`, { ids }, tx);
            }
            // rows that changed: drop their cells and copy again
            for (let i = 0; i < toUpdate.length; i += CHUNK) {
                const chunk = toUpdate.slice(i, i + CHUNK);
                await (0, db_1.q)(`DELETE FROM Cells WHERE row_id IN ${(0, db_1.idList)('@ids')}`, { ids: (0, db_1.jsonParam)(chunk.map((c) => c.dst)) }, tx);
                await (0, db_1.q)(`UPDATE r SET r.updated_at = sr.updated_at, r.updated_by = sr.updated_by
                 FROM Rows r JOIN OPENJSON(@rm) WITH (src UNIQUEIDENTIFIER, dst UNIQUEIDENTIFIER) m ON m.dst = r.row_id JOIN Rows sr ON sr.row_id = m.src`, { rm: db_1.T.text(JSON.stringify(chunk)) }, tx);
                await copyCells(tx, chunk, colMap, labelCol.column_id, info.label, cfg.createdBy);
            }
            for (let i = 0; i < toInsert.length; i += CHUNK) {
                const chunk = toInsert.slice(i, i + CHUNK).map((s) => ({ src: s, dst: crypto_1.default.randomUUID() }));
                await (0, db_1.q)(`INSERT INTO Rows (row_id, sheet_id, row_order, created_by, created_at, updated_by, updated_at, source_row_id, source_sheet_id)
                 SELECT m.dst, @u, 0, sr.created_by, sr.created_at, sr.updated_by, sr.updated_at, sr.row_id, @s
                 FROM OPENJSON(@rm) WITH (src UNIQUEIDENTIFIER, dst UNIQUEIDENTIFIER) m JOIN Rows sr ON sr.row_id = m.src`, { u: db_1.T.uuid(unionId), s: db_1.T.uuid(src.sheetId), rm: db_1.T.text(JSON.stringify(chunk)) }, tx);
                await copyCells(tx, chunk, colMap, labelCol.column_id, info.label, cfg.createdBy);
            }
        });
        results.push({ sheetId: src.sheetId, ok: true, rows: srcRows.length });
    }
    // rows of sources that were removed from the union
    const removed = await (0, db_1.q)(`SELECT row_id FROM Rows WHERE sheet_id = @u AND source_sheet_id IS NOT NULL AND source_sheet_id NOT IN ${(0, db_1.idList)('@keep')}`, { u: db_1.T.uuid(unionId), keep: (0, db_1.jsonParam)(cfg.sources.map((s) => s.sheetId)) });
    if (removed.length) {
        changed = true;
        await (0, db_1.withTx)(async (tx) => {
            for (let i = 0; i < removed.length; i += CHUNK) {
                const ids = (0, db_1.jsonParam)(removed.slice(i, i + CHUNK).map((r) => r.row_id));
                await (0, db_1.q)(`DELETE FROM Cells WHERE row_id IN ${(0, db_1.idList)('@ids')}`, { ids }, tx);
                await (0, db_1.q)(`DELETE FROM Rows WHERE row_id IN ${(0, db_1.idList)('@ids')}`, { ids }, tx);
            }
        });
    }
    if (changed) {
        // numbering: by source order, then the row order inside the source
        await (0, db_1.q)(`UPDATE r SET r.row_order = x.rn
       FROM Rows r JOIN (
         SELECT m.row_id, ROW_NUMBER() OVER (ORDER BY j.idx, s.row_order) AS rn
         FROM Rows m JOIN OPENJSON(@o) WITH (sheet_id UNIQUEIDENTIFIER, idx INT) j ON j.sheet_id = m.source_sheet_id
         JOIN Rows s ON s.row_id = m.source_row_id WHERE m.sheet_id = @u AND m.is_deleted = 0) x ON x.row_id = r.row_id`, { o: db_1.T.text(JSON.stringify(order)), u: db_1.T.uuid(unionId) });
    }
    const next = { ...cfg, lastSyncAt: new Date().toISOString(), results };
    await (0, db_1.q)(`UPDATE Sheets SET union_config = @c, updated_at = SYSUTCDATETIME() WHERE sheet_id = @id`, { c: db_1.T.text(JSON.stringify(next)), id: db_1.T.uuid(unionId) });
    if (changed)
        (0, socket_1.emitToSheet)(unionId, 'rows:changed', { sheetId: unionId, action: 'sync', by: 'ระบบ' });
    logger_1.logger.info(`Union sheet ${unionId} synced (${results.map((r) => (r.ok ? r.rows : 'x')).join('+')} rows${changed ? ', changed' : ''})`);
    return next;
}
async function copyCells(tx, chunk, colMap, labelColId, label, userId) {
    await (0, db_1.q)(`INSERT INTO Cells (row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, updated_by, updated_at)
     SELECT rm.dst, cm.dst, sc.value_text, sc.value_int, sc.value_float, sc.value_date, sc.value_bool, sc.value_json, sc.updated_by, sc.updated_at
     FROM OPENJSON(@rm) WITH (src UNIQUEIDENTIFIER, dst UNIQUEIDENTIFIER) rm
     JOIN Cells sc ON sc.row_id = rm.src
     JOIN OPENJSON(@cm) WITH (src UNIQUEIDENTIFIER, dst UNIQUEIDENTIFIER) cm ON cm.src = sc.column_id`, { rm: db_1.T.text(JSON.stringify(chunk)), cm: db_1.T.text(JSON.stringify(colMap)) }, tx);
    await (0, db_1.q)(`INSERT INTO Cells (row_id, column_id, value_text, updated_by)
     SELECT rm.dst, @lc, @label, @u FROM OPENJSON(@rm) WITH (src UNIQUEIDENTIFIER, dst UNIQUEIDENTIFIER) rm`, { rm: db_1.T.text(JSON.stringify(chunk)), lc: db_1.T.uuid(labelColId), label: db_1.T.text(label), u: db_1.T.uuid(userId) }, tx);
}
/** Starts a background sync when the data is older than `maxAgeMs` (never blocks the request) */
function syncUnionIfStale(sheet, maxAgeMs = 30_000) {
    const cfg = (0, exports.readUnionConfig)(sheet);
    if (!cfg)
        return;
    const age = cfg.lastSyncAt ? Date.now() - new Date(cfg.lastSyncAt).getTime() : Infinity;
    if (age > maxAgeMs)
        void syncUnion(sheet.sheet_id).catch((e) => logger_1.logger.warn(`Union sync failed: ${e?.message}`));
}
/** Sources + last sync, for the sheet screen */
async function unionStatus(sheet) {
    const cfg = (0, exports.readUnionConfig)(sheet);
    if (!cfg)
        return null;
    const sources = [];
    for (const src of cfg.sources) {
        const info = await describeSource(src.sheetId);
        const r = cfg.results?.find((x) => x.sheetId === src.sheetId);
        sources.push({ sheetId: src.sheetId, fileName: info?.fileName ?? null, sheetName: info?.sheetName ?? null, ok: info ? r?.ok ?? true : false, message: info ? r?.message ?? null : 'ไม่พบชีตต้นทาง', rows: r?.rows ?? null });
    }
    return { sources, lastSyncAt: cfg.lastSyncAt ?? null };
}
//# sourceMappingURL=union.js.map