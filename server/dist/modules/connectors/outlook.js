"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outlookDisconnect = void 0;
exports.saveOutlookSignIn = saveOutlookSignIn;
exports.outlookStatus = outlookStatus;
exports.sendOutlookMail = sendOutlookMail;
const db_1 = require("../../config/db");
const secret_1 = require("./secret");
const source_1 = require("./source");
/**
 * The Outlook mailbox the system sends its notification e-mails from: an admin / master signs in with Microsoft once (popup of the
 * plan page) and the refresh token is kept encrypted in SystemSettings. Mail goes out through Microsoft Graph (POST /me/sendMail),
 * so it needs the delegated permission Mail.Send on the Azure app (docs/PLAN_MAIL.md).
 */
const KEY = 'inkcode.mailSender';
const read = async () => (0, secret_1.decryptJson)((await (0, db_1.q1)(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k: KEY }))?.setting_value);
async function write(v, userId) {
    if (!v)
        return void (await (0, db_1.q)(`DELETE FROM SystemSettings WHERE setting_key = @k`, { k: KEY }));
    await (0, db_1.q)(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
           WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (@k, @v, @u);`, { k: KEY, v: db_1.T.text((0, secret_1.encryptJson)(v)), u: db_1.T.uuid(userId) });
}
const graph = async (token, path, init) => {
    const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error?.message || `Microsoft Graph ${r.status}`);
    }
    return r.status === 202 || r.status === 204 ? null : r.json();
};
/** Called by the Microsoft sign-in callback (state kind "mail"): keeps the token and who signed in */
async function saveOutlookSignIn(refresh, accessToken, userId) {
    let account, name;
    try {
        if (accessToken) {
            const me = await graph(accessToken, '/me?$select=displayName,mail,userPrincipalName');
            account = me?.mail || me?.userPrincipalName;
            name = me?.displayName;
        }
    }
    catch { /* the address is only shown to the admin */ }
    await write({ refresh, account, name, by: userId, at: new Date().toISOString() }, userId);
}
async function outlookStatus() {
    const s = await read();
    return { configured: (0, source_1.msConfigured)(), connected: !!s?.refresh, account: s?.account ?? null, name: s?.name ?? null };
}
const outlookDisconnect = (userId) => write(null, userId);
exports.outlookDisconnect = outlookDisconnect;
async function accessToken() {
    if (!(0, source_1.msConfigured)())
        throw new Error('ยังไม่ได้ตั้งค่า MS_CLIENT_ID / MS_CLIENT_SECRET บนเซิร์ฟเวอร์');
    const s = await read();
    if (!s?.refresh)
        throw new Error('ยังไม่ได้เชื่อม Outlook สำหรับส่งอีเมล');
    let tok;
    try {
        tok = await (0, source_1.msToken)({ grant_type: 'refresh_token', refresh_token: s.refresh }, source_1.MS_MAIL_SCOPE);
    }
    catch (e) {
        throw new Error(`การเชื่อม Outlook หมดอายุหรือไม่มีสิทธิ์ Mail.Send — เชื่อมใหม่อีกครั้ง (${e.message})`);
    }
    if (tok.refresh_token && tok.refresh_token !== s.refresh)
        await write({ ...s, refresh: tok.refresh_token }, null);
    return { token: tok.access_token, account: s.account };
}
/** Sends one message from the connected Outlook mailbox (saved in its Sent Items). Returns the sender address. */
async function sendOutlookMail(m) {
    const { token, account } = await accessToken();
    const rcpt = (a) => a.map((address) => ({ emailAddress: { address } }));
    await graph(token, '/me/sendMail', { method: 'POST', body: JSON.stringify({ message: { subject: m.subject, body: { contentType: 'HTML', content: m.html }, toRecipients: rcpt(m.to), ccRecipients: rcpt(m.cc ?? []) }, saveToSentItems: true }) });
    return account;
}
//# sourceMappingURL=outlook.js.map