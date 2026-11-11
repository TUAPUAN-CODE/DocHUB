"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const purge_1 = require("../services/purge");
const env_1 = require("../config/env");
const router = (0, express_1.Router)();
router.get('/trash', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const mine = (0, auth_1.isAdminRole)(u.role) ? '' : 'AND (x.deleted_by = @u OR x.created_by = @u)';
    const folders = await (0, db_1.q)(`SELECT x.folder_id, x.folder_name, x.color, x.deleted_at, x.created_by, d.display_name AS deleted_by_name,
         (SELECT COUNT(*) FROM Files fi WHERE fi.delete_batch = x.delete_batch) AS file_count
       FROM Folders x LEFT JOIN Users d ON d.user_id = x.deleted_by
       WHERE x.is_deleted = 1 ${mine}
         AND NOT EXISTS (SELECT 1 FROM Folders p WHERE p.folder_id = x.parent_id AND p.is_deleted = 1 AND p.delete_batch = x.delete_batch)
       ORDER BY x.deleted_at DESC`, { u: db_1.T.uuid(u.id) });
    const files = await (0, db_1.q)(`SELECT x.file_id, x.file_name, x.color, x.deleted_at, x.created_by, fo.folder_name, fo.is_deleted AS folder_deleted,
         d.display_name AS deleted_by_name
       FROM Files x JOIN Folders fo ON fo.folder_id = x.folder_id LEFT JOIN Users d ON d.user_id = x.deleted_by
       WHERE x.is_deleted = 1 ${mine}
         AND NOT (fo.is_deleted = 1 AND fo.delete_batch = x.delete_batch)
       ORDER BY x.deleted_at DESC`, { u: db_1.T.uuid(u.id) });
    const purgeAt = (d) => new Date(new Date(d).getTime() + env_1.env.trashRetentionDays * 86400_000);
    (0, http_1.ok)(res, {
        retentionDays: env_1.env.trashRetentionDays,
        items: [
            ...folders.map((f) => ({ type: 'folder', id: f.folder_id, name: f.folder_name, color: f.color, deletedAt: f.deleted_at,
                deletedByName: f.deleted_by_name, purgeAt: purgeAt(f.deleted_at), detail: `${Number(f.file_count)} ไฟล์ภายใน` })),
            ...files.map((f) => ({ type: 'file', id: f.file_id, name: f.file_name, color: f.color, deletedAt: f.deleted_at,
                deletedByName: f.deleted_by_name, purgeAt: purgeAt(f.deleted_at), detail: `จากโฟลเดอร์ ${f.folder_name}`, blocked: !!f.folder_deleted })),
        ].sort((a, b) => +new Date(b.deletedAt) - +new Date(a.deletedAt)),
    });
}));
router.post('/trash/restore', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const { type, id } = (0, http_1.parse)(zod_1.z.object({ type: zod_1.z.enum(['file', 'folder']), id: http_1.zId }), req.body);
    if (type === 'folder') {
        const f = await (0, db_1.q1)(`SELECT * FROM Folders WHERE folder_id = @id AND is_deleted = 1`, { id: db_1.T.uuid(id) });
        if (!f)
            throw (0, http_1.notFound)('ไม่พบรายการในถังขยะ');
        if (!(0, auth_1.isAdminRole)(u.role) && f.deleted_by !== u.id && f.created_by !== u.id)
            throw (0, http_1.forbidden)();
        await (0, db_1.withTx)(async (tx) => {
            const parent = f.parent_id ? await (0, db_1.q1)(`SELECT is_deleted FROM Folders WHERE folder_id = @p`, { p: db_1.T.uuid(f.parent_id) }, tx) : null;
            if (parent?.is_deleted)
                await (0, db_1.q)(`UPDATE Folders SET parent_id = NULL WHERE folder_id = @id`, { id: db_1.T.uuid(id) }, tx);
            await (0, db_1.q)(`UPDATE Folders SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, delete_batch = NULL WHERE delete_batch = @b`, { b: db_1.T.uuid(f.delete_batch) }, tx);
            await (0, db_1.q)(`UPDATE Files SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, delete_batch = NULL WHERE delete_batch = @b`, { b: db_1.T.uuid(f.delete_batch) }, tx);
            await (0, audit_1.audit)({ userId: u.id, action: 'folder_restore', entityType: 'folder', entityId: id, newValue: { name: f.folder_name, movedToRoot: !!parent?.is_deleted } }, req, tx);
        });
        (0, permissions_1.invalidateFolders)();
    }
    else {
        const f = await (0, db_1.q1)(`SELECT x.*, fo.is_deleted AS folder_deleted, fo.folder_name FROM Files x JOIN Folders fo ON fo.folder_id = x.folder_id
        WHERE x.file_id = @id AND x.is_deleted = 1`, { id: db_1.T.uuid(id) });
        if (!f)
            throw (0, http_1.notFound)('ไม่พบรายการในถังขยะ');
        if (!(0, auth_1.isAdminRole)(u.role) && f.deleted_by !== u.id && f.created_by !== u.id)
            throw (0, http_1.forbidden)();
        if (f.folder_deleted)
            throw (0, http_1.badRequest)(`โฟลเดอร์ "${f.folder_name}" ถูกลบอยู่ กรุณากู้คืนโฟลเดอร์ก่อน`);
        await (0, db_1.q)(`UPDATE Files SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, delete_batch = NULL WHERE file_id = @id`, { id: db_1.T.uuid(id) });
        await (0, audit_1.audit)({ userId: u.id, action: 'file_restore', entityType: 'file', entityId: id, fileId: id, newValue: { name: f.file_name } }, req);
    }
    (0, http_1.ok)(res, { restored: true });
}));
router.delete('/trash/:type/:id', (0, auth_1.requireRole)('admin'), (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const type = req.params.type;
    if (type !== 'file' && type !== 'folder')
        throw (0, http_1.badRequest)('ชนิดรายการไม่ถูกต้อง');
    const row = type === 'file'
        ? await (0, db_1.q1)(`SELECT file_name AS name FROM Files WHERE file_id = @id AND is_deleted = 1`, { id: db_1.T.uuid(id) })
        : await (0, db_1.q1)(`SELECT folder_name AS name FROM Folders WHERE folder_id = @id AND is_deleted = 1`, { id: db_1.T.uuid(id) });
    if (!row)
        throw (0, http_1.notFound)('ไม่พบรายการในถังขยะ');
    await (0, db_1.withTx)((tx) => (type === 'file' ? (0, purge_1.purgeFile)(tx, id) : (0, purge_1.purgeFolder)(tx, id)));
    await (0, audit_1.audit)({ userId: req.user.id, action: `${type}_purge`, entityType: type, entityId: id, oldValue: { name: row.name } }, req);
    (0, http_1.ok)(res, { purged: true });
}));
exports.default = router;
//# sourceMappingURL=trash.js.map