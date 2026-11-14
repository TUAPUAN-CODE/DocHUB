import { RequestHandler } from 'express';
import { q } from '../../config/db';
import { Role, ROLE_ID } from '../../middleware/auth';
import { broadcast, onBroadcast } from '../../services/cluster';
import { forbidden } from '../../shared/http';
import { PageDef, PAGES } from './registry';

/** role|page → allowed, as saved by a root (missing = the page's default) */
let cache: { at: number; rows: Map<string, boolean> } | null = null;
const CACHE_MS = 30_000;

export function invalidatePageAccess() {
  cache = null; labelCache = null; orderCache = null;
  broadcast('pageAccess');
}
onBroadcast('pageAccess', () => { cache = null; });

export async function savedAccess() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = new Map<string, boolean>();
  for (const r of await q(`SELECT role_name, page_key, allowed FROM RolePageAccess`)) rows.set(`${r.role_name}|${r.page_key}`, !!r.allowed);
  cache = { at: Date.now(), rows };
  return rows;
}

/** Whether a role may be given the page at all */
export const configurable = (p: PageDef, role: Role) => !p.always && !p.rootOnly && !p.lockedFor?.includes(role) && (!p.floor || ROLE_ID[role] >= ROLE_ID[p.floor]);

export function isAllowed(p: PageDef, role: Role, saved: Map<string, boolean>) {
  if (role === 'root') return true;
  if (p.rootOnly) return false;
  if (p.always || p.lockedFor?.includes(role)) return true;
  if (p.floor && ROLE_ID[role] < ROLE_ID[p.floor]) return false;
  return saved.get(`${role}|${p.key}`) ?? p.defaults.includes(role);
}

/** Names of the left-bar items as renamed by an admin / root (SystemSettings pageLabels = {key: label}); missing = the built-in name */
let labelCache: { at: number; v: Record<string, string> } | null = null;
export async function pageLabels(): Promise<Record<string, string>> {
  if (labelCache && Date.now() - labelCache.at < CACHE_MS) return labelCache.v;
  const r = await q(`SELECT setting_value FROM SystemSettings WHERE setting_key = N'pageLabels'`);
  let v: Record<string, string> = {};
  try { const j = JSON.parse(r[0]?.setting_value ?? '{}'); if (j && typeof j === 'object') v = j; } catch { /* bad value → none */ }
  labelCache = { at: Date.now(), v };
  return v;
}
onBroadcast('pageAccess', () => { labelCache = null; });

/** Order of the left-bar items set by an admin / root (SystemSettings pageOrder = [keys]); missing keys keep the built-in order after them */
let orderCache: { at: number; v: string[] } | null = null;
export async function pageOrder(): Promise<string[]> {
  if (orderCache && Date.now() - orderCache.at < CACHE_MS) return orderCache.v;
  const r = await q(`SELECT setting_value FROM SystemSettings WHERE setting_key = N'pageOrder'`);
  let v: string[] = [];
  try { const j = JSON.parse(r[0]?.setting_value ?? '[]'); if (Array.isArray(j)) v = j.map(String); } catch { /* bad value → none */ }
  orderCache = { at: Date.now(), v };
  return v;
}
onBroadcast('pageAccess', () => { orderCache = null; });

/** Keys of the pages / features a role sees */
export async function pagesFor(role: Role): Promise<string[]> {
  const saved = await savedAccess();
  return PAGES.filter((p) => isAllowed(p, role, saved)).map((p) => p.key);
}

/** Server side of a page whose access a root sets: same rule as the left bar */
export const requirePage =
  (key: string): RequestHandler =>
  (req, _res, next) => {
    const p = PAGES.find((x) => x.key === key);
    if (!req.user || !p) return next(forbidden());
    savedAccess()
      .then((saved) => (isAllowed(p, req.user!.role, saved) ? next() : next(forbidden(`บทบาทของคุณยังไม่ได้รับสิทธิ์ใช้ "${p.label}" (Admin / Root กำหนดได้ที่หน้า จัดการสิทธิ์)`))))
      .catch(next);
  };
