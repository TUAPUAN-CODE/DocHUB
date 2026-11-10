"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const union_1 = require("../services/union");
const router = (0, express_1.Router)();
const sourcesSchema = zod_1.z.array(http_1.zId).min(1).max(50);
/** New file whose only sheet gathers the rows of several sheets with identical columns */
router.post('/union/files', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    if ((0, auth_1.isBasicRole)(u.role))
        throw (0, http_1.forbidden)('เฉพาะ Master หรือ Admin เท่านั้นที่สร้างไฟล์ได้');
    const body = (0, http_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(300), folderId: http_1.zId, sources: sourcesSchema, color: http_1.zColor.nullish(), description: zod_1.z.string().max(1000).nullish() }), req.body);
    await (0, permissions_1.requireFolder)(u, body.folderId, permissions_1.LV.write);
    const infos = await (0, union_1.assertUnionSources)(u, body.sources);
    const out = await (0, db_1.withTx)(async (tx) => {
        const f = await (0, db_1.q1)(`INSERT INTO Files (file_name, folder_id, description, color, icon, created_by) OUTPUT inserted.file_id
         VALUES (@n, @fo, @d, COALESCE(@c, N'#0EA5E9'), N'sheet', @u)`, { n: body.name, fo: db_1.T.uuid(body.folderId), d: db_1.T.text(body.description ?? null), c: db_1.T.text(body.color ?? null), u: db_1.T.uuid(u.id) }, tx);
        const sheetId = await (0, union_1.createUnionSheet)(tx, f.file_id, 'รวมข้อมูล', 0, infos, u.id);
        await (0, audit_1.audit)({ userId: u.id, action: 'file_create', entityType: 'file', entityId: f.file_id, fileId: f.file_id,
            newValue: { name: body.name, union: infos.map((i) => i.label) } }, req, tx);
        return { fileId: f.file_id, sheetId };
    });
    await (0, union_1.syncUnion)(out.sheetId);
    (0, http_1.ok)(res, { id: out.fileId, sheetId: out.sheetId }, 201);
}));
/** Add a union sheet to an existing file */
router.post('/files/:id/sheets/union', (0, http_1.ah)(async (req, res) => {
    const fileId = (0, http_1.pid)(req);
    const u = req.user;
    await (0, permissions_1.requireFile)(u, fileId, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(200), sources: sourcesSchema }), req.body);
    const dup = await (0, db_1.q1)(`SELECT 1 AS x FROM Sheets WHERE file_id = @f AND is_deleted = 0 AND sheet_name = @n`, { f: db_1.T.uuid(fileId), n: body.name });
    if (dup)
        throw (0, http_1.conflict)('มีชีตชื่อนี้อยู่แล้ว');
    const infos = await (0, union_1.assertUnionSources)(u, body.sources);
    const sheetId = await (0, db_1.withTx)(async (tx) => {
        const o = await (0, db_1.q1)(`SELECT ISNULL(MAX(sort_order), -1) + 1 AS o FROM Sheets WHERE file_id = @f`, { f: db_1.T.uuid(fileId) }, tx);
        const id = await (0, union_1.createUnionSheet)(tx, fileId, body.name, Number(o?.o ?? 0), infos, u.id);
        await (0, audit_1.audit)({ userId: u.id, action: 'sheet_create', entityType: 'sheet', entityId: id, fileId, sheetId: id, newValue: { name: body.name, union: infos.map((i) => i.label) } }, req, tx);
        return id;
    });
    await (0, union_1.syncUnion)(sheetId);
    (0, http_1.ok)(res, { id: sheetId }, 201);
}));
/** Change the sources of a union sheet */
router.put('/sheets/:id/union', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, id, permissions_1.LV.manage, undefined, true);
    const cfg = (0, union_1.readUnionConfig)(sheet);
    if (!cfg)
        throw (0, http_1.forbidden)('ชีตนี้ไม่ใช่ชีตรวมข้อมูล');
    const body = (0, http_1.parse)(zod_1.z.object({ sources: sourcesSchema }), req.body);
    const infos = await (0, union_1.assertUnionSources)(req.user, body.sources, id);
    // the structure must also equal the union's own columns (copied from the original first source)
    await (0, db_1.q)(`UPDATE Sheets SET union_config = @c WHERE sheet_id = @id`, { c: db_1.T.text(JSON.stringify({ ...cfg, sources: infos.map((i) => ({ sheetId: i.sheetId })), lastSyncAt: null })), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'sheet_update', entityType: 'sheet', entityId: id, fileId: sheet.file_id, sheetId: id, newValue: { union: infos.map((i) => i.label) } }, req);
    (0, http_1.ok)(res, await (0, union_1.syncUnion)(id));
}));
router.post('/sheets/:id/union/sync', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, id, permissions_1.LV.read);
    (0, http_1.ok)(res, await (0, union_1.syncUnion)(id));
}));
exports.default = router;
//# sourceMappingURL=union.js.map