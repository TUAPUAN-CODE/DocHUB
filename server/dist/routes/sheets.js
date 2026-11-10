"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PREFS = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const permissions_1 = require("../shared/permissions");
const cellWriter_1 = require("../services/cellWriter");
const structure_1 = require("../services/structure");
const schemas_1 = require("../shared/schemas");
const files_1 = require("./files");
const union_1 = require("../services/union");
const hooks_1 = require("../services/hooks");
const router = (0, express_1.Router)();
exports.DEFAULT_PREFS = {
    zoom: 1,
    frozenCols: 0,
    frozenRows: 0,
    colWidths: {},
    rowHeights: {},
    hiddenCols: [],
    rowHeight: 34,
    pageSize: 100,
};
router.get('/sheets/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { sheet, level } = await (0, permissions_1.requireSheet)(req.user, id, permissions_1.LV.read);
    const cols = await (0, cellWriter_1.loadColumns)(id, null, level >= permissions_1.LV.manage);
    const prefsRow = await (0, db_1.q1)(`SELECT prefs_json FROM UserSheetPrefs WHERE user_id = @u AND sheet_id = @s`, { u: db_1.T.uuid(req.user.id), s: db_1.T.uuid(id) });
    const union = await (0, union_1.unionStatus)(sheet);
    if (union)
        (0, union_1.syncUnionIfStale)(sheet);
    const columnsOut = cols.filter((c) => !c.is_deleted).map(mappers_1.mapColumn);
    if (level >= permissions_1.LV.manage)
        await (0, hooks_1.runColumnDecorators)({ user: req.user, sheetId: id, columns: columnsOut });
    (0, http_1.ok)(res, {
        union,
        settings: (0, http_1.safeJson)(sheet.settings_json, {}) ?? {},
        sheet: (0, mappers_1.mapSheet)(sheet),
        file: { id: sheet.file_id, name: sheet.file_name, folderId: sheet.folder_id },
        level,
        permission: (0, permissions_1.levelName)(level),
        columns: columnsOut,
        deletedColumns: cols.filter((c) => c.is_deleted).map(mappers_1.mapColumn),
        prefs: { ...exports.DEFAULT_PREFS, ...(0, http_1.safeJson)(prefsRow?.prefs_json, {}) },
    });
}));
router.put('/sheets/:id/prefs', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, id, permissions_1.LV.read);
    const prefs = (0, http_1.parse)(zod_1.z.object({
        zoom: zod_1.z.number().min(0.25).max(3).optional(),
        frozenCols: zod_1.z.number().int().min(0).max(50).optional(),
        frozenRows: zod_1.z.number().int().min(0).max(50).optional(),
        colWidths: zod_1.z.record(zod_1.z.number().min(30).max(2000)).optional(),
        rowHeights: zod_1.z.record(zod_1.z.number().min(18).max(600)).optional(),
        hiddenCols: zod_1.z.array(zod_1.z.string().max(60)).max(500).optional(),
        rowHeight: zod_1.z.number().min(20).max(200).optional(),
        pageSize: zod_1.z.number().int().min(10).max(1000).optional(),
        query: zod_1.z.object({ sorts: zod_1.z.array(schemas_1.sortSchema).max(5), filters: zod_1.z.array(schemas_1.filterSchema).max(50) }).optional(),
    }), req.body);
    const json = JSON.stringify(prefs);
    if (json.length > 200_000)
        throw (0, http_1.badRequest)('ข้อมูลการตั้งค่ามีขนาดใหญ่เกินไป');
    await (0, db_1.q)(`MERGE UserSheetPrefs AS t USING (SELECT @u AS user_id, @s AS sheet_id) AS s
       ON t.user_id = s.user_id AND t.sheet_id = s.sheet_id
       WHEN MATCHED THEN UPDATE SET prefs_json = @j, updated_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (user_id, sheet_id, prefs_json) VALUES (s.user_id, s.sheet_id, @j);`, { u: db_1.T.uuid(req.user.id), s: db_1.T.uuid(id), j: db_1.T.text(json) });
    (0, http_1.ok)(res, { ...exports.DEFAULT_PREFS, ...prefs });
}));
router.post('/files/:fileId/sheets', (0, http_1.ah)(async (req, res) => {
    const fileId = (0, http_1.pid)(req, 'fileId');
    const u = req.user;
    await (0, permissions_1.requireFile)(u, fileId, permissions_1.LV.manage);
    const body = (0, http_1.parse)(schemas_1.sheetInput.extend({ copyStructureFrom: http_1.zId.nullish() }), req.body);
    const exists = await (0, db_1.q1)(`SELECT 1 AS x FROM Sheets WHERE file_id = @f AND is_deleted = 0 AND sheet_name = @n`, { f: db_1.T.uuid(fileId), n: body.name });
    if (exists)
        throw (0, http_1.conflict)('มีชีตชื่อนี้อยู่แล้ว');
    (0, structure_1.assertUniqueNames)(body.columns.map((c) => c.name));
    const order = await (0, db_1.q1)(`SELECT ISNULL(MAX(sort_order), -1) + 1 AS o FROM Sheets WHERE file_id = @f`, { f: db_1.T.uuid(fileId) });
    const sheetId = await (0, db_1.withTx)(async (tx) => {
        if (body.copyStructureFrom) {
            const src = await (0, db_1.q1)(`SELECT file_id FROM Sheets WHERE sheet_id = @s AND is_deleted = 0`, { s: db_1.T.uuid(body.copyStructureFrom) }, tx);
            if (!src || src.file_id !== fileId)
                throw (0, http_1.badRequest)('ชีตต้นแบบไม่ถูกต้อง');
            return (0, files_1.copySheet)(tx, body.copyStructureFrom, fileId, order.o, u.id, false, body.name);
        }
        const sh = await (0, db_1.q1)(`INSERT INTO Sheets (file_id, sheet_name, sort_order, tab_color, created_by) OUTPUT inserted.sheet_id VALUES (@f, @n, @o, @c, @u)`, { f: db_1.T.uuid(fileId), n: body.name, o: db_1.T.int(order.o), c: db_1.T.text(body.tabColor ?? null), u: db_1.T.uuid(u.id) }, tx);
        const cols = body.columns.length ? body.columns : [{ name: 'คอลัมน์ 1', dataType: 'varchar', isRequired: false, width: 180 }];
        for (const [i, c] of cols.entries())
            await (0, structure_1.insertColumn)(tx, sh.sheet_id, c, i, u.id);
        return sh.sheet_id;
    });
    await (0, audit_1.audit)({ userId: u.id, action: 'sheet_create', entityType: 'sheet', entityId: sheetId, fileId, sheetId, newValue: { name: body.name } }, req);
    const s = await (0, db_1.q1)(`SELECT * FROM Sheets WHERE sheet_id = @s`, { s: db_1.T.uuid(sheetId) });
    (0, http_1.ok)(res, (0, mappers_1.mapSheet)(s), 201);
}));
/** Sheet-level settings (managers): which columns get a button in the filter / sort bar above the table */
router.put('/sheets/:id/settings', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, id, permissions_1.LV.manage, undefined, true);
    const body = (0, http_1.parse)(zod_1.z.object({ filterColumns: zod_1.z.array(http_1.zId).max(1000).nullable() }), req.body);
    const settings = { ...((0, http_1.safeJson)(sheet.settings_json, {}) ?? {}), filterColumns: body.filterColumns };
    await (0, db_1.q)(`UPDATE Sheets SET settings_json = @j, updated_at = SYSUTCDATETIME() WHERE sheet_id = @s`, { j: db_1.T.text(JSON.stringify(settings)), s: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'sheet_update', entityType: 'sheet', entityId: id, fileId: sheet.file_id, sheetId: id, newValue: { filterColumns: body.filterColumns?.length ?? 'all' } }, req);
    (0, http_1.ok)(res, { saved: true, settings });
}));
router.put('/sheets/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, id, permissions_1.LV.manage, undefined, true);
    const body = (0, http_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(200).optional(), tabColor: http_1.zColor.nullish() }), req.body);
    if (body.name && body.name !== sheet.sheet_name) {
        const exists = await (0, db_1.q1)(`SELECT 1 AS x FROM Sheets WHERE file_id = @f AND is_deleted = 0 AND sheet_name = @n AND sheet_id <> @s`, { f: db_1.T.uuid(sheet.file_id), n: body.name, s: db_1.T.uuid(id) });
        if (exists)
            throw (0, http_1.conflict)('มีชีตชื่อนี้อยู่แล้ว');
    }
    await (0, db_1.q)(`UPDATE Sheets SET sheet_name = COALESCE(@n, sheet_name), tab_color = CASE WHEN @hasC = 1 THEN @c ELSE tab_color END,
         updated_at = SYSUTCDATETIME() WHERE sheet_id = @s`, { n: db_1.T.text(body.name ?? null), hasC: body.tabColor !== undefined, c: db_1.T.text(body.tabColor ?? null), s: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'sheet_update', entityType: 'sheet', entityId: id, fileId: sheet.file_id, sheetId: id,
        oldValue: { name: sheet.sheet_name, tabColor: sheet.tab_color }, newValue: body }, req);
    (0, http_1.ok)(res, { updated: true });
}));
router.post('/files/:fileId/sheets/reorder', (0, http_1.ah)(async (req, res) => {
    const fileId = (0, http_1.pid)(req, 'fileId');
    await (0, permissions_1.requireFile)(req.user, fileId, permissions_1.LV.manage);
    const { ids } = (0, http_1.parse)(zod_1.z.object({ ids: zod_1.z.array(http_1.zId).min(1).max(100) }), req.body);
    await (0, db_1.withTx)(async (tx) => {
        for (const [i, sid] of ids.entries())
            await (0, db_1.q)(`UPDATE Sheets SET sort_order = @o WHERE sheet_id = @s AND file_id = @f`, { o: db_1.T.int(i), s: db_1.T.uuid(sid), f: db_1.T.uuid(fileId) }, tx);
    });
    (0, http_1.ok)(res, { reordered: true });
}));
router.delete('/sheets/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, id, permissions_1.LV.manage, undefined, true);
    const count = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM Sheets WHERE file_id = @f AND is_deleted = 0`, { f: db_1.T.uuid(sheet.file_id) });
    if (Number(count?.n) <= 1)
        throw (0, http_1.badRequest)('ไฟล์ต้องมีอย่างน้อย 1 ชีต');
    await (0, db_1.q)(`UPDATE Sheets SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE sheet_id = @s`, { s: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'sheet_delete', entityType: 'sheet', entityId: id, fileId: sheet.file_id, sheetId: id,
        oldValue: { name: sheet.sheet_name } }, req);
    (0, http_1.ok)(res, { deleted: true });
}));
exports.default = router;
//# sourceMappingURL=sheets.js.map