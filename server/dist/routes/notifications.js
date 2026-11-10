"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const router = (0, express_1.Router)();
router.get('/notifications', (0, http_1.ah)(async (req, res) => {
    const u = db_1.T.uuid(req.user.id);
    const limit = (0, http_1.clamp)(Number(req.query.limit) || 30, 1, 100);
    const unreadOnly = req.query.unread === 'true';
    const rows = await (0, db_1.q)(`SELECT TOP (${limit}) * FROM Notifications WHERE user_id = @u ${unreadOnly ? 'AND is_read = 0' : ''} ORDER BY created_at DESC`, { u });
    const c = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM Notifications WHERE user_id = @u AND is_read = 0`, { u });
    (0, http_1.ok)(res, { items: rows.map(mappers_1.mapNotification), unreadCount: Number(c?.n ?? 0) });
}));
router.post('/notifications/read-all', (0, http_1.ah)(async (req, res) => {
    await (0, db_1.q)(`UPDATE Notifications SET is_read = 1 WHERE user_id = @u AND is_read = 0`, { u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { read: true });
}));
router.post('/notifications/:id/read', (0, http_1.ah)(async (req, res) => {
    await (0, db_1.q)(`UPDATE Notifications SET is_read = 1 WHERE notification_id = @id AND user_id = @u`, { id: db_1.T.uuid((0, http_1.pid)(req)), u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { read: true });
}));
exports.default = router;
//# sourceMappingURL=notifications.js.map