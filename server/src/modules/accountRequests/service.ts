import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { q, q1 } from '../../config/db';
import { env } from '../../config/env';
import { notify } from '../../shared/notify';

/** Microsoft / Google identity of someone without an account, carried to the sign-up form (30 min, signed) */
export interface OAuthSignup { purpose: 'signup'; p: 'google' | 'microsoft'; sub: string; email: string; name: string; from: string }

export const signSignupToken = (v: Omit<OAuthSignup, 'purpose'>) => jwt.sign({ ...v, purpose: 'signup' }, env.jwt.secret, { expiresIn: '30m' });
export function readSignupToken(token: string): OAuthSignup | null {
  try {
    const v = jwt.verify(token, env.jwt.secret) as OAuthSignup;
    return v.purpose === 'signup' && v.sub && v.email ? v : null;
  } catch {
    return null;
  }
}

export async function pendingForIdentity(p: string, sub: string) {
  return q1(`SELECT request_id FROM AccountRequests WHERE status = 'pending' AND provider = @p AND provider_subject = @s`, { p, s: sub });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 40) || 'user';

/** A free username made from `base` (e-mail local part) */
export async function uniqueUsername(base: string) {
  const name = slug(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? name : `${name}${i + 1}`;
    const taken = await q1(
      `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM Users WHERE username = @u) OR EXISTS (SELECT 1 FROM AccountRequests WHERE status = 'pending' AND username = @u)`,
      { u: candidate },
    );
    if (!taken) return candidate;
  }
  return `${name}${crypto.randomBytes(3).toString('hex')}`;
}

export async function notifyAdmins(title: string, message: string) {
  const admins = await q(`SELECT u.user_id FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id AND ur.role_id >= 3 WHERE u.is_active = 1`);
  await notify(admins.map((a) => a.user_id), { type: 'account_request', title, message, link: '/users/requests' });
}
