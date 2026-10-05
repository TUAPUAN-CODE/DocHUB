import crypto from 'crypto';
import { env } from '../../config/env';

/**
 * Encrypts what the browser must never read back (API passwords, tokens, AI keys).
 * Key: SECRETS_KEY from the environment (recommended, 32+ chars) — falls back to JWT_SECRET so it works out of the box.
 */
const key = () => crypto.scryptSync(process.env.SECRETS_KEY || env.jwt.secret, 'datasheet-secrets-v1', 32);

export function encryptJson(v: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(v), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptJson<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    const [v, iv, tag, data] = s.split('.');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8')) as T;
  } catch { return null; }
}
