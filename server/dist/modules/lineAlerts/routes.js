"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineWebhook = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const logger_1 = require("../../shared/logger");
const config_1 = require("./config");
const line_1 = require("./line");
/** Called by LINE (no login): learns the ids of users / groups that talk to the bot. Protected by the channel-secret signature. */
exports.lineWebhook = (0, express_1.Router)();
exports.lineWebhook.post('/line/webhook', (0, http_1.ah)(async (req, res) => {
    if (!(0, line_1.validSignature)(req.rawBody, req.get('x-line-signature')))
        return void res.status(401).json({ success: false });
    res.json({ success: true }); // answer fast; LINE retries on slow replies
    try {
        for (const ev of (req.body?.events ?? [])) {
            const src = ev.source ?? {};
            const id = src.groupId ?? src.roomId ?? src.userId;
            if (!id)
                continue;
            const kind = src.groupId ? 'group' : src.roomId ? 'room' : 'user';
            await (0, db_1.q)(`MERGE LineTargets AS t USING (SELECT @id AS target_id) AS s ON t.target_id = s.target_id
         WHEN MATCHED THEN UPDATE SET last_seen = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (target_id, kind, label) VALUES (@id, @kind, @label);`, { id: db_1.T.text(id), kind: db_1.T.text(kind), label: db_1.T.text(kind === 'group' ? 'กลุ่ม LINE' : kind === 'room' ? 'ห้องแชต' : 'ผู้ใช้ LINE') });
            // typing "id" in the chat shows the id (handy to copy it elsewhere)
            if (ev.type === 'message' && ev.message?.type === 'text' && /^\s*(id|ไอดี)\s*$/i.test(ev.message.text) && ev.replyToken)
                await (0, line_1.replyText)(ev.replyToken, `ID: ${id}`);
        }
    }
    catch (e) {
        logger_1.logger.error(`LINE webhook failed: ${e.message}`);
    }
}));
/** For managers of a sheet, from the alert editor */
const router = (0, express_1.Router)();
router.get('/sheets/:id/line/targets', (0, http_1.ah)(async (req, res) => {
    await (0, permissions_1.requireSheet)(req.user, (0, http_1.pid)(req), permissions_1.LV.manage);
    const rows = await (0, db_1.q)(`SELECT TOP 100 target_id, kind, label, last_seen FROM LineTargets ORDER BY last_seen DESC`);
    (0, http_1.ok)(res, { enabled: (0, config_1.lineEnabled)(), targets: rows.map((r) => ({ id: r.target_id, kind: r.kind, label: r.label, lastSeen: r.last_seen })) });
}));
router.put('/sheets/:id/line/targets/:targetId', (0, http_1.ah)(async (req, res) => {
    await (0, permissions_1.requireSheet)(req.user, (0, http_1.pid)(req), permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ label: zod_1.z.string().trim().min(1).max(100) }), req.body);
    await (0, db_1.q)(`UPDATE LineTargets SET label = @l WHERE target_id = @t`, { l: db_1.T.text(body.label), t: db_1.T.text(req.params.targetId) });
    (0, http_1.ok)(res, {});
}));
router.post('/sheets/:id/line/test', (0, http_1.ah)(async (req, res) => {
    await (0, permissions_1.requireSheet)(req.user, (0, http_1.pid)(req), permissions_1.LV.manage);
    if (!(0, config_1.lineEnabled)())
        throw (0, http_1.badRequest)('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ที่เซิร์ฟเวอร์');
    const body = (0, http_1.parse)(zod_1.z.object({ targetId: zod_1.z.string().trim().min(5).max(64) }), req.body);
    try {
        await (0, line_1.pushText)(body.targetId, `✅ ทดสอบแจ้งเตือนจาก DataSheet Pro${config_1.lineConfig.appUrl ? `\n${config_1.lineConfig.appUrl}` : ''}`);
    }
    catch (e) {
        throw (0, http_1.badRequest)(`ส่ง LINE ไม่สำเร็จ: ${e.message}`);
    }
    (0, http_1.ok)(res, { sent: true });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map