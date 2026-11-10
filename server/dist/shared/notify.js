"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
const db_1 = require("../config/db");
const socket_1 = require("../socket");
const logger_1 = require("./logger");
const mappers_1 = require("./mappers");
/** Stores a notification for each user and pushes it over the socket. Never throws. */
async function notify(userIds, n) {
    const ids = [...new Set(userIds.filter(Boolean).map((i) => i.toLowerCase()))];
    if (!ids.length)
        return;
    try {
        const rows = await (0, db_1.q)(`INSERT INTO Notifications (user_id, type, title, message, link)
       OUTPUT inserted.*
       SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER), @type, @title, @message, @link FROM OPENJSON(@ids)`, {
            ids: db_1.T.text(JSON.stringify(ids)),
            type: n.type,
            title: n.title.slice(0, 300),
            message: n.message.slice(0, 2000),
            link: db_1.T.text(n.link ?? null),
        });
        for (const r of rows)
            (0, socket_1.emitToUser)(r.user_id, 'notification', (0, mappers_1.mapNotification)(r));
    }
    catch (e) {
        logger_1.logger.error(`notify failed: ${e?.message}`);
    }
}
//# sourceMappingURL=notify.js.map