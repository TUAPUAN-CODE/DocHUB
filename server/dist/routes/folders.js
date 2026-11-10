"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILES_SQL = void 0;
exports.favoriteSet = favoriteSet;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const permissions_1 = require("../shared/permissions");
const router = (0, express_1.Router)();
exports.FILES_SQL = `
SELECT f.file_id, f.file_name, f.folder_id, f.description, f.icon, f.color, f.status, f.created_by, f.created_at, f.updated_at,
  cu.display_name AS created_by_name, fo.folder_name,
  (SELECT COUNT(*) FROM Sheets s WHERE s.file_id = f.file_id AND s.is_deleted = 0) AS sheet_count,
  la.created_at AS last_activity_at, la.action_type AS last_action, la.display_name AS last_activity_by,
  la.avatar_url AS last_activity_avatar
FROM Files f
JOIN Users cu ON cu.user_id = f.created_by
JOIN Folders fo ON fo.folder_id = f.folder_id
OUTER APPLY (
  SELECT TOP 1 a.created_at, a.action_type, u.display_name, u.avatar_url
  FROM AuditLog a JOIN Users u ON u.user_id = a.user_id
  WHERE a.file_id = f.file_id ORDER BY a.created_at DESC
) la`;
async function favoriteSet(userId, type) {
    const rows = await (0, db_1.q)(`SELECT entity_id FROM Favorites WHERE user_id = @u AND entity_type = @t`, { u: db_1.T.uuid(userId), t: type });
    return new Set(rows.map((r) => r.entity_id));
}
async function fileCounts() {
    const rows = await (0, db_1.q)(`SELECT folder_id, COUNT(*) AS n FROM Files WHERE is_deleted = 0 GROUP BY folder_id`);
    return new Map(rows.map((r) => [r.folder_id, Number(r.n)]));
}
function folderOut(ctx, id, favs, counts, vis) {
    const f = ctx.index.map.get(id);
    return {
        ...(0, mappers_1.mapFolderNode)(f),
        level: ctx.folderLevel(id),
        favorite: favs.has(id),
        fileCount: counts.get(id) ?? 0,
        folderCount: (ctx.index.children.get(id) ?? []).filter(vis).length,
    };
}
const byName = (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'th');
router.get('/folders/tree', (0, http_1.ah)(async (req, res) => {
    const ctx = await permissions_1.PermCtx.load(req.user);
    const vis = await ctx.visibility();
    const [favs, counts] = await Promise.all([favoriteSet(req.user.id, 'folder'), fileCounts()]);
    const list = [...ctx.index.map.keys()].filter(vis).map((id) => folderOut(ctx, id, favs, counts, vis));
    (0, http_1.ok)(res, list.sort(byName));
}));
router.get('/folders/:id/contents', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const ctx = await permissions_1.PermCtx.load(u);
    const vis = await ctx.visibility();
    const [favFolders, favFiles, counts] = await Promise.all([favoriteSet(u.id, 'folder'), favoriteSet(u.id, 'file'), fileCounts()]);
    const canCreateRoot = !(0, auth_1.isBasicRole)(u.role);
    if (req.params.id === 'root') {
        const subfolders = (ctx.index.children.get(null) ?? []).filter(vis).map((id) => folderOut(ctx, id, favFolders, counts, vis));
        return (0, http_1.ok)(res, { folder: null, breadcrumb: [], level: canCreateRoot ? permissions_1.LV.write : permissions_1.LV.read, subfolders: subfolders.sort(byName), files: [] });
    }
    const id = (0, http_1.pid)(req);
    if (!ctx.index.map.has(id))
        throw (0, http_1.notFound)('ไม่พบโฟลเดอร์');
    if (!vis(id)) {
        // opened from a shared link without access: say whose folder it is and let them ask for access
        const pending = await (0, db_1.q1)(`SELECT TOP 1 request_id, permission, created_at FROM AccessRequests
         WHERE folder_id = @f AND requester_id = @u AND status = 'pending' ORDER BY created_at DESC`, { f: db_1.T.uuid(id), u: db_1.T.uuid(u.id) });
        throw (0, http_1.forbidden)('คุณยังไม่มีสิทธิ์เข้าถึงโฟลเดอร์นี้', 'NO_ACCESS', {
            targetType: 'folder', targetId: id, name: ctx.index.map.get(id).name, currentLevel: 'none',
            pending: pending ? { id: pending.request_id, permission: pending.permission, createdAt: pending.created_at } : null,
        });
    }
    const level = ctx.folderLevel(id);
    const subfolders = (ctx.index.children.get(id) ?? []).filter(vis).map((cid) => folderOut(ctx, cid, favFolders, counts, vis));
    const files = await (0, db_1.q)(`${exports.FILES_SQL} WHERE f.folder_id = @id AND f.is_deleted = 0 ORDER BY f.file_name`, { id: db_1.T.uuid(id) });
    const mapped = files
        .map((f) => (0, mappers_1.mapFile)(f, ctx.fileLevel(f), favFiles.has(f.file_id)))
        .filter((f) => env_1.env.showLockedItems || f.level > 0);
    (0, http_1.ok)(res, {
        folder: folderOut(ctx, id, favFolders, counts, vis),
        breadcrumb: ctx.path(id).map((n) => ({ id: n.id, name: n.name })),
        level,
        subfolders: subfolders.sort(byName),
        files: mapped,
    });
}));
const folderBody = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'กรุณาตั้งชื่อโฟลเดอร์').max(300),
    description: zod_1.z.string().max(1000).nullish(),
    color: http_1.zColor.nullish(),
    icon: zod_1.z.string().max(100).nullish(),
});
router.post('/folders', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    if ((0, auth_1.isBasicRole)(u.role))
        throw (0, http_1.forbidden)('เฉพาะ Master หรือ Admin เท่านั้นที่สร้างโฟลเดอร์ได้');
    const body = (0, http_1.parse)(folderBody.extend({ parentId: http_1.zId.nullish() }), req.body);
    if (body.parentId)
        await (0, permissions_1.requireFolder)(u, body.parentId, permissions_1.LV.write);
    const dup = await (0, db_1.q1)(`SELECT 1 AS x FROM Folders WHERE is_deleted = 0 AND folder_name = @n AND
         ((@p IS NULL AND parent_id IS NULL) OR parent_id = @p)`, { n: body.name, p: db_1.T.uuid(body.parentId ?? null) });
    if (dup)
        throw (0, http_1.conflict)('มีโฟลเดอร์ชื่อนี้อยู่แล้วในตำแหน่งเดียวกัน');
    const row = await (0, db_1.q1)(`INSERT INTO Folders (folder_name, parent_id, description, color, icon, created_by) OUTPUT inserted.folder_id
       VALUES (@n, @p, @d, COALESCE(@c, N'#1552F0'), COALESCE(@i, N'folder'), @u)`, { n: body.name, p: db_1.T.uuid(body.parentId ?? null), d: db_1.T.text(body.description ?? null), c: db_1.T.text(body.color ?? null), i: db_1.T.text(body.icon ?? null), u: db_1.T.uuid(u.id) });
    (0, permissions_1.invalidateFolders)();
    await (0, audit_1.audit)({ userId: u.id, action: 'folder_create', entityType: 'folder', entityId: row.folder_id, newValue: body }, req);
    const ctx = await permissions_1.PermCtx.load(u);
    (0, http_1.ok)(res, { ...(0, mappers_1.mapFolderNode)(ctx.index.map.get(row.folder_id)), level: ctx.folderLevel(row.folder_id), favorite: false, fileCount: 0, folderCount: 0 }, 201);
}));
router.put('/folders/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { folder } = await (0, permissions_1.requireFolder)(req.user, id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(folderBody.partial(), req.body);
    await (0, db_1.q)(`UPDATE Folders SET folder_name = COALESCE(@n, folder_name), description = CASE WHEN @hasD = 1 THEN @d ELSE description END,
         color = COALESCE(@c, color), icon = COALESCE(@i, icon), updated_at = SYSUTCDATETIME() WHERE folder_id = @id`, { n: db_1.T.text(body.name ?? null), hasD: body.description !== undefined, d: db_1.T.text(body.description ?? null), c: db_1.T.text(body.color ?? null), i: db_1.T.text(body.icon ?? null), id: db_1.T.uuid(id) });
    (0, permissions_1.invalidateFolders)();
    await (0, audit_1.audit)({ userId: req.user.id, action: 'folder_update', entityType: 'folder', entityId: id,
        oldValue: { name: folder.name, color: folder.color }, newValue: body }, req);
    (0, http_1.ok)(res, { updated: true });
}));
router.post('/folders/:id/move', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const u = req.user;
    const { folder, ctx } = await (0, permissions_1.requireFolder)(u, id, permissions_1.LV.manage);
    const { parentId } = (0, http_1.parse)(zod_1.z.object({ parentId: http_1.zId.nullable() }), req.body);
    if (parentId) {
        if (ctx.descendants(id).includes(parentId))
            throw (0, http_1.badRequest)('ไม่สามารถย้ายโฟลเดอร์ไปไว้ในโฟลเดอร์ย่อยของตัวเองได้');
        await (0, permissions_1.requireFolder)(u, parentId, permissions_1.LV.write);
    }
    else if ((0, auth_1.isBasicRole)(u.role))
        throw (0, http_1.forbidden)();
    await (0, db_1.q)(`UPDATE Folders SET parent_id = @p, updated_at = SYSUTCDATETIME() WHERE folder_id = @id`, { p: db_1.T.uuid(parentId), id: db_1.T.uuid(id) });
    (0, permissions_1.invalidateFolders)();
    await (0, audit_1.audit)({ userId: u.id, action: 'folder_move', entityType: 'folder', entityId: id, oldValue: { parentId: folder.parentId }, newValue: { parentId } }, req);
    (0, http_1.ok)(res, { moved: true });
}));
router.delete('/folders/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const u = req.user;
    const { folder, ctx } = await (0, permissions_1.requireFolder)(u, id, permissions_1.LV.manage);
    const ids = ctx.descendants(id);
    const batch = crypto_1.default.randomUUID();
    await (0, db_1.withTx)(async (tx) => {
        const p = { ids: (0, db_1.jsonParam)(ids), u: db_1.T.uuid(u.id), b: db_1.T.uuid(batch) };
        await (0, db_1.q)(`UPDATE Folders SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @u, delete_batch = @b
               WHERE is_deleted = 0 AND folder_id IN ${(0, db_1.idList)('@ids')}`, p, tx);
        await (0, db_1.q)(`UPDATE Files SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @u, delete_batch = @b
               WHERE is_deleted = 0 AND folder_id IN ${(0, db_1.idList)('@ids')}`, p, tx);
        await (0, audit_1.audit)({ userId: u.id, action: 'folder_delete', entityType: 'folder', entityId: id, oldValue: { name: folder.name, subfolders: ids.length - 1 } }, req, tx);
    });
    (0, permissions_1.invalidateFolders)();
    (0, http_1.ok)(res, { deleted: true, batch });
}));
exports.default = router;
//# sourceMappingURL=folders.js.map