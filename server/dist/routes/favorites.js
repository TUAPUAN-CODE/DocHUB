"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const router = (0, express_1.Router)();
router.get('/favorites', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const ctx = await permissions_1.PermCtx.load(u);
    const favs = await (0, db_1.q)(`SELECT entity_type, entity_id, created_at FROM Favorites WHERE user_id = @u ORDER BY created_at DESC`, { u: db_1.T.uuid(u.id) });
    const fileIds = favs.filter((f) => f.entity_type === 'file').map((f) => f.entity_id);
    const files = fileIds.length
        ? await (0, db_1.q)(`SELECT file_id, file_name, folder_id, created_by, color FROM Files WHERE is_deleted = 0
           AND file_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`, { ids: db_1.T.text(JSON.stringify(fileIds)) })
        : [];
    const fileMap = new Map(files.map((f) => [f.file_id, f]));
    const items = favs
        .map((f) => {
        if (f.entity_type === 'folder') {
            const node = ctx.index.map.get(f.entity_id);
            if (!node)
                return null;
            return { type: 'folder', id: node.id, name: node.name, color: node.color, path: ctx.pathText(node.id), level: ctx.folderLevel(node.id) };
        }
        const file = fileMap.get(f.entity_id);
        if (!file)
            return null;
        return { type: 'file', id: file.file_id, name: file.file_name, color: file.color, path: ctx.pathText(file.folder_id), level: ctx.fileLevel(file) };
    })
        .filter(Boolean);
    (0, http_1.ok)(res, items);
}));
router.post('/favorites/toggle', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const { entityType, entityId } = (0, http_1.parse)(zod_1.z.object({ entityType: zod_1.z.enum(['file', 'folder']), entityId: http_1.zId }), req.body);
    const exists = entityType === 'file'
        ? await (0, db_1.q1)(`SELECT 1 AS x FROM Files WHERE file_id = @id AND is_deleted = 0`, { id: db_1.T.uuid(entityId) })
        : await (0, db_1.q1)(`SELECT 1 AS x FROM Folders WHERE folder_id = @id AND is_deleted = 0`, { id: db_1.T.uuid(entityId) });
    if (!exists)
        throw (0, http_1.notFound)();
    const p = { u: db_1.T.uuid(u.id), t: entityType, id: db_1.T.uuid(entityId) };
    const cur = await (0, db_1.q1)(`SELECT 1 AS x FROM Favorites WHERE user_id = @u AND entity_type = @t AND entity_id = @id`, p);
    if (cur)
        await (0, db_1.q)(`DELETE FROM Favorites WHERE user_id = @u AND entity_type = @t AND entity_id = @id`, p);
    else
        await (0, db_1.q)(`INSERT INTO Favorites (user_id, entity_type, entity_id) VALUES (@u, @t, @id)`, p);
    (0, http_1.ok)(res, { favorite: !cur });
}));
exports.default = router;
//# sourceMappingURL=favorites.js.map