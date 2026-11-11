import { broadcast, onBroadcast } from '../services/cluster';
import jwt from 'jsonwebtoken';
import { RequestHandler } from 'express';
import { env } from '../config/env';
import { q1 } from '../config/db';
import { AppError, forbidden } from '../shared/http';

/**
 * viewer = read only · user = data entry (cannot change structure) · master = builds forms/folders · admin = everything ·
 * root = everything an admin can do + decides which pages of the left bar each role sees (modules/pageAccess)
 */
export type Role = 'viewer' | 'user' | 'master' | 'admin' | 'root';
export const ROLES: Role[] = ['viewer', 'user', 'master', 'admin', 'root'];
export const ROLE_ID: Record<Role, number> = { viewer: 0, user: 1, master: 2, admin: 3, root: 4 };
/** Roles an admin may give (root is given by a root only) */
export const ADMIN_GRANTABLE: Role[] = ['viewer', 'user', 'master', 'admin'];
/** Roles without any builder / manager privileges */
export const isBasicRole = (r: Role) => r === 'user' || r === 'viewer';
/** admin or root: everything in the system (role_id >= 3 in SQL) */
export const isAdminRole = (r: Role | string | null | undefined) => r === 'admin' || r === 'root';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Highest role of a user (alias u = Users) */
export const ROLE_SQL = `(SELECT TOP 1 r.role_name FROM UserRoles ur JOIN Roles r ON r.role_id = ur.role_id
  WHERE ur.user_id = u.user_id ORDER BY r.role_id DESC)`;

const cache = new Map<string, { at: number; user: AuthUser | null }>();
const CACHE_MS = 30_000;

export function invalidateUserCache(id?: string) {
  if (id) cache.delete(id.toLowerCase());
  else cache.clear();
  broadcast('user', id ?? '');
}
onBroadcast('user', (id) => { if (id) cache.delete(id.toLowerCase()); else cache.clear(); });

export async function loadAuthUser(id: string): Promise<AuthUser | null> {
  const key = id.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
  const row = await q1(
    `SELECT u.user_id, u.username, u.display_name, u.avatar_url, u.is_active, ${ROLE_SQL} AS role
     FROM Users u WHERE u.user_id = @id`,
    { id: key },
  );
  const user: AuthUser | null =
    row && row.is_active
      ? {
          id: row.user_id,
          username: row.username,
          displayName: row.display_name,
          avatarUrl: row.avatar_url,
          role: (row.role ?? 'user') as Role,
        }
      : null;
  cache.set(key, { at: Date.now(), user });
  return user;
}

export function signAccessToken(u: AuthUser) {
  return jwt.sign({ sub: u.id, username: u.username, role: u.role }, env.jwt.secret, {
    expiresIn: env.jwt.accessTtl as any,
  });
}

export function verifyAccessToken(token: string): { sub: string } {
  return jwt.verify(token, env.jwt.secret) as { sub: string };
}

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new AppError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ'));
  let payload: { sub: string };
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch (e: any) {
    const code = e?.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED';
    return next(new AppError(401, code, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'));
  }
  loadAuthUser(payload.sub)
    .then((user) => {
      if (!user) return next(new AppError(401, 'INACTIVE', 'บัญชีนี้ไม่สามารถใช้งานได้'));
      req.user = user;
      next();
    })
    .catch(next);
};

/** root passes every role check (it is above admin) */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !(roles.includes(req.user.role) || req.user.role === 'root')) return next(forbidden());
    next();
  };

export const isAtLeast = (u: AuthUser, role: Role) => ROLE_ID[u.role] >= ROLE_ID[role];
