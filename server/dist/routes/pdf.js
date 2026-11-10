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
/** Anyone who can read the file can export with its layouts */
router.get('/files/:id/pdf-templates', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file, level } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.read);
    (0, http_1.ok)(res, { templates: (0, pdfTemplates_1.parseTemplates)(file.pdf_templates), canEdit: level >= permissions_1.LV.manage });
}));
/** Owner / managers / admin design the layouts */
router.put('/files/:id/pdf-templates', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
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
exports.default = router;
//# sourceMappingURL=pdf.js.map