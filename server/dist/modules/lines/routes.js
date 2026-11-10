"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const cellWriter_1 = require("../../services/cellWriter");
const rowQuery_1 = require("../../services/rowQuery");
const sheetSettings_1 = require("../../services/sheetSettings");
const socket_1 = require("../../socket");
const routes_1 = require("../scan/routes");
const router = (0, express_1.Router)();
const cfgSchema = zod_1.z.object({
    lineSheetId: http_1.zId,
    displayColumnIds: zod_1.z.array(http_1.zId).max(12).nullish(),
    actions: zod_1.z.array(zod_1.z.object({ label: zod_1.z.string().trim().min(1).max(60), columnId: http_1.zId, kind: zod_1.z.enum(['now', 'value']), value: zod_1.z.string().max(200).nullish() })).max(10).nullish(),
});
async function linesCfg(sheetId) {
    const c = (await (0, sheetSettings_1.readSettings)(sheetId)).lines;
    if (!c?.lineSheetId)
        throw (0, http_1.badRequest)('ชีตนี้ยังไม่ได้ตั้งค่ารายการในแถว (ผู้จัดการตั้งได้ที่ปุ่ม ตั้งค่าสแกน/ผสม)');
    return c;
}
async function assertHeaderRow(sheetId, rowId) {
    const r = await (0, db_1.q1)(`SELECT row_id FROM Rows WHERE row_id = @r AND sheet_id = @s AND is_deleted = 0`, { r: db_1.T.uuid(rowId), s: db_1.T.uuid(sheetId) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบแถว (อาจถูกลบแล้ว)');
}
/** Managers: which sheet holds the line items of the rows of this sheet (e.g. trolley → materials on it) */
router.put('/sheets/:id/lines/settings', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ lines: cfgSchema.nullable() }), req.body);
    if (body.lines) {
        if (body.lines.lineSheetId.toLowerCase() === sheetId.toLowerCase())
            throw (0, http_1.badRequest)('ชีตรายการต้องเป็นคนละชีตกับชีตนี้');
        await (0, permissions_1.requireSheet)(req.user, body.lines.lineSheetId, permissions_1.LV.read);
        const cols = new Set((await (0, cellWriter_1.loadColumns)(body.lines.lineSheetId)).map((c) => c.column_id));
        for (const id of [...(body.lines.displayColumnIds ?? []), ...(body.lines.actions ?? []).map((a) => a.columnId)])
            if (!cols.has(id))
                throw (0, http_1.badRequest)('ไม่พบคอลัมน์ที่เลือกในชีตรายการ (อาจถูกลบแล้ว)');
    }
    await (0, sheetSettings_1.writeSettingsKey)(sheetId, 'lines', body.lines);
    (0, http_1.ok)(res, { saved: true });
}));
router.get('/sheets/:id/rows/:rowId/lines', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read);
    const cfg = await linesCfg(sheetId);
    await (0, permissions_1.requireSheet)(req.user, cfg.lineSheetId, permissions_1.LV.read);
    await assertHeaderRow(sheetId, String(req.params.rowId));
    const cols = await (0, cellWriter_1.loadColumns)(cfg.lineSheetId);
    const recs = await (0, db_1.q)(`SELECT r.row_id, r.row_order, r.created_by, r.created_at, r.updated_by, r.updated_at, r.deleted_at, r.deleted_by
     FROM RowLinks l JOIN Rows r ON r.row_id = l.child_row_id
     WHERE l.parent_row_id = @p AND l.role = N'contains' AND r.is_deleted = 0 ORDER BY l.link_id`, { p: db_1.T.uuid(String(req.params.rowId)) });
    const { rows, userIds } = await (0, rowQuery_1.hydrateRows)(recs, cols);
    (0, http_1.ok)(res, { lines: rows, users: await (0, rowQuery_1.userNames)(userIds) });
}));
/** Add a line: scan its QR (made / updated with the line sheet's formats) or attach an existing row. A line sits on one header at a time (attaching moves it). */
router.post('/sheets/:id/rows/:rowId/lines', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const u = req.user;
    const { sheet } = await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.write);
    const cfg = await linesCfg(sheetId);
    const { sheet: lineSheet } = await (0, permissions_1.requireSheet)(u, cfg.lineSheetId, permissions_1.LV.write);
    const headerRow = String(req.params.rowId);
    await assertHeaderRow(sheetId, headerRow);
    const body = (0, http_1.parse)(zod_1.z.object({ text: zod_1.z.string().min(1).max(2000).optional(), profileId: zod_1.z.string().max(40).nullish(), lineRowId: http_1.zId.optional() }), req.body);
    let lineRowId = body.lineRowId;
    let how = 'attached';
    if (!lineRowId) {
        if (!body.text)
            throw (0, http_1.badRequest)('กรุณาสแกนหรือระบุแถวรายการ');
        const r = await (0, routes_1.runScan)(u, lineSheet, cfg.lineSheetId, body.text, body.profileId, req);
        lineRowId = r.rowId;
        how = r.action;
    }
    else {
        const ex = await (0, db_1.q1)(`SELECT row_id FROM Rows WHERE row_id = @r AND sheet_id = @s AND is_deleted = 0`, { r: db_1.T.uuid(lineRowId), s: db_1.T.uuid(cfg.lineSheetId) });
        if (!ex)
            throw (0, http_1.notFound)('ไม่พบแถวรายการ');
    }
    const prev = await (0, db_1.q)(`SELECT parent_row_id FROM RowLinks WHERE child_row_id = @c AND role = N'contains'`, { c: db_1.T.uuid(lineRowId) });
    if (prev.some((p) => String(p.parent_row_id).toLowerCase() === headerRow.toLowerCase()))
        return (0, http_1.ok)(res, { rowId: lineRowId, how, already: true });
    if (prev.length) {
        await (0, db_1.q)(`DELETE FROM RowLinks WHERE child_row_id = @c AND role = N'contains'`, { c: db_1.T.uuid(lineRowId) });
        await (0, audit_1.audit)({ userId: u.id, action: 'line_move', entityType: 'row', entityId: lineRowId, fileId: lineSheet.file_id, sheetId: cfg.lineSheetId, oldValue: { header: prev[0].parent_row_id }, newValue: { header: headerRow } }, req);
    }
    await (0, db_1.q)(`INSERT INTO RowLinks (sheet_id, parent_row_id, child_row_id, qty, role, created_by) VALUES (@s, @p, @c, NULL, N'contains', @u)`, { s: db_1.T.uuid(cfg.lineSheetId), p: db_1.T.uuid(headerRow), c: db_1.T.uuid(lineRowId), u: db_1.T.uuid(u.id) });
    await (0, audit_1.audit)({ userId: u.id, action: 'line_add', entityType: 'row', entityId: headerRow, fileId: sheet.file_id, sheetId, newValue: { line: lineRowId, how } }, req);
    (0, socket_1.emitToSheet)(sheetId, 'rows:changed', { sheetId, action: 'lines', rowId: headerRow, by: u.displayName });
    (0, http_1.ok)(res, { rowId: lineRowId, how, moved: prev.length > 0 }, 201);
}));
router.delete('/sheets/:id/rows/:rowId/lines/:lineRowId', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const u = req.user;
    const { sheet } = await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.write);
    await linesCfg(sheetId);
    const r = await (0, db_1.q)(`DELETE FROM RowLinks WHERE parent_row_id = @p AND child_row_id = @c AND role = N'contains'`, { p: db_1.T.uuid(String(req.params.rowId)), c: db_1.T.uuid(String(req.params.lineRowId)) });
    void r;
    await (0, audit_1.audit)({ userId: u.id, action: 'line_remove', entityType: 'row', entityId: String(req.params.rowId), fileId: sheet.file_id, sheetId, oldValue: { line: req.params.lineRowId } }, req);
    (0, http_1.ok)(res, { removed: true });
}));
/** One action for every line on the header (e.g. "ออกห้องเย็น" stamps the time on all materials of the trolley) */
router.post('/sheets/:id/rows/:rowId/lines/action', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const u = req.user;
    await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.write);
    const cfg = await linesCfg(sheetId);
    const body = (0, http_1.parse)(zod_1.z.object({ index: zod_1.z.number().int().min(0).max(9) }), req.body);
    const act = cfg.actions?.[body.index];
    if (!act)
        throw (0, http_1.badRequest)('ไม่พบการกระทำนี้');
    const lines = await (0, db_1.q)(`SELECT l.child_row_id FROM RowLinks l JOIN Rows r ON r.row_id = l.child_row_id WHERE l.parent_row_id = @p AND l.role = N'contains' AND r.is_deleted = 0`, { p: db_1.T.uuid(String(req.params.rowId)) });
    if (!lines.length)
        throw (0, http_1.badRequest)('ยังไม่มีรายการในแถวนี้');
    const value = act.kind === 'now' ? new Date().toISOString() : act.value ?? '';
    const res2 = await (0, cellWriter_1.applyCellUpdates)(u, cfg.lineSheetId, lines.map((l) => ({ rowId: l.child_row_id, columnId: act.columnId, value })), { req, source: 'lines', partial: true });
    (0, http_1.ok)(res, { count: lines.length, result: res2 });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map