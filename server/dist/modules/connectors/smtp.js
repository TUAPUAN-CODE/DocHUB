"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.smtpStatus = smtpStatus;
exports.saveSmtp = saveSmtp;
exports.sendSmtpMail = sendSmtpMail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const db_1 = require("../../config/db");
const secret_1 = require("./secret");
/**
 * Sending e-mail over plain SMTP (no Microsoft app needed): the server of the company mail system or any mailbox with its password.
 * Settings are typed on the plan page by a master / admin and kept encrypted in SystemSettings (the password is never sent back).
 */
const KEY = 'inkcode.mailSmtp';
const EMPTY = { host: '', port: 587, secure: false, user: '', password: '', from: '', allowSelfSigned: false };
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const read = async () => ({ ...EMPTY, ...((0, secret_1.decryptJson)((await (0, db_1.q1)(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k: KEY }))?.setting_value) ?? {}) });
const pub = (s) => ({ host: s.host, port: s.port, secure: s.secure, user: s.user, from: s.from, allowSelfSigned: s.allowSelfSigned, hasPassword: !!s.password, configured: !!(s.host && s.from) });
async function smtpStatus() { return pub(await read()); }
/** `password` empty = keep the saved one */
async function saveSmtp(b, userId) {
    const cur = await read();
    const next = {
        host: String(b.host ?? '').trim().slice(0, 200), port: Math.min(65535, Math.max(1, Math.trunc(Number(b.port) || 587))), secure: !!b.secure,
        user: String(b.user ?? '').trim().slice(0, 200), password: b.password ? String(b.password).slice(0, 500) : (b.user?.trim() ? cur.password : ''),
        from: String(b.from ?? '').trim().slice(0, 200), allowSelfSigned: !!b.allowSelfSigned,
    };
    if (next.from && !EMAIL.test(next.from.replace(/^.*<([^>]+)>\s*$/, '$1')))
        throw new Error('อีเมลผู้ส่ง (From) ไม่ถูกต้อง');
    await (0, db_1.q)(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
           WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (@k, @v, @u);`, { k: KEY, v: db_1.T.text((0, secret_1.encryptJson)(next)), u: db_1.T.uuid(userId) });
    return pub(next);
}
/** Sends through the saved SMTP server; returns the From address */
async function sendSmtpMail(m) {
    const s = await read();
    if (!s.host || !s.from)
        throw new Error('ยังไม่ได้ตั้งค่า SMTP (เซิร์ฟเวอร์ และอีเมลผู้ส่ง)');
    const t = nodemailer_1.default.createTransport({
        host: s.host, port: s.port, secure: s.secure, ...(s.user ? { auth: { user: s.user, pass: s.password } } : {}),
        tls: { rejectUnauthorized: !s.allowSelfSigned }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
    try {
        await t.sendMail({ from: s.from, to: m.to, cc: m.cc?.length ? m.cc : undefined, subject: m.subject, html: m.html });
    }
    catch (e) {
        throw new Error(`ส่งผ่าน SMTP ไม่สำเร็จ: ${e.message}`);
    }
    finally {
        t.close();
    }
    return s.from;
}
//# sourceMappingURL=smtp.js.map