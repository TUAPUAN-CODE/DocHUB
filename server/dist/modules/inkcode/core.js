"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.annotate = exports.NAMES = exports.norm = void 0;
exports.placeOf = placeOf;
exports.lineInfo = lineInfo;
exports.linePlants = linePlants;
exports.context = context;
exports.dbPairs = dbPairs;
exports.insertItems = insertItems;
const db_1 = require("../../config/db");
const audit_1 = require("../../shared/audit");
const cellValue_1 = require("../../shared/cellValue");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const cellWriter_1 = require("../../services/cellWriter");
const lookup_1 = require("../../services/lookup");
const rowCreate_1 = require("../../services/rowCreate");
const rowQuery_1 = require("../../services/rowQuery");
const socket_1 = require("../../socket");
const model_1 = require("./model");
const norm = (s) => String(s ?? '').trim().toLowerCase();
exports.norm = norm;
/** Which columns of the target worksheet the importer fills (by name — same names as the InkCode worksheet) */
exports.NAMES = { date: 'วันที่ผลิต', line: 'ไลน์', shift: 'กะ', doc: 'รหัสเอกสาร', market: 'Market', qty: 'ยอด', time: 'เวลาเริ่ม' };
/**
 * Where the target sheet sits in the InkCode tree "… / PF1 | PF2 / <year> / <YYYY-MM name> / <DD>": the plant (from the folder names)
 * and the day the sheet stands for (from the file and sheet names). Both are null for a sheet outside that tree.
 */
function placeOf(ctx, sheet) {
    let plant = null;
    for (let cur = ctx.index.map.get(sheet.folder_id); cur; cur = cur.parentId ? ctx.index.map.get(cur.parentId) : undefined) {
        if (/^PF\d+$/i.test(cur.name.trim())) {
            plant = cur.name.trim().toUpperCase();
            break;
        }
    }
    const m = /^(\d{4})-(\d{2})/.exec(String(sheet.file_name ?? '').trim());
    const d = /^\d{1,2}$/.exec(String(sheet.sheet_name ?? '').trim());
    return { plant, sheetDate: m && d ? `${m[1]}-${m[2]}-${d[0].padStart(2, '0')}` : null };
}
/**
 * line name → plant and area. Read from the sheet "ตั้งค่าไลน์" next to the line sheet (columns ไลน์ / โรงงาน / พื้นที่);
 * a line that is not there falls back to the "Plant" column of the line sheet itself.
 */
async function lineInfo(lineLookup) {
    const out = new Map();
    if (!lineLookup)
        return out;
    const readAll = async (sheetId, cols) => {
        const rows = [];
        for (let p = 1; p <= 10; p++) {
            const r = await (0, rowQuery_1.queryRows)(sheetId, cols, { page: p, pageSize: 1000 });
            rows.push(...r.rows.map((x) => x.values));
            if (r.rows.length < 1000)
                break;
        }
        return rows;
    };
    const lineCols = await (0, cellWriter_1.loadColumns)(lineLookup.sheetId);
    const oldPlant = lineCols.find((c) => c.column_name === 'Plant');
    if (oldPlant)
        for (const v of await readAll(lineLookup.sheetId, lineCols)) {
            const plant = (0, model_1.normalizePlant)(v[oldPlant.column_id]);
            if (plant)
                out.set((0, exports.norm)(v[lineLookup.columnId]), { plant });
        }
    const setup = await (0, db_1.q1)(`SELECT s2.sheet_id FROM Sheets s1 JOIN Sheets s2 ON s2.file_id = s1.file_id AND s2.is_deleted = 0 AND s2.sheet_name = N'ตั้งค่าไลน์' WHERE s1.sheet_id = @s`, { s: db_1.T.uuid(lineLookup.sheetId) });
    if (setup) {
        const cols = await (0, cellWriter_1.loadColumns)(setup.sheet_id);
        const c = (n) => cols.find((x) => x.column_name === n)?.column_id;
        const cl = c('ไลน์'), cp = c('โรงงาน'), ca = c('พื้นที่');
        if (cl)
            for (const v of await readAll(setup.sheet_id, cols)) {
                const plant = cp ? (0, model_1.normalizePlant)(v[cp]) : '', area = ca ? String(v[ca] ?? '').trim() : '';
                if (plant || area)
                    out.set((0, exports.norm)(v[cl]), { ...(out.get((0, exports.norm)(v[cl])) ?? {}), ...(plant ? { plant } : {}), ...(area ? { area } : {}) });
            }
    }
    return out;
}
async function linePlants(lineLookup) {
    return new Map([...(await lineInfo(lineLookup))].filter(([, v]) => v.plant).map(([k, v]) => [k, v.plant]));
}
async function context(user, sheetId) {
    const { sheet, ctx: permCtx } = await (0, permissions_1.requireSheet)(user, sheetId, permissions_1.LV.write);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const byName = new Map(cols.map((c) => [c.column_name, c]));
    for (const n of [exports.NAMES.date, exports.NAMES.line, exports.NAMES.doc, exports.NAMES.market])
        if (!byName.has(n))
            throw (0, http_1.badRequest)(`ตารางนี้ไม่มีคอลัมน์ "${n}" — ใช้กับชีต Worksheet ของ InkCode เท่านั้น`);
    const lineLookup = (0, lookup_1.getLookup)((0, cellValue_1.toColumnDef)(byName.get(exports.NAMES.line)));
    const knownLines = lineLookup ? await (0, lookup_1.lookupValues)(lineLookup, null) : [];
    // the database sheet = where the document-code drop-down reads from
    const docLookup = (0, lookup_1.getLookup)((0, cellValue_1.toColumnDef)(byName.get(exports.NAMES.doc)));
    const mktLookup = (0, lookup_1.getLookup)((0, cellValue_1.toColumnDef)(byName.get(exports.NAMES.market)));
    const place = placeOf(permCtx, sheet);
    return { cols, byName, knownLines, docLookup, mktLookup, lineLookup, ...place, plants: place.plant ? await linePlants(lineLookup) : new Map() };
}
/** (document, market) pairs that exist in the database sheet */
async function dbPairs(docs, docLookup, mktLookup) {
    const pairs = new Map();
    if (!docLookup || !mktLookup || docLookup.sheetId !== mktLookup.sheetId)
        return { pairs, known: false };
    const dbCols = await (0, cellWriter_1.loadColumns)(docLookup.sheetId);
    const uniq = [...new Set(docs)];
    for (let i = 0; i < uniq.length; i += 100) {
        const r = await (0, rowQuery_1.queryRows)(docLookup.sheetId, dbCols, { page: 1, pageSize: 1000, filters: [{ columnId: docLookup.columnId, values: uniq.slice(i, i + 100) }] });
        for (const row of r.rows) {
            const d = (0, exports.norm)(row.values[docLookup.columnId]);
            const m = String(row.values[mktLookup.columnId] ?? '');
            if (!pairs.has(d))
                pairs.set(d, new Set());
            pairs.get(d).add(m);
        }
    }
    return { pairs, known: true };
}
const annotate = (items, pairs, dbKnown, plants, myPlant) => items.map((i) => {
    const ms = pairs.get((0, exports.norm)(i.doc));
    const market = ms ? [...ms].find((m) => (0, exports.norm)(m) === (0, exports.norm)(i.country)) : undefined;
    const plant = plants.get((0, exports.norm)(i.line)) ?? null;
    return { ...i, inDb: dbKnown ? !!market : null, market: market ?? i.country, dbMarkets: ms ? [...ms] : [], docInDb: dbKnown ? !!ms : null, plant, otherPlant: !!(myPlant && plant && plant !== myPlant) };
});
exports.annotate = annotate;
/**
 * Adds plan items as rows of one worksheet sheet. Rows already there for that date (same line + document + market [+ time]) are
 * not added twice. `items` carry the annotate() flags.
 */
