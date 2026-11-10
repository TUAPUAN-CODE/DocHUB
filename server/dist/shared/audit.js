"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit = void 0;
exports.auditMany = auditMany;
const db_1 = require("../config/db");
const http_1 = require("./http");
const enc = (v) => (v === undefined ? null : JSON.stringify(v));
/** Inserts any number of audit rows with a single statement per 500 rows. */
async function auditMany(entries, req, tx) {
    if (!entries.length)
        return;
    const { ip, ua } = (0, http_1.reqMeta)(req);
    for (let i = 0; i < entries.length; i += 500) {
        const chunk = entries.slice(i, i + 500).map((e) => ({
            user_id: e.userId,
            action_type: e.action,
            entity_type: e.entityType,
            entity_id: String(e.entityId).slice(0, 100),
            file_id: e.fileId ?? null,
            sheet_id: e.sheetId ?? null,
            old_value: enc(e.oldValue),
            new_value: enc(e.newValue),
        }));
        await (0, db_1.q)(`INSERT INTO AuditLog (user_id, action_type, entity_type, entity_id, file_id, sheet_id, old_value, new_value, ip_address, user_agent)
       SELECT user_id, action_type, entity_type, entity_id, file_id, sheet_id, old_value, new_value, @ip, @ua
       FROM OPENJSON(@j) WITH (
         user_id UNIQUEIDENTIFIER, action_type NVARCHAR(50), entity_type NVARCHAR(50), entity_id NVARCHAR(100),
         file_id UNIQUEIDENTIFIER, sheet_id UNIQUEIDENTIFIER, old_value NVARCHAR(MAX), new_value NVARCHAR(MAX))`, { j: db_1.T.text(JSON.stringify(chunk)), ip: db_1.T.text(ip), ua: db_1.T.text(ua) }, tx);
    }
}
const audit = (e, req, tx) => auditMany([e], req, tx);
exports.audit = audit;
//# sourceMappingURL=audit.js.map