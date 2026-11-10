"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAtLeast = exports.requireRole = exports.authenticate = exports.ROLE_SQL = exports.isBasicRole = exports.ROLE_ID = exports.ROLES = void 0;
exports.invalidateUserCache = invalidateUserCache;
exports.loadAuthUser = loadAuthUser;
exports.signAccessToken = signAccessToken;
exports.verifyAccessToken = verifyAccessToken;
const cluster_1 = require("../services/cluster");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
exports.ROLES = ['viewer', 'user', 'master', 'admin'];
exports.ROLE_ID = { viewer: 0, user: 1, master: 2, admin: 3 };
/** Roles without any builder / manager privileges */
const isBasicRole = (r) => r === 'user' || r === 'viewer';
exports.isBasicRole = isBasicRole;
/** Highest role of a user (alias u = Users) */
exports.ROLE_SQL = `(SELECT TOP 1 r.role_name FROM UserRoles ur JOIN Roles r ON r.role_id = ur.role_id
  WHERE ur.user_id = u.user_id ORDER BY r.role_id DESC)`;
const cache = new Map();
const CACHE_MS = 30_000;
function invalidateUserCache(id) {
    if (id)
        cache.delete(id.toLowerCase());
    else
        cache.clear();
    (0, cluster_1.broadcast)('user', id ?? '');
}
(0, cluster_1.onBroadcast)('user', (id) => { if (id)
    cache.delete(id.toLowerCase());
else
    cache.clear(); });
async function loadAuthUser(id) {
    const key = id.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS)
        return hit.user;
    const row = await (0, db_1.q1)(`SELECT u.user_id, u.username, u.display_name, u.avatar_url, u.is_active, ${exports.ROLE_SQL} AS role
     FROM Users u WHERE u.user_id = @id`, { id: key });
    const user = row && row.is_active
        ? {
            id: row.user_id,
            username: row.username,
            displayName: row.display_name,
            avatarUrl: row.avatar_url,
            role: (row.role ?? 'user'),
        }
        : null;
    cache.set(key, { at: Date.now(), user });
    return user;
}
function signAccessToken(u) {
    return jsonwebtoken_1.default.sign({ sub: u.id, username: u.username, role: u.role }, env_1.env.jwt.secret, {
        expiresIn: env_1.env.jwt.accessTtl,
    });
}
function verifyAccessToken(token) {
    return jsonwebtoken_1.default.verify(token, env_1.env.jwt.secret);
}
const authenticate = (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
        return next(new http_1.AppError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ'));
    let payload;
    try {
        payload = verifyAccessToken(header.slice(7));
    }
    catch (e) {
        const code = e?.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED';
        return next(new http_1.AppError(401, code, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'));
    }
    loadAuthUser(payload.sub)
        .then((user) => {
        if (!user)
            return next(new http_1.AppError(401, 'INACTIVE', 'บัญชีนี้ไม่สามารถใช้งานได้'));
        req.user = user;
        next();
    })
        .catch(next);
};
exports.authenticate = authenticate;
const requireRole = (...roles) => (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role))
        return next((0, http_1.forbidden)());
    next();
};
exports.requireRole = requireRole;
const isAtLeast = (u, role) => exports.ROLE_ID[u.role] >= exports.ROLE_ID[role];
exports.isAtLeast = isAtLeast;
//# sourceMappingURL=auth.js.map