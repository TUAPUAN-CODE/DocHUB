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
  cache = null;
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
export const configurable = (p: PageDef, role: Role) => !p.always && !p.rootOnly && (!p.floor || ROLE_ID[role] >= ROLE_ID[p.floor]);

export function isAllowed(p: PageDef, role: Role, saved: Map<string, boolean>) {
  if (role === 'root') return true;
  if (p.rootOnly) return false;
  if (p.always) return true;
  if (p.floor && ROLE_ID[role] < ROLE_ID[p.floor]) return false;
  return saved.get(`${role}|${p.key}`) ?? p.defaults.includes(role);
}

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
      .then((saved) => (isAllowed(p, req.user!.role, saved) ? next() : next(forbidden(`บทบาทของคุณยังไม่ได้รับสิทธิ์ใช้ "${p.label}" (ผู้ใช้ Root กำหนดได้ที่หน้า จัดการสิทธิ์)`))))
      .catch(next);
  };
