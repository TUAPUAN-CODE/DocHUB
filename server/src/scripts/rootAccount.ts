import bcrypt from 'bcryptjs';
import { q, q1, T, withTx } from '../config/db';
import { logger } from '../shared/logger';

/** Today in Thailand as ddmmyyyy (Christian era), e.g. 10 Nov 2026 → "10112026" */
export function thaiDateStamp(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}${get('month')}${get('year')}`;
}

/**
 * Creates the account "root" (role root) the first time the server starts with this version, when no account has ever had
 * the role root. Its password is Root@<the Thai date of that day, ddmmyyyy> — not stored in the repository; change it after
 * the first sign-in (ตั้งค่า → เปลี่ยนรหัสผ่าน).
 */
export async function ensureRootAccount() {
  const created = await withTx(async (tx) => {
    await q(`DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'dochub-root-account', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 60000;`, {}, tx);
    if (await q1(`SELECT TOP 1 1 AS x FROM UserRoles WHERE role_id = 4`, {}, tx)) return null;
    if (await q1(`SELECT TOP 1 1 AS x FROM Users WHERE username = N'root'`, {}, tx)) {
      logger.warn('Root account not created: a user named "root" already exists (give it the role Root on the users page)');
      return null;
    }
    const stamp = thaiDateStamp();
    const row = await q1(
      `INSERT INTO Users (username, email, password_hash, display_name) OUTPUT inserted.user_id VALUES (N'root', NULL, @h, N'Root')`,
      { h: await bcrypt.hash(`Root@${stamp}`, 12) },
      tx,
    );
    await q(`INSERT INTO UserRoles (user_id, role_id) VALUES (@u, 4)`, { u: T.uuid(row!.user_id) }, tx);
    return `${stamp.slice(0, 2)}/${stamp.slice(2, 4)}/${stamp.slice(4)}`;
  });
  if (created) logger.info(`Root account "root" created — password: Root@ + the Thai date ${created} written ddmmyyyy. Change it after signing in.`);
}
