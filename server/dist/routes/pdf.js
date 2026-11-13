"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const pdfTemplates_1 = require("../services/pdfTemplates");
const router = (0, express_1.Router)();
const MAX_BYTES = 3_000_000;
const templateSchema = zod_1.z.object({ id: zod_1.z.string().min(1).max(60), name: zod_1.z.string().trim().min(1).max(200) }).passthrough();
/**
 * A file with a master (Files.pdf_master_id) uses the layouts of that file: one edit there changes every file that follows it.
 * A layout with `followSheet` prints the sheet the user is looking at, so the same layout fits every daily sheet / month file.
 */
async function masterOf(file) {
    if (!file.pdf_master_id)
        return null;
    const m = await (0, permissions_1.getFileRow)(file.pdf_master_id);
    return m ?? null;
}
/** Anyone who can read the file can export with its layouts */
router.get('/files/:id/pdf-templates', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file, level } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.read);
    const m = await masterOf(file);
    if (m) {
        (0, http_1.ok)(res, { templates: (0, pdfTemplates_1.parseTemplates)(m.pdf_templates), canEdit: false, master: { id: m.file_id, name: m.file_name } });
        return;
    }
    (0, http_1.ok)(res, { templates: (0, pdfTemplates_1.parseTemplates)(file.pdf_templates), canEdit: level >= permissions_1.LV.manage, master: null });
}));
/** Owner / managers / admin design the layouts */
router.put('/files/:id/pdf-templates', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    const m = await masterOf(file);
    if (m)
        throw (0, http_1.badRequest)(`ไฟล์นี้ใช้รูปแบบ PDF กลางจากไฟล์ "${m.file_name}" — ให้แก้ที่ไฟล์นั้น หรือเลิกใช้รูปแบบกลางก่อน`);
    const body = (0, http_1.parse)(zod_1.z.object({ templates: zod_1.z.array(templateSchema).max(30) }), req.body);
    const json = JSON.stringify(body.templates);
    if (json.length > MAX_BYTES)
        throw (0, http_1.badRequest)('รูปแบบ PDF มีขนาดใหญ่เกินไป');
    await (0, db_1.q)(`UPDATE Files SET pdf_templates = @t, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { t: db_1.T.text(json), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'pdf_template_save', entityType: 'file', entityId: id, fileId: id, newValue: { templates: body.templates.map((t) => t.name), name: file.file_name } }, req);
    (0, http_1.ok)(res, { saved: true });
}));
/** Copy the layouts of another file into this one (sheets are matched by name) */
router.post('/files/:id/pdf-templates/copy-from', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ sourceFileId: http_1.zId, templateIds: zod_1.z.array(zod_1.z.string()).max(30).optional() }), req.body);
    const { file: src } = await (0, permissions_1.requireFile)(req.user, body.sourceFileId, permissions_1.LV.read);
    let tpls = (0, pdfTemplates_1.parseTemplates)(src.pdf_templates);
    if (body.templateIds?.length)
        tpls = tpls.filter((t) => body.templateIds.includes(t.id));
    if (!tpls.length)
        throw (0, http_1.badRequest)('ไฟล์ต้นทางยังไม่มีรูปแบบ PDF');
    const copied = (0, pdfTemplates_1.remapTemplates)(tpls, await (0, pdfTemplates_1.sheetsOfFile)(src.file_id), await (0, pdfTemplates_1.sheetsOfFile)(id));
    const merged = [...(0, pdfTemplates_1.parseTemplates)(file.pdf_templates), ...copied.map((t) => ({ ...t, name: `${t.name} (คัดลอกจาก ${src.file_name})`.slice(0, 200) }))].slice(0, 30);
    await (0, db_1.q)(`UPDATE Files SET pdf_templates = @t, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { t: db_1.T.text(JSON.stringify(merged)), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'pdf_template_save', entityType: 'file', entityId: id, fileId: id, newValue: { copiedFrom: src.file_name, count: copied.length } }, req);
    (0, http_1.ok)(res, { templates: merged });
}));
/** Follow (or stop following) the layouts of another file. Stopping keeps a copy of the master's layouts in this file. */
router.post('/files/:id/pdf-templates/master', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ masterFileId: http_1.zId.nullable() }), req.body);
    if (body.masterFileId === null) {
        const m = await masterOf(file);
        await (0, db_1.q)(`UPDATE Files SET pdf_master_id = NULL, pdf_templates = @t, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { t: db_1.T.text(m ? JSON.stringify((0, pdfTemplates_1.parseTemplates)(m.pdf_templates)) : file.pdf_templates), id: db_1.T.uuid(id) });
    }
    else {
        if (body.masterFileId.toLowerCase() === id.toLowerCase())
            throw (0, http_1.badRequest)('เลือกไฟล์ตัวเองเป็นรูปแบบกลางไม่ได้');
        const { file: m } = await (0, permissions_1.requireFile)(req.user, body.masterFileId, permissions_1.LV.read);
        if (m.pdf_master_id)
            throw (0, http_1.badRequest)('ไฟล์ที่เลือกใช้รูปแบบกลางของไฟล์อื่นอยู่ — เลือกไฟล์ต้นทางจริงแทน');
        await (0, db_1.q)(`UPDATE Files SET pdf_master_id = @m, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { m: db_1.T.uuid(body.masterFileId), id: db_1.T.uuid(id) });
    }
    await (0, audit_1.audit)({ userId: req.user.id, action: 'pdf_template_master', entityType: 'file', entityId: id, fileId: id, newValue: { masterFileId: body.masterFileId, name: file.file_name } }, req);
    (0, http_1.ok)(res, { saved: true });
}));
/** Make every file in a folder (and its sub-folders) follow the layouts of one master file */
router.post('/folders/:id/pdf-master', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { ctx } = await (0, permissions_1.requireFolder)(req.user, id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ masterFileId: http_1.zId }), req.body);
    const { file: m } = await (0, permissions_1.requireFile)(req.user, body.masterFileId, permissions_1.LV.read);
    if (m.pdf_master_id)
        throw (0, http_1.badRequest)('ไฟล์ต้นทางใช้รูปแบบกลางของไฟล์อื่นอยู่ — เลือกไฟล์ต้นทางจริงแทน');
    const folders = [];
    const stack = [id];
    while (stack.length) {
        const cur = stack.pop();
        folders.push(cur);
        stack.push(...(ctx.index.children.get(cur) ?? []));
    }
    let changed = 0;
    for (let i = 0; i < folders.length; i += 100) {
        const part = folders.slice(i, i + 100);
        const ph = part.map((_f, k) => `@f${k}`).join(',');
        const params = { m: db_1.T.uuid(body.masterFileId) };
        part.forEach((f, k) => { params[`f${k}`] = db_1.T.uuid(f); });
        const r = await (0, db_1.q)(`UPDATE Files SET pdf_master_id = @m, updated_at = SYSUTCDATETIME() OUTPUT inserted.file_id WHERE is_deleted = 0 AND file_id <> @m AND folder_id IN (${ph})`, params);
        changed += Array.isArray(r) ? r.length : 0;
    }
    await (0, audit_1.audit)({ userId: req.user.id, action: 'pdf_template_master', entityType: 'folder', entityId: id, newValue: { masterFileId: body.masterFileId, files: changed } }, req);
    (0, http_1.ok)(res, { files: changed });
}));
exports.default = router;
//# sourceMappingURL=pdf.js.map