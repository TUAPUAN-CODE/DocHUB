"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../../config/db");
const http_1 = require("../../shared/http");
const mappers_1 = require("../../shared/mappers");
const permissions_1 = require("../../shared/permissions");
const rowQuery_1 = require("../../services/rowQuery");
const service_1 = require("../pageAccess/service");
/**
 * "Search" (menu Search): one word or phrase → every row of every sheet the user can read whose data contains it,
 * grouped by file / sheet. Union sheets are skipped (their rows are copies of other sheets' rows).
 */
const router = (0, express_1.Router)();
const MAX_ROWS = 200;
const PREVIEW_COLS = 4;
router.get('/search/data', (0, service_1.requirePage)('search'), (0, http_1.ah)(async (req, res) => {
    const text = String(req.query.q ?? '').trim().slice(0, 100);
    if (text.length < 2)
        throw (0, http_1.badRequest)('พิมพ์อย่างน้อย 2 ตัวอักษร');
    const ctx = await permissions_1.PermCtx.load(req.user);
    // files / sheets this user can read
    const files = (await (0, db_1.q)(`SELECT file_id, file_name, folder_id, created_by, color FROM Files WHERE is_deleted = 0`))
        .filter((f) => ctx.fileLevel(f) >= permissions_1.LV.read);
    if (!files.length)
        return (0, http_1.ok)(res, { q: text, groups: [], total: 0, truncated: false });
    const fileById = new Map(files.map((f) => [String(f.file_id).toLowerCase(), f]));
    const sheets = await (0, db_1.q)(`SELECT sheet_id, sheet_name, file_id, sort_order FROM Sheets
       WHERE is_deleted = 0 AND union_config IS NULL AND file_id IN ${(0, db_1.idList)('@f')}`, { f: (0, db_1.jsonParam)(files.map((f) => f.file_id)) });
    if (!sheets.length)
        return (0, http_1.ok)(res, { q: text, groups: [], total: 0, truncated: false });
    const sheetIds = sheets.map((s) => s.sheet_id);
    // a select option's label (e.g. "กะดึก") is stored as its value (e.g. "Night"): search the labels too
    const optionHits = [];
    const lower = text.toLowerCase();
    for (const c of await (0, db_1.q)(`SELECT column_id, select_options FROM Columns WHERE is_deleted = 0 AND select_options IS NOT NULL AND sheet_id IN ${(0, db_1.idList)('@s')}`, { s: (0, db_1.jsonParam)(sheetIds) })) {
        let opts = [];
        try {
            opts = JSON.parse(c.select_options ?? '[]');
        }
        catch { /* ignore */ }
        for (const o of opts)
            if (o?.value && o.label && o.label !== o.value && String(o.label).toLowerCase().includes(lower))
                optionHits.push({ col: c.column_id, value: String(o.value) });
    }
    const like = `%${(0, http_1.likeEscape)(text)}%`;
    const optionSql = optionHits.length
        ? `OR EXISTS (SELECT 1 FROM OPENJSON(@opts) WITH (col UNIQUEIDENTIFIER '$.col', value NVARCHAR(500) '$.value') o
           WHERE o.col = c.column_id AND (c.value_text = o.value OR c.value_json LIKE '%"' + o.value + '"%'))`
        : '';
    const hits = await (0, db_1.q)(`SELECT TOP 2000 c.row_id, c.column_id, r.sheet_id, r.updated_at
       FROM Cells c
       JOIN Rows r ON r.row_id = c.row_id AND r.is_deleted = 0
       JOIN Columns cc ON cc.column_id = c.column_id AND cc.is_deleted = 0
       WHERE r.sheet_id IN ${(0, db_1.idList)('@s')}
         AND (c.value_text LIKE @t OR c.value_json LIKE @t
           OR CONVERT(NVARCHAR(40), c.value_int) LIKE @t OR CONVERT(NVARCHAR(60), c.value_float) LIKE @t
           OR CONVERT(NVARCHAR(10), c.value_date, 23) LIKE @t ${optionSql})
       ORDER BY r.updated_at DESC`, { s: (0, db_1.jsonParam)(sheetIds), t: db_1.T.text(like), opts: db_1.T.text(JSON.stringify(optionHits)) });
    // rows (newest first) → which of their columns matched
    const matched = new Map();
    for (const h of hits) {
        const k = String(h.row_id).toLowerCase();
        if (!matched.has(k)) {
            if (matched.size >= MAX_ROWS)
                continue;
            matched.set(k, { sheetId: String(h.sheet_id).toLowerCase(), cols: new Set() });
        }
        matched.get(k).cols.add(String(h.column_id).toLowerCase());
    }
    const truncated = hits.length >= 2000 || new Set(hits.map((h) => String(h.row_id).toLowerCase())).size > matched.size;
    const groups = [];
    const userIds = [];
    for (const s of sheets) {
        const sid = String(s.sheet_id).toLowerCase();
        const rowIds = [...matched.entries()].filter(([, m]) => m.sheetId === sid).map(([id]) => id);
        if (!rowIds.length)
            continue;
        const cols = await (0, db_1.q)(`SELECT * FROM Columns WHERE sheet_id = @s AND is_deleted = 0 ORDER BY display_order, created_at`, { s: db_1.T.uuid(s.sheet_id) });
        const records = await (0, db_1.q)(`SELECT row_id, row_order, created_by, created_at, updated_by, updated_at FROM Rows WHERE row_id IN ${(0, db_1.idList)('@ids')} ORDER BY updated_at DESC`, { ids: (0, db_1.jsonParam)(rowIds) });
        const { rows, userIds: u } = await (0, rowQuery_1.hydrateRows)(records, cols);
        userIds.push(...u);
        const file = fileById.get(String(s.file_id).toLowerCase());
        const preview = new Set(cols.filter((c) => !['image'].includes(c.data_type)).slice(0, PREVIEW_COLS).map((c) => String(c.column_id).toLowerCase()));
        const hitCols = new Set(rowIds.flatMap((id) => [...matched.get(id).cols]));
        groups.push({
            fileId: file.file_id,
            fileName: file.file_name,
            color: file.color,
            path: ctx.pathText(file.folder_id),
            sheetId: s.sheet_id,
            sheetName: s.sheet_name,
            columns: cols.filter((c) => preview.has(String(c.column_id).toLowerCase()) || hitCols.has(String(c.column_id).toLowerCase())).map(mappers_1.mapColumn),
            rows: rows.map((r) => ({ id: r.id, order: r.order, updatedAt: r.updatedAt, values: r.values, matched: [...matched.get(String(r.id).toLowerCase()).cols] })),
        });
    }
    groups.sort((a, b) => b.rows.length - a.rows.length);
    (0, http_1.ok)(res, { q: text, groups, total: matched.size, truncated, users: await (0, rowQuery_1.userNames)(userIds) });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map