async function insertItems(user, sheet, sheetId, ctx, items, date, o, req) {
    const idOf = (n) => ctx.byName.get(n)?.column_id;
    const existing = new Set();
    const keyOf = (line, doc, market, time) => [(0, exports.norm)(line), (0, exports.norm)(doc), (0, exports.norm)(market), (0, exports.norm)(time)].join('|');
    for (let p = 1; p <= 20; p++) {
        const r = await (0, rowQuery_1.queryRows)(sheetId, ctx.cols, { page: p, pageSize: 1000, filters: [{ columnId: idOf(exports.NAMES.date), op: 'eq', value: date }] });
        for (const row of r.rows) {
            const v = row.values;
            existing.add(keyOf(v[idOf(exports.NAMES.line)], v[idOf(exports.NAMES.doc)], v[idOf(exports.NAMES.market)], idOf(exports.NAMES.time) ? v[idOf(exports.NAMES.time)] : ''));
        }
        if (r.rows.length < 1000)
            break;
    }
    const result = { created: 0, duplicate: 0, skippedNotInDb: 0, skippedOtherPlant: 0, failed: [] };
    for (const it of items) {
        if (o.onlyPlant && it.otherPlant) {
            result.skippedOtherPlant++;
            continue;
        }
        if (o.onlyMatched && it.inDb === false) {
            result.skippedNotInDb++;
            continue;
        }
        const k = keyOf(it.line, it.doc, it.market, idOf(exports.NAMES.time) ? it.time : '');
        if (existing.has(k)) {
            result.duplicate++;
            continue;
        }
        const values = { [idOf(exports.NAMES.date)]: date, [idOf(exports.NAMES.line)]: it.line, [idOf(exports.NAMES.doc)]: it.doc, [idOf(exports.NAMES.market)]: it.market };
        if (idOf(exports.NAMES.shift))
            values[idOf(exports.NAMES.shift)] = it.shift;
        if (idOf(exports.NAMES.qty) && it.qty !== null)
            values[idOf(exports.NAMES.qty)] = it.qty;
        if (idOf(exports.NAMES.time) && it.time)
            values[idOf(exports.NAMES.time)] = it.time;
        try {
            await (0, db_1.withTx)((tx) => (0, rowCreate_1.createRowTx)(tx, user, sheet, sheetId, values, 'plan-import', req));
            existing.add(k);
            result.created++;
        }
        catch (e) {
            if (result.failed.length < 50)
                result.failed.push({ doc: it.doc, line: it.line, reason: e.message });
        }
    }
    (0, socket_1.emitToSheet)(sheetId, 'rows:changed', { sheetId, action: 'import', by: user.displayName });
    await (0, audit_1.audit)({ userId: user.id, action: 'inkcode_plan_import', entityType: 'sheet', entityId: sheetId, fileId: sheet.file_id, sheetId, newValue: { date, ...result, failed: result.failed.length } }, req);
    return result;
}
//# sourceMappingURL=core.js.map