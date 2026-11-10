"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeRows = describeRows;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const cellValue_1 = require("../../shared/cellValue");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const cellWriter_1 = require("../../services/cellWriter");
const rowFind_1 = require("../../services/rowFind");
const sheetSettings_1 = require("../../services/sheetSettings");
const timeLink_1 = require("./timeLink");
const router = (0, express_1.Router)();
const MAX_NODES = 300;
/** All links reachable from a row in one direction (back = what it was made of / sits in, forward = what was made of it / what sits in it) */
async function walk(rowId, dir, depth) {
    const [self, other] = dir === 'back' ? ['child_row_id', 'parent_row_id'] : ['parent_row_id', 'child_row_id'];
    return (0, db_1.q)(`WITH t AS (
       SELECT l.link_id, l.parent_row_id, l.child_row_id, l.qty, l.role, 1 AS lvl,
              CAST(N'/' + CAST(l.${self} AS NVARCHAR(40)) + N'/' + CAST(l.${other} AS NVARCHAR(40)) + N'/' AS NVARCHAR(4000)) AS path
       FROM RowLinks l WHERE l.${self} = @r
       UNION ALL
       SELECT l.link_id, l.parent_row_id, l.child_row_id, l.qty, l.role, t.lvl + 1,
              CAST(t.path + CAST(l.${other} AS NVARCHAR(40)) + N'/' AS NVARCHAR(4000))
       FROM RowLinks l JOIN t ON l.${self} = t.${other}
       WHERE t.lvl < @d AND t.path NOT LIKE N'%/' + CAST(l.${other} AS NVARCHAR(40)) + N'/%'
     )
     SELECT TOP ${MAX_NODES * 2} link_id, parent_row_id, child_row_id, qty, role, lvl FROM t ORDER BY lvl, link_id OPTION (MAXRECURSION 60)`, { r: db_1.T.uuid(rowId), d: db_1.T.int(depth) });
}
const fmtCell = (type, row) => {
    const v = (0, cellValue_1.fromStorage)(type, row);
    if (v === null || v === '')
        return '';
    return Array.isArray(v) ? v.join(', ') : String(v);
};
/** The sheet's own idea of "what identifies a row": mix key column, then the key of a scan format, then the first column */
async function labelColumn(sheetId, cols) {
    const s = await (0, sheetSettings_1.readSettings)(sheetId);
    const id = s.mix?.keyColumnId ?? (s.scanProfiles ?? []).find((p) => p.keyColumnId)?.keyColumnId ?? null;
    return id ?? cols[0]?.column_id ?? null;
}
router.post('/sheets/:id/find', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read);
    const body = (0, http_1.parse)(zod_1.z.object({ columnId: http_1.zId, value: zod_1.z.string().trim().min(1).max(500) }), req.body);
    const col = (await (0, cellWriter_1.loadColumns)(sheetId)).find((c) => c.column_id === body.columnId);
    if (!col)
        throw (0, http_1.badRequest)('ไม่พบคอลัมน์');
    const f = await (0, rowFind_1.findRowByValue)(sheetId, col, body.value);
    if (!f)
        throw (0, http_1.notFound)(`ไม่พบแถวที่ ${col.column_name} = “${body.value}”`);
    (0, http_1.ok)(res, { rowId: f.rowId, rowNo: f.rowNo });
}));
/** Rows → the boxes shown in the traceback (label + a few fields); rows of sheets the user cannot read are "restricted" */
async function describeRows(u, ids) {
    const rows = await (0, db_1.q)(`SELECT r.row_id, r.row_order, r.sheet_id, r.created_at, sh.sheet_name, f.file_id, f.file_name
     FROM Rows r JOIN Sheets sh ON sh.sheet_id = r.sheet_id JOIN Files f ON f.file_id = sh.file_id
     WHERE r.row_id IN ${(0, db_1.idList)('@ids')}`, { ids: (0, db_1.jsonParam)(ids) });
    // per sheet: may the user read it, and which columns identify / summarise a row
    const sheetInfo = new Map();
    for (const sid of new Set(rows.map((r) => String(r.sheet_id).toLowerCase()))) {
        let readable = true;
        try {
            await (0, permissions_1.requireSheet)(u, sid, permissions_1.LV.read);
        }
        catch {
            readable = false;
        }
        if (!readable) {
            sheetInfo.set(sid, { readable, cols: [], label: null, show: [] });
            continue;
        }
        const cols = await (0, cellWriter_1.loadColumns)(sid);
        const label = await labelColumn(sid, cols);
        const show = cols.filter((c) => c.column_id !== label && !['image', 'multi_select'].includes(c.data_type)).slice(0, 5);
        sheetInfo.set(sid, { readable, cols, label, show });
    }
    const values = new Map();
    for (const [sid, info] of sheetInfo) {
        if (!info.readable)
            continue;
        const want = [info.label, ...info.show.map((c) => c.column_id)].filter(Boolean);
        const rowIds = rows.filter((r) => String(r.sheet_id).toLowerCase() === sid).map((r) => String(r.row_id).toLowerCase());
        if (!want.length || !rowIds.length)
            continue;
        const cells = await (0, db_1.q)(`SELECT row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json FROM Cells WHERE row_id IN ${(0, db_1.idList)('@ids')} AND column_id IN ${(0, db_1.idList)('@cc')}`, { ids: (0, db_1.jsonParam)(rowIds), cc: (0, db_1.jsonParam)(want) });
        for (const c of cells) {
            const k = String(c.row_id).toLowerCase();
            if (!values.has(k))
                values.set(k, new Map());
            values.get(k).set(String(c.column_id).toLowerCase(), c);
        }
    }
    return rows.map((r) => {
        const rid = String(r.row_id).toLowerCase();
        const info = sheetInfo.get(String(r.sheet_id).toLowerCase());
        const base = { rowId: rid, rowNo: Number(r.row_order), sheetId: String(r.sheet_id).toLowerCase(), sheetName: r.sheet_name, fileId: String(r.file_id).toLowerCase(), fileName: r.file_name, createdAt: r.created_at };
        if (!info.readable)
            return { ...base, restricted: true, label: null, fields: [] };
        const cell = (colId) => (colId ? values.get(rid)?.get(colId.toLowerCase()) : undefined);
        const lc = info.cols.find((c) => c.column_id === info.label);
        return {
            ...base, restricted: false,
            label: lc && cell(info.label) ? fmtCell(lc.data_type, cell(info.label)) : null,
            fields: info.show.map((c) => ({ name: c.column_name, type: c.data_type, value: cell(c.column_id) ? fmtCell(c.data_type, cell(c.column_id)) : '' })).filter((f) => f.value !== ''),
        };
    });
}
/** Traceback of one row, both directions. Rows of sheets the user cannot read are shown as "restricted" (no values). */
router.get('/trace/rows/:rowId', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const rowId = String(req.params.rowId);
    const query = (0, http_1.parse)(zod_1.z.object({ dir: zod_1.z.enum(['back', 'forward', 'both']).default('both'), depth: zod_1.z.coerce.number().int().min(1).max(12).default(8) }), req.query);
    const start = await (0, db_1.q1)(`SELECT row_id, sheet_id FROM Rows WHERE row_id = @r AND is_deleted = 0`, { r: db_1.T.uuid(rowId) });
    if (!start)
        throw (0, http_1.notFound)('ไม่พบแถว');
    await (0, permissions_1.requireSheet)(u, start.sheet_id, permissions_1.LV.read);
    const links = [];
    for (const dir of query.dir === 'both' ? ['back', 'forward'] : [query.dir]) {
        for (const r of await walk(rowId, dir, query.depth))
            links.push({ id: Number(r.link_id), parent: String(r.parent_row_id).toLowerCase(), child: String(r.child_row_id).toLowerCase(), qty: r.qty ?? null, role: r.role, lvl: Number(r.lvl), dir });
    }
    const ids = [...new Set([rowId.toLowerCase(), ...links.flatMap((l) => [l.parent, l.child])])].slice(0, MAX_NODES);
    const nodes = await describeRows(u, ids);
    (0, http_1.ok)(res, { startRowId: rowId.toLowerCase(), nodes, links, truncated: ids.length >= MAX_NODES });
}));
/* ---------------- link two tables by time ---------------- */
const linkSchema = zod_1.z.object({
    id: zod_1.z.string().trim().min(1).max(40), name: zod_1.z.string().trim().min(1).max(80),
    targetSheetId: http_1.zId,
    aStartColumnId: http_1.zId, aEndColumnId: http_1.zId.nullish(), aKeyColumnId: http_1.zId.nullish(),
    bStartColumnId: http_1.zId, bEndColumnId: http_1.zId.nullish(), bKeyColumnId: http_1.zId.nullish(),
    toleranceMin: zod_1.z.number().min(0).max(1440).nullish(), windowHours: zod_1.z.number().min(1).max(24 * 31).nullish(),
});
/** Managers: which other table this one is linked to by time (e.g. materials packed ↔ packaging used) */
router.put('/sheets/:id/time-links', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const { links } = (0, http_1.parse)(zod_1.z.object({ links: zod_1.z.array(linkSchema).max(10) }), req.body);
    const mine = new Set((await (0, cellWriter_1.loadColumns)(sheetId)).map((c) => c.column_id));
    for (const l of links) {
        await (0, permissions_1.requireSheet)(req.user, l.targetSheetId, permissions_1.LV.read);
        const theirs = new Map((await (0, cellWriter_1.loadColumns)(l.targetSheetId)).map((c) => [c.column_id, c]));
        for (const id of [l.aStartColumnId, l.aEndColumnId, l.aKeyColumnId])
            if (id && !mine.has(id))
                throw (0, http_1.badRequest)(`“${l.name}”: ไม่พบคอลัมน์ของตารางนี้ (อาจถูกลบแล้ว)`);
        for (const id of [l.bStartColumnId, l.bEndColumnId, l.bKeyColumnId])
            if (id && !theirs.has(id))
                throw (0, http_1.badRequest)(`“${l.name}”: ไม่พบคอลัมน์ของตารางที่เชื่อม (อาจถูกลบแล้ว)`);
        if (!!l.aKeyColumnId !== !!l.bKeyColumnId)
            throw (0, http_1.badRequest)(`“${l.name}”: ถ้าจับคู่ด้วยคอลัมน์ ต้องเลือกให้ครบทั้งสองตาราง`);
    }
    await (0, sheetSettings_1.writeSettingsKey)(sheetId, 'timeLinks', links.length ? links : null);
    (0, http_1.ok)(res, { saved: true });
}));
async function rowTimes(rowId, cols) {
    const ids = cols.filter(Boolean);
    const out = new Map();
    if (!ids.length)
        return out;
    for (const c of await (0, db_1.q)(`SELECT column_id, value_text, value_int, value_float, value_date, value_bool, value_json FROM Cells WHERE row_id = @r AND column_id IN ${(0, db_1.idList)('@cc')}`, { r: db_1.T.uuid(rowId), cc: (0, db_1.jsonParam)(ids) }))
        out.set(String(c.column_id).toLowerCase(), c);
    return out;
}
/** Rows of `cand` whose time window overlaps the window of the row (same key when both tables have a key column) */
async function overlapping(own, cand, tolMin, windowHours, now) {
    const ownCols = await (0, cellWriter_1.loadColumns)(own.sheetId);
    const type = (id) => ownCols.find((c) => c.column_id === id)?.data_type ?? 'text';
    const cells = await rowTimes(own.rowId, [own.startCol, own.endCol, own.keyCol]);
    const sCell = cells.get(own.startCol.toLowerCase());
    const eCell = own.endCol ? cells.get(own.endCol.toLowerCase()) : null;
    const a = (0, timeLink_1.interval)(sCell?.value_date ? new Date(sCell.value_date) : null, eCell?.value_date ? new Date(eCell.value_date) : null, now);
    if (!a)
        return { noTime: true, matches: [] };
    const key = own.keyCol && cells.get(own.keyCol.toLowerCase()) ? String((0, cellValue_1.fromStorage)(type(own.keyCol), cells.get(own.keyCol.toLowerCase())) ?? '').trim().toLowerCase() : null;
    if (cand.keyCol && !key)
        return { noTime: false, noKey: true, matches: [] };
    const from = new Date(a.s - (windowHours + tolMin / 60) * 3600_000);
    const to = new Date(a.e + tolMin * 60_000);
    const rows = await (0, db_1.q)(`SELECT TOP 500 r.row_id, s.value_date AS s_at, e.value_date AS e_at
     FROM Rows r
     JOIN Cells s ON s.row_id = r.row_id AND s.column_id = @bs AND s.value_date IS NOT NULL AND s.value_date >= @from AND s.value_date <= @to
     LEFT JOIN Cells e ON e.row_id = r.row_id AND e.column_id = @be
     ${cand.keyCol ? 'JOIN Cells k ON k.row_id = r.row_id AND k.column_id = @bk AND LOWER(LTRIM(RTRIM(COALESCE(k.value_text, CAST(k.value_int AS NVARCHAR(50)))))) = @key' : ''}
     WHERE r.sheet_id = @sheet AND r.is_deleted = 0 AND (e.value_date IS NULL OR e.value_date >= @fromEnd)
     ORDER BY s.value_date`, { bs: db_1.T.uuid(cand.startCol), be: db_1.T.uuid(cand.endCol ?? '00000000-0000-0000-0000-000000000000'), bk: db_1.T.uuid(cand.keyCol ?? '00000000-0000-0000-0000-000000000000'), key: db_1.T.text(key ?? ''),
        from: db_1.T.dt(from), to: db_1.T.dt(to), fromEnd: db_1.T.dt(new Date(a.s - tolMin * 60_000)), sheet: db_1.T.uuid(cand.sheetId) });
    const matches = rows.map((r) => {
        const b = (0, timeLink_1.interval)(new Date(r.s_at), r.e_at ? new Date(r.e_at) : null, now);
        const o = (0, timeLink_1.overlap)(a, b, tolMin);
        return { rowId: String(r.row_id).toLowerCase(), start: new Date(r.s_at), end: r.e_at ? new Date(r.e_at) : null, linked: o.linked, minutes: o.minutes };
    }).filter((m) => m.linked).sort((x, y) => y.minutes - x.minutes);
    return { noTime: false, matches };
}
/** The rows of other tables linked to this row by time — both ways (links set on this sheet, and links other sheets set towards it) */
router.get('/trace/time/rows/:rowId', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const rowId = String(req.params.rowId);
    const row = await (0, db_1.q1)(`SELECT r.row_id, r.sheet_id, sh.sheet_name FROM Rows r JOIN Sheets sh ON sh.sheet_id = r.sheet_id WHERE r.row_id = @r AND r.is_deleted = 0`, { r: db_1.T.uuid(rowId) });
    if (!row)
        throw (0, http_1.notFound)('ไม่พบแถว');
    const mySheet = String(row.sheet_id).toLowerCase();
    await (0, permissions_1.requireSheet)(u, mySheet, permissions_1.LV.read);
    const now = new Date();
    const jobs = [];
    const mine = ((await (0, sheetSettings_1.readSettings)(mySheet)).timeLinks ?? []);
    for (const l of mine)
        jobs.push({ link: l, reverse: false, ownSheet: mySheet, candSheet: l.targetSheetId.toLowerCase() });
    const others = await (0, db_1.q)(`SELECT sheet_id, settings_json FROM Sheets WHERE is_deleted = 0 AND settings_json LIKE @pat`, { pat: db_1.T.text(`%"targetSheetId":"${mySheet}"%`) });
    for (const o of others)
        for (const l of ((0, http_1.safeJson)(o.settings_json, {})?.timeLinks ?? []))
            if (l.targetSheetId.toLowerCase() === mySheet)
                jobs.push({ link: l, reverse: true, ownSheet: mySheet, candSheet: String(o.sheet_id).toLowerCase() });
    const groups = [];
    for (const j of jobs) {
        const l = j.link;
        let readable = true;
        try {
            await (0, permissions_1.requireSheet)(u, j.candSheet, permissions_1.LV.read);
        }
        catch {
            readable = false;
        }
        const meta = await (0, db_1.q1)(`SELECT sh.sheet_name, f.file_id, f.file_name FROM Sheets sh JOIN Files f ON f.file_id = sh.file_id WHERE sh.sheet_id = @s`, { s: db_1.T.uuid(j.candSheet) });
        const head = { linkId: l.id, name: l.name, reverse: j.reverse, other: { sheetId: j.candSheet, sheetName: meta?.sheet_name ?? '', fileId: meta ? String(meta.file_id).toLowerCase() : '', fileName: meta?.file_name ?? '' } };
        if (!readable) {
            groups.push({ ...head, restricted: true, noTime: false, noKey: false, matches: [] });
            continue;
        }
        const own = j.reverse ? { startCol: l.bStartColumnId, endCol: l.bEndColumnId, keyCol: l.bKeyColumnId } : { startCol: l.aStartColumnId, endCol: l.aEndColumnId, keyCol: l.aKeyColumnId };
        const cand = j.reverse ? { startCol: l.aStartColumnId, endCol: l.aEndColumnId, keyCol: l.aKeyColumnId } : { startCol: l.bStartColumnId, endCol: l.bEndColumnId, keyCol: l.bKeyColumnId };
        const r = await overlapping({ sheetId: j.ownSheet, rowId, ...own }, { sheetId: j.candSheet, ...cand }, l.toleranceMin ?? 0, l.windowHours ?? 72, now);
        const nodes = r.matches.length ? await describeRows(u, r.matches.map((m) => m.rowId)) : [];
        const byId = new Map(nodes.map((n) => [n.rowId, n]));
        groups.push({ ...head, restricted: false, noTime: !!r.noTime, noKey: 'noKey' in r && !!r.noKey,
            matches: r.matches.map((m) => ({ ...(byId.get(m.rowId) ?? { rowId: m.rowId }), start: m.start, end: m.end, overlapMin: m.minutes })) });
    }
    (0, http_1.ok)(res, { groups });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map