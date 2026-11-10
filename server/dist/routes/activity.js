"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const permissions_1 = require("../shared/permissions");
const folders_1 = require("./folders");
const router = (0, express_1.Router)();
const pathOf = (ctx, folderId) => ctx.path(folderId).map((n) => ({ id: n.id, name: n.name }));
router.get('/activity/recent-files', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const ctx = await permissions_1.PermCtx.load(u);
    const favs = await (0, folders_1.favoriteSet)(u.id, 'file');
    const rows = await (0, db_1.q)(`SELECT TOP 24 f.file_id, f.file_name, f.folder_id, f.description, f.icon, f.color, f.status, f.created_by, f.created_at,
         f.updated_at, fo.folder_name, rf.viewed_at, cu.display_name AS created_by_name,
         (SELECT COUNT(*) FROM Sheets s WHERE s.file_id = f.file_id AND s.is_deleted = 0) AS sheet_count
       FROM RecentFiles rf JOIN Files f ON f.file_id = rf.file_id AND f.is_deleted = 0
       JOIN Folders fo ON fo.folder_id = f.folder_id
       LEFT JOIN Users cu ON cu.user_id = f.created_by
       WHERE rf.user_id = @u ORDER BY rf.viewed_at DESC`, { u: db_1.T.uuid(u.id) });
    (0, http_1.ok)(res, rows
        .map((r) => ({ ...(0, mappers_1.mapFile)(r, ctx.fileLevel(r), favs.has(r.file_id)), viewedAt: r.viewed_at, pathParts: pathOf(ctx, r.folder_id) }))
        .filter((f) => f.level >= permissions_1.LV.read)
        .slice(0, 12));
}));
/** Latest activity per file (SharePoint-like "Activity" cards) */
router.get('/activity/feed', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const ctx = await permissions_1.PermCtx.load(u);
    const favs = await (0, folders_1.favoriteSet)(u.id, 'file');
    const rows = await (0, db_1.q)(`SELECT TOP 150 f.file_id, f.file_name, f.folder_id, f.description, f.icon, f.color, f.status, f.created_by, f.created_at,
         f.updated_at, fo.folder_name, cu.display_name AS created_by_name, la.created_at AS last_activity_at, la.action_type AS last_action,
         la.display_name AS last_activity_by, la.avatar_url AS last_activity_avatar,
         (SELECT COUNT(*) FROM Sheets s WHERE s.file_id = f.file_id AND s.is_deleted = 0) AS sheet_count
       FROM Files f JOIN Folders fo ON fo.folder_id = f.folder_id
       LEFT JOIN Users cu ON cu.user_id = f.created_by
       CROSS APPLY (
         SELECT TOP 1 a.created_at, a.action_type, us.display_name, us.avatar_url
         FROM AuditLog a JOIN Users us ON us.user_id = a.user_id
         WHERE a.file_id = f.file_id ORDER BY a.created_at DESC
       ) la
       WHERE f.is_deleted = 0 ORDER BY la.created_at DESC`);
    (0, http_1.ok)(res, rows
        .map((r) => ({ ...(0, mappers_1.mapFile)(r, ctx.fileLevel(r), favs.has(r.file_id)), pathParts: pathOf(ctx, r.folder_id) }))
        .filter((f) => f.level >= permissions_1.LV.read)
        .slice(0, 16));
}));
exports.default = router;
//# sourceMappingURL=activity.js.map