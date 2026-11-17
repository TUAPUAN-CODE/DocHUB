import nodemailer from 'nodemailer';
import { q, q1, T } from '../../config/db';
import { decryptJson, encryptJson } from './secret';
import type { MailInput } from './outlook';

/**
 * Sending e-mail over plain SMTP (no Microsoft app needed): the server of the company mail system or any mailbox with its password.
 * Settings are typed on the plan page by a master / admin and kept encrypted in SystemSettings (the password is never sent back).
 */
const KEY = 'inkcode.mailSmtp';
export interface SmtpSettings { host: string; port: number; secure: boolean; user: string; password: string; from: string; allowSelfSigned: boolean }
export type SmtpPublic = Omit<SmtpSettings, 'password'> & { hasPassword: boolean; configured: boolean };
const EMPTY: SmtpSettings = { host: '', port: 587, secure: false, user: '', password: '', from: '', allowSelfSigned: false };
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const read = async (): Promise<SmtpSettings> => ({ ...EMPTY, ...(decryptJson<Partial<SmtpSettings>>((await q1(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k: KEY }))?.setting_value) ?? {}) });
const pub = (s: SmtpSettings): SmtpPublic => ({ host: s.host, port: s.port, secure: s.secure, user: s.user, from: s.from, allowSelfSigned: s.allowSelfSigned, hasPassword: !!s.password, configured: !!(s.host && s.from) });

export async function smtpStatus(): Promise<SmtpPublic> { return pub(await read()); }

/** `password` empty = keep the saved one */
export async function saveSmtp(b: Partial<SmtpSettings>, userId: string): Promise<SmtpPublic> {
  const cur = await read();
  const next: SmtpSettings = {
    host: String(b.host ?? '').trim().slice(0, 200), port: Math.min(65535, Math.max(1, Math.trunc(Number(b.port) || 587))), secure: !!b.secure,
    user: String(b.user ?? '').trim().slice(0, 200), password: b.password ? String(b.password).slice(0, 500) : (b.user?.trim() ? cur.password : ''),
    from: String(b.from ?? '').trim().slice(0, 200), allowSelfSigned: !!b.allowSelfSigned,
  };
  if (next.from && !EMAIL.test(next.from.replace(/^.*<([^>]+)>\s*$/, '$1'))) throw new Error('อีเมลผู้ส่ง (From) ไม่ถูกต้อง');
  await q(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
           WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (@k, @v, @u);`, { k: KEY, v: T.text(encryptJson(next)), u: T.uuid(userId) });
  return pub(next);
}

/** Sends through the saved SMTP server; returns the From address */
export async function sendSmtpMail(m: MailInput): Promise<string> {
  const s = await read();
  if (!s.host || !s.from) throw new Error('ยังไม่ได้ตั้งค่า SMTP (เซิร์ฟเวอร์ และอีเมลผู้ส่ง)');
  const t = nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure, ...(s.user ? { auth: { user: s.user, pass: s.password } } : {}),
    tls: { rejectUnauthorized: !s.allowSelfSigned }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  try { await t.sendMail({ from: s.from, to: m.to, cc: m.cc?.length ? m.cc : undefined, subject: m.subject, html: m.html }); }
  catch (e) { throw new Error(`ส่งผ่าน SMTP ไม่สำเร็จ: ${(e as Error).message}`); }
  finally { t.close(); }
  return s.from;
}
