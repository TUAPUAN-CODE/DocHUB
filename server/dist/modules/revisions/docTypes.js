"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = exports.DOC_TYPE_TH = exports.DOC_TYPES = void 0;
exports.ensureBaseline = ensureBaseline;
exports.ensureTypedBaselines = ensureTypedBaselines;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const logger_1 = require("../../shared/logger");
const permissions_1 = require("../../shared/permissions");
const pdfTemplates_1 = require("../../services/pdfTemplates");
const service_1 = require("./service");
/**
 * Document types (docs/NEWS_TAGS_ROOT.md → ประเภทเอกสาร): master_data · record · null (ทั่วไป).
 * Giving a file a type starts its revisions: every sheet without one gets a first Rev ("Rev เริ่มต้น").
 */
exports.DOC_TYPES = ['master_data', 'record'];
const zType = zod_1.z.enum(exports.DOC_TYPES).nullable();
exports.DOC_TYPE_TH = { master_data: 'Master Data (ข้อมูลหลัก)', record: 'แบบฟอร์มบันทึก', general: 'ทั่วไป' };
/** a first revision for every (non-union) sheet of the file that has none */
async function ensureBaseline(fileId, userId) {
    const sheets = await (0, db_1.q)(`SELECT s.sheet_id FROM Sheets s WHERE s.file_id = @f AND s.is_deleted = 0 AND s.union_config IS NULL
       AND NOT EXISTS (SELECT 1 FROM SheetRevisions r WHERE r.sheet_id = s.sheet_id)`, { f: db_1.T.uuid(fileId) });
    let made = 0;
    for (const s of sheets) {
        const r = await (0, db_1.withTx)((tx) => (0, service_1.createRevision)(tx, s.sheet_id, userId, 'Rev เริ่มต้น (ตั้งประเภทเอกสาร)', 1));
        if (!('error' in r))
            made++;
    }
    return made;
}
/** start-up: typed files (e.g. from a seed) whose sheets have no revision yet */
async function ensureTypedBaselines() {
    const files = await (0, db_1.q)(`SELECT f.file_id, f.created_by FROM Files f WHERE f.is_deleted = 0 AND f.doc_type IS NOT NULL
       AND EXISTS (SELECT 1 FROM Sheets s WHERE s.file_id = f.file_id AND s.is_deleted = 0 AND s.union_config IS NULL AND NOT EXISTS (SELECT 1 FROM SheetRevisions r WHERE r.sheet_id = s.sheet_id))`);
    for (const f of files) {
        try {
            const n = await ensureBaseline(f.file_id, f.created_by);
            if (n)
                logger_1.logger.info(`Doc type: first Rev for ${n} sheet(s) of file ${f.file_id}`);
        }
        catch (e) {
            logger_1.logger.error(`Doc type: first Rev of ${f.file_id} failed: ${e?.message}`);
        }
    }
}
exports.router = (0, express_1.Router)();
/** one file (Master and up with "จัดการ" on the file) */
exports.router.put('/files/:id/doc-type', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const u = req.user;
    if ((0, auth_1.isBasicRole)(u.role))
        throw (0, http_1.forbidden)('ตั้งประเภทเอกสารได้ตั้งแต่ Master ขึ้นไป');
    const { file } = await (0, permissions_1.requireFile)(u, id, permissions_1.LV.manage);
    const { docType } = (0, http_1.parse)(zod_1.z.object({ docType: zType }), req.body);
    await (0, db_1.q)(`UPDATE Files SET doc_type = @t, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { t: db_1.T.text(docType), id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: u.id, action: 'file_doc_type', entityType: 'file', entityId: id, fileId: id, oldValue: { docType: file.doc_type ?? null }, newValue: { docType } }, req);
    const revs = docType ? await ensureBaseline(id, u.id) : 0;
    (0, http_1.ok)(res, { docType, firstRevs: revs });
}));
/** every file of a folder (and its sub-folders) — admin */
exports.router.put('/folders/:id/doc-type', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const u = req.user;
    if (!(0, auth_1.isAdminRole)(u.role))
        throw (0, http_1.forbidden)('ตั้งประเภทเอกสารทั้งโฟลเดอร์ได้เฉพาะ Admin');
    await (0, permissions_1.requireFolder)(u, id, permissions_1.LV.manage);
    const b = (0, http_1.parse)(zod_1.z.object({ docType: zType, includeSubfolders: zod_1.z.boolean().default(true), onlyUntyped: zod_1.z.boolean().default(false) }), req.body);
    const index = await (0, permissions_1.getFolderIndex)();
    const ids = [id.toLowerCase()];
    if (b.includeSubfolders)
        for (let i = 0; i < ids.length; i++)
            for (const c of index.children.get(ids[i]) ?? [])
                ids.push(c);
    const files = await (0, db_1.q)(`SELECT file_id FROM Files WHERE is_deleted = 0 AND folder_id IN ${(0, db_1.idList)('@ids')} ${b.onlyUntyped ? 'AND doc_type IS NULL' : ''}`, { ids: (0, db_1.jsonParam)(ids) });
    if (!files.length)
        throw (0, http_1.badRequest)('ไม่มีไฟล์ในโฟลเดอร์นี้');
    await (0, db_1.q)(`UPDATE Files SET doc_type = @t, updated_at = SYSUTCDATETIME() WHERE file_id IN ${(0, db_1.idList)('@f')}`, { t: db_1.T.text(b.docType), f: (0, db_1.jsonParam)(files.map((f) => f.file_id)) });
    await (0, audit_1.audit)({ userId: u.id, action: 'folder_doc_type', entityType: 'folder', entityId: id, newValue: { docType: b.docType, files: files.length, includeSubfolders: b.includeSubfolders } }, req);
    let revs = 0;
    if (b.docType)
        for (const f of files)
            revs += await ensureBaseline(f.file_id, u.id);
    (0, http_1.ok)(res, { files: files.length, firstRevs: revs });
}));
/** PDF layouts as they were at earlier format revisions (to print an old record the way it was) */
exports.router.get('/files/:id/pdf-revisions', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { file } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.read);
    const current = new Map((0, pdfTemplates_1.parseTemplates)(file.pdf_templates).map((t) => [t.id, JSON.stringify(t)]));
    const rows = await (0, db_1.q)(`SELECT r.rev_no, r.created_at, r.format_json, s.sheet_name FROM SheetRevisions r JOIN Sheets s ON s.sheet_id = r.sheet_id
     WHERE s.file_id = @f AND s.is_deleted = 0 AND r.format_json IS NOT NULL ORDER BY r.rev_no DESC`, { f: db_1.T.uuid(id) });
    const seen = new Set();
    const out = [];
    for (const r of rows) {
        for (const t of (0, http_1.safeJson)(r.format_json, {})?.pdf ?? []) {
            if (current.get(t.id) === t.json || seen.has(t.json))
                continue;
            seen.add(t.json);
            out.push({ revNo: r.rev_no, sheetName: r.sheet_name, createdAt: r.created_at, template: (0, http_1.safeJson)(t.json, null) });
        }
    }
    (0, http_1.ok)(res, out.slice(0, 30));
}));
//# sourceMappingURL=docTypes.js.map