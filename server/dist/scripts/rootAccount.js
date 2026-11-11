"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.thaiDateStamp = thaiDateStamp;
exports.ensureRootAccount = ensureRootAccount;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../config/db");
const logger_1 = require("../shared/logger");
/** Today in Thailand as ddmmyyyy (Christian era), e.g. 10 Nov 2026 → "10112026" */
function thaiDateStamp(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('day')}${get('month')}${get('year')}`;
}
/**
 * Creates the account "root" (role root) the first time the server starts with this version, when no account has ever had
 * the role root. Its password is Root@<the Thai date of that day, ddmmyyyy> — not stored in the repository; change it after
 * the first sign-in (ตั้งค่า → เปลี่ยนรหัสผ่าน).
 */
async function ensureRootAccount() {
    const created = await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.q)(`DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'dochub-root-account', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 60000;`, {}, tx);
        if (await (0, db_1.q1)(`SELECT TOP 1 1 AS x FROM UserRoles WHERE role_id = 4`, {}, tx))
            return null;
        if (await (0, db_1.q1)(`SELECT TOP 1 1 AS x FROM Users WHERE username = N'root'`, {}, tx)) {
            logger_1.logger.warn('Root account not created: a user named "root" already exists (give it the role Root on the users page)');
            return null;
        }
        const stamp = thaiDateStamp();
        const row = await (0, db_1.q1)(`INSERT INTO Users (username, email, password_hash, display_name) OUTPUT inserted.user_id VALUES (N'root', NULL, @h, N'Root')`, { h: await bcryptjs_1.default.hash(`Root@${stamp}`, 12) }, tx);
        await (0, db_1.q)(`INSERT INTO UserRoles (user_id, role_id) VALUES (@u, 4)`, { u: db_1.T.uuid(row.user_id) }, tx);
        return `${stamp.slice(0, 2)}/${stamp.slice(2, 4)}/${stamp.slice(4)}`;
    });
    if (created)
        logger_1.logger.info(`Root account "root" created — password: Root@ + the Thai date ${created} written ddmmyyyy. Change it after signing in.`);
}
//# sourceMappingURL=rootAccount.js.map