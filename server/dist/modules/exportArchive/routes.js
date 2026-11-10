"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const config_1 = require("./config");
const router = (0, express_1.Router)();
fs_1.default.mkdirSync(config_1.archiveConfig.dir, { recursive: true });
const metaSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(300),
    sheetId: http_1.zId.nullish(),
    templateId: zod_1.z.string().max(60).nullish(),
    templateName: zod_1.z.string().max(200).nullish(),
    pageCount: zod_1.z.number().int().min(0).max(100000).nullish(),
    rowCount: zod_1.z.number().int().min(0).max(10_000_000).nullish(),
    filters: zod_1.z.any().optional(),
    /** values typed into the export dialog (Date, Shift, Line, Plant …) */
    prompts: zod_1.z.record(zod_1.z.string().max(1000)).optional(),
    /** who signed: label of the signature slot + the name */
    signers: zod_1.z.array(zod_1.z.object({ label: zod_1.z.string().max(200), name: zod_1.z.string().max(200) })).max(20).optional(),
    note: zod_1.z.string().max(1000).nullish(),
});
const map = (r) => ({
    id: r.archive_id,
    fileId: r.file_id,
    sheetId: r.sheet_id,
    title: r.title,
    templateName: r.template_name,
    originalName: r.original_name,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256,
    pageCount: r.page_count,
    rowCount: r.row_count,
    meta: (0, http_1.safeJson)(r.meta_json, {}) ?? {},
    createdBy: r.created_by,
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
});
const hashFile = (file) => new Promise((resolve, reject) => {
    const h = crypto_1.default.createHash('sha256');
    fs_1.default.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({ destination: config_1.archiveConfig.dir, filename: (_req, _f, cb) => cb(null, `${crypto_1.default.randomUUID()}.pdf`) }),
    limits: { fileSize: config_1.archiveConfig.maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, f, cb) => cb(null, f.mimetype === 'application/pdf'),
});
/** The permission check runs BEFORE anything is written to disk */
const mayArchive = (req, _res, next) => {
    (0, permissions_1.requireFile)(req.user, (0, http_1.pid)(req), permissions_1.LV.write).then(() => next(), next);
};
const safeName = (s) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 150) || 'document';
/** Save an exported PDF (e.g. after the signature slots were filled) */
router.post('/files/:id/exports', mayArchive, upload.single('pdf'), (0, http_1.ah)(async (req, res) => {
    const fileId = (0, http_1.pid)(req);
    const stored = req.file;
    if (!stored)
        throw (0, http_1.badRequest)('ไม่พบไฟล์ PDF ที่จะบันทึก');
    try {
        const head = Buffer.alloc(5);
        const fd = fs_1.default.openSync(stored.path, 'r');
        fs_1.default.readSync(fd, head, 0, 5, 0);
        fs_1.default.closeSync(fd);
        if (head.toString('latin1') !== '%PDF-')
            throw (0, http_1.badRequest)('ไฟล์ที่ส่งมาไม่ใช่ PDF');
        let raw;
        try {
            raw = JSON.parse(String(req.body?.meta ?? '{}'));
        }
        catch {
            throw (0, http_1.badRequest)('ข้อมูลประกอบ (meta) ไม่ถูกต้อง');
        }
        const meta = (0, http_1.parse)(metaSchema, raw);
        const { sheetId, title, templateName, pageCount, rowCount, ...rest } = meta;
        const sha = await hashFile(stored.path);
        const row = await (0, db_1.q1)(`INSERT INTO ExportArchive (file_id, sheet_id, title, template_name, stored_name, original_name, size_bytes, sha256, page_count, row_count, meta_json, created_by)
         OUTPUT inserted.archive_id
         VALUES (@f, @s, @t, @tn, @sn, @on, @sz, @sha, @pc, @rc, @mj, @u)`, {
            f: db_1.T.uuid(fileId), s: db_1.T.uuid(sheetId ?? null), t: title, tn: db_1.T.text(templateName ?? null), sn: path_1.default.basename(stored.path),
            on: `${safeName(title)}.pdf`, sz: db_1.T.bigint(stored.size), sha, pc: db_1.T.int(pageCount ?? null), rc: db_1.T.int(rowCount ?? null),
            mj: db_1.T.text(JSON.stringify(rest)), u: db_1.T.uuid(req.user.id),
        });
        await (0, audit_1.audit)({ userId: req.user.id, action: 'export_archive', entityType: 'file', entityId: row.archive_id, fileId, sheetId: sheetId ?? null,
            newValue: { title, template: templateName ?? null, sha256: sha, size: stored.size, signers: rest.signers ?? [] } }, req);
        const full = await (0, db_1.q1)(`SELECT a.*, u.display_name AS created_by_name FROM ExportArchive a JOIN Users u ON u.user_id = a.created_by WHERE a.archive_id = @id`, { id: db_1.T.uuid(row.archive_id) });
        (0, http_1.ok)(res, map(full), 201);
    }
    catch (e) {
        fs_1.default.promises.unlink(stored.path).catch(() => undefined);
        throw e;
    }
}));
/** Archived documents of a file (newest first) */
router.get('/files/:id/exports', (0, http_1.ah)(async (req, res) => {
    const fileId = (0, http_1.pid)(req);
    const { level } = await (0, permissions_1.requireFile)(req.user, fileId, permissions_1.LV.read);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const search = String(req.query.search ?? '').trim();
    const like = search ? `%${search.replace(/[[\]%_]/g, (m) => `[${m}]`)}%` : null;
    const where = `a.file_id = @f AND a.is_deleted = 0 ${like ? 'AND (a.title LIKE @l OR a.template_name LIKE @l OR u.display_name LIKE @l)' : ''}`;
    const params = { f: db_1.T.uuid(fileId), l: db_1.T.text(like), o: db_1.T.int(offset), n: db_1.T.int(limit) };
    const rows = await (0, db_1.q)(`SELECT a.*, u.display_name AS created_by_name FROM ExportArchive a JOIN Users u ON u.user_id = a.created_by
       WHERE ${where} ORDER BY a.created_at DESC OFFSET @o ROWS FETCH NEXT @n ROWS ONLY`, params);
    const total = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM ExportArchive a JOIN Users u ON u.user_id = a.created_by WHERE ${where}`, params);
    (0, http_1.ok)(res, { items: rows.map(map), total: Number(total?.n ?? 0), canDelete: level >= permissions_1.LV.manage });
}));
async function loadArchive(id) {
    const row = await (0, db_1.q1)(`SELECT a.*, u.display_name AS created_by_name FROM ExportArchive a JOIN Users u ON u.user_id = a.created_by WHERE a.archive_id = @id AND a.is_deleted = 0`, { id: db_1.T.uuid(id) });
    if (!row)
        throw (0, http_1.notFound)('ไม่พบเอกสารที่บันทึกไว้');
    return row;
}
const diskPath = (stored) => path_1.default.join(config_1.archiveConfig.dir, path_1.default.basename(stored));
router.get('/exports/:id/download', (0, http_1.ah)(async (req, res) => {
    const row = await loadArchive((0, http_1.pid)(req));
    await (0, permissions_1.requireFile)(req.user, row.file_id, permissions_1.LV.read);
    const file = diskPath(row.stored_name);
    if (!fs_1.default.existsSync(file))
        throw (0, http_1.notFound)('ไฟล์เอกสารหายจากที่เก็บ กรุณาแจ้งผู้ดูแลระบบ');
    await (0, audit_1.audit)({ userId: req.user.id, action: 'export_archive_download', entityType: 'file', entityId: row.archive_id, fileId: row.file_id, newValue: { title: row.title } }, req);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.attachment(row.original_name);
    fs_1.default.createReadStream(file).pipe(res);
}));
/** Re-computes the SHA-256 and compares it with the value stored when the document was archived */
router.get('/exports/:id/verify', (0, http_1.ah)(async (req, res) => {
    const row = await loadArchive((0, http_1.pid)(req));
    await (0, permissions_1.requireFile)(req.user, row.file_id, permissions_1.LV.read);
    const file = diskPath(row.stored_name);
    if (!fs_1.default.existsSync(file))
        return (0, http_1.ok)(res, { intact: false, reason: 'missing' });
    const sha = await hashFile(file);
    (0, http_1.ok)(res, { intact: sha === row.sha256, sha256: row.sha256 });
}));
router.delete('/exports/:id', (0, http_1.ah)(async (req, res) => {
    const row = await loadArchive((0, http_1.pid)(req));
    await (0, permissions_1.requireFile)(req.user, row.file_id, permissions_1.LV.manage);
    await (0, db_1.q)(`UPDATE ExportArchive SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @u WHERE archive_id = @id`, { id: db_1.T.uuid(row.archive_id), u: db_1.T.uuid(req.user.id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'export_archive_delete', entityType: 'file', entityId: row.archive_id, fileId: row.file_id, oldValue: { title: row.title } }, req);
    (0, http_1.ok)(res, { deleted: true });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map