"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const router = (0, express_1.Router)();
router.get('/audit', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    const { page, pageSize, offset } = (0, http_1.pageParams)(req.query, 30, 200);
    const where = ['1 = 1'];
    const p = {};
    const qs = req.query;
    if (qs.fileId && (0, http_1.isGuid)(qs.fileId)) {
        const fileId = qs.fileId.toLowerCase();
        if (u.role !== 'admin')
            await (0, permissions_1.requireFile)(u, fileId, permissions_1.LV.manage);
        where.push('a.file_id = @file');
        p.file = db_1.T.uuid(fileId);
    }
    else if ((0, auth_1.isBasicRole)(u.role)) {
        where.push('a.user_id = @me');
        p.me = db_1.T.uuid(u.id);
    }
    else if (u.role === 'master') {
        const ctx = await permissions_1.PermCtx.load(u);
        const files = await (0, db_1.q)(`SELECT file_id, folder_id, created_by FROM Files`);
        const manageable = files.filter((f) => ctx.fileLevel(f) >= permissions_1.LV.manage).map((f) => f.file_id);
        where.push(`(a.user_id = @me OR a.file_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@mf)))`);
        p.me = db_1.T.uuid(u.id);
        p.mf = (0, db_1.jsonParam)(manageable);
    }
    if (qs.sheetId && (0, http_1.isGuid)(qs.sheetId)) {
        where.push('a.sheet_id = @sheet');
        p.sheet = db_1.T.uuid(qs.sheetId);
    }
    if (qs.userId && (0, http_1.isGuid)(qs.userId)) {
        where.push('a.user_id = @uid');
        p.uid = db_1.T.uuid(qs.userId);
    }
    if (qs.action) {
        const actions = qs.action.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);
        where.push(`a.action_type IN (SELECT [value] FROM OPENJSON(@acts))`);
        p.acts = (0, db_1.jsonParam)(actions);
    }
    if (qs.from) {
        where.push('a.created_at >= @from');
        p.from = db_1.T.dt(qs.from);
    }
    if (qs.to) {
        where.push('a.created_at <= @to');
        p.to = db_1.T.dt(qs.to);
    }
    if (qs.search?.trim()) {
        where.push('(a.new_value LIKE @s OR a.old_value LIKE @s OR f.file_name LIKE @s OR u.display_name LIKE @s)');
        p.s = `%${(0, http_1.likeEscape)(qs.search.trim())}%`;
    }
    const from = `FROM AuditLog a JOIN Users u ON u.user_id = a.user_id
      LEFT JOIN Files f ON f.file_id = a.file_id LEFT JOIN Sheets s ON s.sheet_id = a.sheet_id
      WHERE ${where.join(' AND ')}`;
    const count = await (0, db_1.q1)(`SELECT COUNT(*) AS n ${from}`, p);
    const rows = await (0, db_1.q)(`SELECT a.log_id, a.user_id, u.display_name, u.avatar_url, a.action_type, a.entity_type, a.entity_id, a.file_id, f.file_name,
         a.sheet_id, s.sheet_name, a.old_value, a.new_value, a.ip_address, a.created_at
       ${from} ORDER BY a.log_id DESC OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`, p);
    (0, http_1.ok)(res, {
        items: rows.map((r) => ({
            id: Number(r.log_id),
            userId: r.user_id,
            userName: r.display_name,
            avatarUrl: r.avatar_url,
            action: r.action_type,
            entityType: r.entity_type,
            entityId: r.entity_id,
            fileId: r.file_id,
            fileName: r.file_name,
            sheetId: r.sheet_id,
            sheetName: r.sheet_name,
            oldValue: (0, http_1.safeJson)(r.old_value, null),
            newValue: (0, http_1.safeJson)(r.new_value, null),
            ip: r.ip_address,
            at: r.created_at,
        })),
        total: Number(count?.n ?? 0),
        page,
        pageSize,
    });
}));
exports.default = router;
//# sourceMappingURL=audit.js.map