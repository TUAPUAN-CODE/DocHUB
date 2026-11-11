"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.copySheet = copySheet;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const permissions_1 = require("../shared/permissions");
const schemas_1 = require("../shared/schemas");
const structure_1 = require("../services/structure");
const pdfTemplates_1 = require("../services/pdfTemplates");
const hooks_1 = require("../services/hooks");
const sheetSettings_1 = require("../services/sheetSettings");
const folders_1 = require("./folders");
const docTypes_1 = require("../modules/revisions/docTypes");
const router = (0, express_1.Router)();
const permEnum = zod_1.z.enum(['read', 'write', 'manage']);
const fileMeta = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'กรุณาตั้งชื่อไฟล์').max(300),
    description: zod_1.z.string().max(2000).nullish(),
    color: http_1.zColor.nullish(),
    icon: zod_1.z.string().max(100).nullish(),
});
router.get('/files/accessible', (0, http_1.ah)(async (req, res) => {
    const s = String(req.query.q ?? '').trim();
    const ctx = await permissions_1.PermCtx.load(req.user);
    const rows = await (0, db_1.q)(`SELECT TOP 500 f.file_id, f.file_name, f.folder_id, f.created_by, f.color, f.updated_at FROM Files f
       WHERE f.is_deleted = 0 ${s ? 'AND f.file_name LIKE @s' : ''} ORDER BY f.updated_at DESC`, { s: `%${(0, http_1.likeEscape)(s)}%` });
    (0, http_1.ok)(res, rows
        .filter((f) => ctx.fileLevel(f) >= permissions_1.LV.read)
        .slice(0, 100)
        .map((f) => ({ id: f.file_id, name: f.file_name, color: f.color, folderId: f.folder_id, path: ctx.pathText(f.folder_id) })));
}));
router.get('/files/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const u = req.user;
    let level;
    let ctx;
    try {
        ({ level, ctx } = await (0, permissions_1.requireFile)(u, id, permissions_1.LV.read));
    }
    catch (e) {
        if (e instanceof http_1.AppError && e.code === 'NO_ACCESS') {
            const pending = await (0, db_1.q1)(`SELECT TOP 1 request_id, permission, created_at FROM AccessRequests
           WHERE file_id = @f AND requester_id = @u AND status = 'pending' ORDER BY created_at DESC`, { f: db_1.T.uuid(id), u: db_1.T.uuid(u.id) });
            e.details = { ...e.details, pending: pending ? { id: pending.request_id, permission: pending.permission, createdAt: pending.created_at } : null };
        }
        throw e;
    }
    const [file] = await (0, db_1.q)(`${folders_1.FILES_SQL} WHERE f.file_id = @id`, { id: db_1.T.uuid(id) });
    const sheets = await (0, db_1.q)(`SELECT * FROM Sheets WHERE file_id = @id AND is_deleted = 0 ORDER BY sort_order, created_at`, { id: db_1.T.uuid(id) });
    const dashboards = await (0, db_1.q)(`SELECT dashboard_id, dashboard_name, updated_at FROM Dashboards WHERE file_id = @id ORDER BY sort_order, created_at`, { id: db_1.T.uuid(id) });
    await (0, db_1.q)(`MERGE RecentFiles AS t USING (SELECT @u AS user_id, @f AS file_id) AS s
       ON t.user_id = s.user_id AND t.file_id = s.file_id
       WHEN MATCHED THEN UPDATE SET viewed_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (user_id, file_id) VALUES (s.user_id, s.file_id);`, { u: db_1.T.uuid(u.id), f: db_1.T.uuid(id) });
    const favs = await (0, folders_1.favoriteSet)(u.id, 'file');
    (0, http_1.ok)(res, {
        file: (0, mappers_1.mapFile)(file, level, favs.has(id)),
        breadcrumb: ctx.path(file.folder_id).map((n) => ({ id: n.id, name: n.name })),
        sheets: sheets.map(mappers_1.mapSheet),
        dashboards: dashboards.map((d) => ({ id: d.dashboard_id, name: d.dashboard_name, updatedAt: d.updated_at })),
        level,
    });
}));
const createSchema = fileMeta.extend({
    folderId: http_1.zId,
    sheets: zod_1.z.array(schemas_1.sheetInput).min(1, 'ต้องมีอย่างน้อย 1 ชีต').max(50),
    /** ประเภทเอกสาร (the web app asks for it; null = ทั่วไป) */
    docType: zod_1.z.enum(['master_data', 'record']).nullish(),
    access: zod_1.z
        .array(zod_1.z.object({ userId: http_1.zId, permission: permEnum, expiresAt: zod_1.z.string().datetime().nullish() }))
        .max(500)
        .default([]),
});
router.post('/files', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    if ((0, auth_1.isBasicRole)(u.role))
        throw (0, http_1.forbidden)('เฉพาะ Master หรือ Admin เท่านั้นที่สร้างไฟล์ได้');
    const body = (0, http_1.parse)(createSchema, req.body);
    await (0, permissions_1.requireFolder)(u, body.folderId, permissions_1.LV.write);
    (0, structure_1.assertUniqueNames)(body.sheets.map((s) => s.name), 'ชีต');
    body.sheets.forEach((s) => (0, structure_1.assertUniqueNames)(s.columns.map((c) => c.name)));
    if (body.sheets.some((s) => !s.columns.length))
        throw (0, http_1.badRequest)('ทุกชีตต้องมีคอลัมน์อย่างน้อย 1 คอลัมน์');
    const fileId = await (0, db_1.withTx)(async (tx) => {
        const f = await (0, db_1.q1)(`INSERT INTO Files (file_name, folder_id, description, color, icon, created_by, doc_type) OUTPUT inserted.file_id
         VALUES (@n, @fo, @d, COALESCE(@c, N'#16A34A'), COALESCE(@i, N'sheet'), @u, @dt)`, { n: body.name, fo: db_1.T.uuid(body.folderId), d: db_1.T.text(body.description ?? null), c: db_1.T.text(body.color ?? null), i: db_1.T.text(body.icon ?? null), u: db_1.T.uuid(u.id), dt: db_1.T.text(body.docType ?? null) }, tx);
        const fid = f.file_id;
        for (const [si, s] of body.sheets.entries()) {
            const sh = await (0, db_1.q1)(`INSERT INTO Sheets (file_id, sheet_name, sort_order, tab_color, created_by) OUTPUT inserted.sheet_id VALUES (@f, @n, @o, @c, @u)`, { f: db_1.T.uuid(fid), n: s.name, o: db_1.T.int(si), c: db_1.T.text(s.tabColor ?? null), u: db_1.T.uuid(u.id) }, tx);
            for (const [ci, c] of s.columns.entries())
                await (0, structure_1.insertColumn)(tx, sh.sheet_id, c, ci, u.id);
        }
        for (const a of body.access) {
            if (a.userId === u.id)
                continue;
            await (0, db_1.q)(`INSERT INTO FileAccess (file_id, user_id, permission, granted_by, expires_at) VALUES (@f, @u, @p, @by, @e)`, { f: db_1.T.uuid(fid), u: db_1.T.uuid(a.userId), p: a.permission, by: db_1.T.uuid(u.id), e: db_1.T.dt(a.expiresAt ?? null) }, tx);
        }
        await (0, audit_1.audit)({ userId: u.id, action: 'file_create', entityType: 'file', entityId: fid, fileId: fid,
            newValue: { name: body.name, sheets: body.sheets.map((s) => ({ name: s.name, columns: s.columns.length })) } }, req, tx);
        return fid;
    });
    if (body.docType)
        await (0, docTypes_1.ensureBaseline)(fileId, u.id); // a typed file starts at Rev.1
    (0, http_1.ok)(res, { id: fileId }, 201);
}));
router.put('/files/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(fileMeta.partial().extend({ status: zod_1.z.enum(['active', 'archived']).optional() }), req.body);
    await (0, db_1.q)(`UPDATE Files SET file_name = COALESCE(@n, file_name), description = CASE WHEN @hasD = 1 THEN @d ELSE description END,
         color = COALESCE(@c, color), icon = COALESCE(@i, icon), status = COALESCE(@st, status), updated_at = SYSUTCDATETIME()
       WHERE file_id = @id`, { n: db_1.T.text(body.name ?? null), hasD: body.description !== undefined, d: db_1.T.text(body.description ?? null), c: db_1.T.text(body.color ?? null),
        i: db_1.T.text(body.icon ?? null), st: db_1.T.text(body.status ?? null), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'file_update', entityType: 'file', entityId: id, fileId: id,
        oldValue: { name: file.file_name, status: file.status }, newValue: body }, req);
    (0, http_1.ok)(res, { updated: true });
}));
router.post('/files/:id/move', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const u = req.user;
    const { file } = await (0, permissions_1.requireFile)(u, id, permissions_1.LV.manage);
    const { folderId } = (0, http_1.parse)(zod_1.z.object({ folderId: http_1.zId }), req.body);
    await (0, permissions_1.requireFolder)(u, folderId, permissions_1.LV.write);
    await (0, db_1.q)(`UPDATE Files SET folder_id = @fo, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { fo: db_1.T.uuid(folderId), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: u.id, action: 'file_move', entityType: 'file', entityId: id, fileId: id,
        oldValue: { folderId: file.folder_id }, newValue: { folderId } }, req);
    (0, http_1.ok)(res, { moved: true });
}));
async function copySheet(tx, oldSheetId, newFileId, order, userId, includeData, name) {
    return (await copySheetFull(tx, oldSheetId, newFileId, order, userId, includeData, name)).newSheetId;
}
/** a sheet into another (or the same) file: structure, and with includeData the rows; returns the old → new ids of columns and rows */
async function copySheetFull(tx, oldSheetId, newFileId, order, userId, includeData, name) {
    const s = await (0, db_1.q1)(`SELECT * FROM Sheets WHERE sheet_id = @s`, { s: db_1.T.uuid(oldSheetId) }, tx);
    const ns = await (0, db_1.q1)(`INSERT INTO Sheets (file_id, sheet_name, sort_order, tab_color, created_by) OUTPUT inserted.sheet_id VALUES (@f, @n, @o, @c, @u)`, { f: db_1.T.uuid(newFileId), n: name ?? s.sheet_name, o: db_1.T.int(order), c: db_1.T.text(s.tab_color), u: db_1.T.uuid(userId) }, tx);
    const newSheetId = ns.sheet_id;
    const colMap = await (0, db_1.q)(`MERGE INTO Columns AS t
     USING (SELECT * FROM Columns WHERE sheet_id = @old AND is_deleted = 0) AS src ON 1 = 0
     WHEN NOT MATCHED THEN INSERT (sheet_id, column_name, data_type, display_order, width, is_required, default_value, placeholder,
       validation_rule, select_options, description, created_by)
     VALUES (@new, src.column_name, src.data_type, src.display_order, src.width, src.is_required, src.default_value, src.placeholder,
       src.validation_rule, src.select_options, src.description, @u)
     OUTPUT src.column_id AS old_id, inserted.column_id AS new_id;`, { old: db_1.T.uuid(oldSheetId), new: db_1.T.uuid(newSheetId), u: db_1.T.uuid(userId) }, tx);
    await (0, hooks_1.runAfterSheetCopied)({ tx, oldSheetId, newSheetId, columnMap: colMap });
    let rowMap = [];
    if (includeData) {
        rowMap = await (0, db_1.q)(`DECLARE @rm TABLE (old_id UNIQUEIDENTIFIER, new_id UNIQUEIDENTIFIER);
       MERGE INTO Rows AS t
       USING (SELECT row_id, row_order FROM Rows WHERE sheet_id = @old AND is_deleted = 0) AS src ON 1 = 0
       WHEN NOT MATCHED THEN INSERT (sheet_id, row_order, created_by, updated_by) VALUES (@new, src.row_order, @u, @u)
       OUTPUT src.row_id, inserted.row_id INTO @rm;
       INSERT INTO Cells (row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, updated_by)
       SELECT rm.new_id, cm.new_id, c.value_text, c.value_int, c.value_float, c.value_date, c.value_bool, c.value_json, @u
       FROM Cells c JOIN @rm rm ON rm.old_id = c.row_id
       JOIN OPENJSON(@cm) WITH (old_id UNIQUEIDENTIFIER, new_id UNIQUEIDENTIFIER) cm ON cm.old_id = c.column_id;
       SELECT old_id, new_id FROM @rm;`, { old: db_1.T.uuid(oldSheetId), new: db_1.T.uuid(newSheetId), u: db_1.T.uuid(userId), cm: db_1.T.text(JSON.stringify(colMap)) }, tx);
    }
    return { newSheetId, colMap: colMap, rowMap };
}
/**
 * After a whole file is copied: a header sheet's lines (settings.lines) point to the COPY's line sheet (they used to keep pointing to
 * the source file's sheet, or were lost), its columns re-mapped; with the data, the links header row → line rows are copied too.
 */
async function relinkCopiedLines(tx, copies, userId) {
    const lower = (x) => String(x).toLowerCase();
    const sheetMap = new Map([...copies].map(([o, c]) => [lower(o), c.newSheetId]));
    for (const [oldId, c] of copies) {
        const src = await (0, sheetSettings_1.readSettings)(oldId, tx);
        const lines = src.lines;
        if (!lines?.lineSheetId)
            continue;
        const lineOld = lower(lines.lineSheetId);
        const lineCopy = [...copies].find(([o]) => lower(o) === lineOld)?.[1];
        const colMap = new Map((lineCopy?.colMap ?? []).map((m) => [lower(m.old_id), lower(m.new_id)]));
        const next = {
            ...lines,
            lineSheetId: sheetMap.get(lineOld) ?? lines.lineSheetId,
            displayColumnIds: lines.displayColumnIds?.map((id) => colMap.get(lower(id)) ?? id) ?? lines.displayColumnIds,
            actions: lines.actions?.map((a) => ({ ...a, columnId: colMap.get(lower(a.columnId)) ?? a.columnId })) ?? lines.actions,
        };
        await (0, sheetSettings_1.writeSettingsKey)(c.newSheetId, 'lines', next, tx);
        if (lineCopy && c.rowMap.length && lineCopy.rowMap.length) {
            await (0, db_1.q)(`INSERT INTO RowLinks (sheet_id, parent_row_id, child_row_id, qty, role, created_by)
         SELECT @ls, p.new_id, ch.new_id, l.qty, l.role, @u
         FROM RowLinks l
         JOIN OPENJSON(@pm) WITH (old_id UNIQUEIDENTIFIER, new_id UNIQUEIDENTIFIER) p ON p.old_id = l.parent_row_id
         JOIN OPENJSON(@cm) WITH (old_id UNIQUEIDENTIFIER, new_id UNIQUEIDENTIFIER) ch ON ch.old_id = l.child_row_id
         WHERE l.role = N'contains'`, { ls: db_1.T.uuid(lineCopy.newSheetId), u: db_1.T.uuid(userId), pm: db_1.T.text(JSON.stringify(c.rowMap)), cm: db_1.T.text(JSON.stringify(lineCopy.rowMap)) }, tx);
        }
    }
}
router.post('/files/:id/duplicate', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const u = req.user;
    if ((0, auth_1.isBasicRole)(u.role))
        throw (0, http_1.forbidden)('เฉพาะ Master หรือ Admin เท่านั้นที่ทำสำเนาไฟล์ได้');
    const { file } = await (0, permissions_1.requireFile)(u, id, permissions_1.LV.read);
    const body = (0, http_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(300).optional(), folderId: http_1.zId.optional(), includeData: zod_1.z.boolean().default(false) }), req.body);
    const folderId = body.folderId ?? file.folder_id;
    await (0, permissions_1.requireFolder)(u, folderId, permissions_1.LV.write);
    const newId = await (0, db_1.withTx)(async (tx) => {
        const f = await (0, db_1.q1)(`INSERT INTO Files (file_name, folder_id, description, color, icon, created_by, doc_type) OUTPUT inserted.file_id
         VALUES (@n, @fo, @d, @c, @i, @u, @dt)`, { n: body.name ?? `${file.file_name} (สำเนา)`, fo: db_1.T.uuid(folderId), d: db_1.T.text(file.description), c: file.color, i: file.icon, u: db_1.T.uuid(u.id), dt: db_1.T.text(file.doc_type ?? null) }, tx);
        const sheets = await (0, db_1.q)(`SELECT sheet_id FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: db_1.T.uuid(id) }, tx);
        const copies = new Map();
        for (const [i, s] of sheets.entries())
            copies.set(s.sheet_id, await copySheetFull(tx, s.sheet_id, f.file_id, i, u.id, body.includeData));
        await relinkCopiedLines(tx, copies, u.id);
        // PDF layouts travel with the file
        const tpls = (0, pdfTemplates_1.parseTemplates)(file.pdf_templates);
        if (tpls.length) {
            const mapped = (0, pdfTemplates_1.remapTemplates)(tpls, await (0, pdfTemplates_1.sheetsOfFile)(id, tx), await (0, pdfTemplates_1.sheetsOfFile)(f.file_id, tx), false);
            await (0, db_1.q)(`UPDATE Files SET pdf_templates = @t WHERE file_id = @f`, { t: db_1.T.text(JSON.stringify(mapped)), f: db_1.T.uuid(f.file_id) }, tx);
        }
        await (0, audit_1.audit)({ userId: u.id, action: 'file_duplicate', entityType: 'file', entityId: f.file_id, fileId: f.file_id,
            newValue: { sourceFileId: id, includeData: body.includeData } }, req, tx);
        return f.file_id;
    });
    (0, http_1.ok)(res, { id: newId }, 201);
}));
router.delete('/files/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    await (0, db_1.q)(`UPDATE Files SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @u, delete_batch = @b WHERE file_id = @id`, { u: db_1.T.uuid(req.user.id), b: db_1.T.uuid(crypto_1.default.randomUUID()), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'file_delete', entityType: 'file', entityId: id, fileId: id, oldValue: { name: file.file_name } }, req);
    (0, http_1.ok)(res, { deleted: true });
}));
exports.default = router;
//# sourceMappingURL=files.js.map