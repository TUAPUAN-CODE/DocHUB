"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePage = exports.configurable = void 0;
exports.invalidatePageAccess = invalidatePageAccess;
exports.savedAccess = savedAccess;
exports.isAllowed = isAllowed;
exports.pagesFor = pagesFor;
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const cluster_1 = require("../../services/cluster");
const http_1 = require("../../shared/http");
const registry_1 = require("./registry");
/** role|page → allowed, as saved by a root (missing = the page's default) */
let cache = null;
const CACHE_MS = 30_000;
function invalidatePageAccess() {
    cache = null;
    (0, cluster_1.broadcast)('pageAccess');
}
(0, cluster_1.onBroadcast)('pageAccess', () => { cache = null; });
async function savedAccess() {
    if (cache && Date.now() - cache.at < CACHE_MS)
        return cache.rows;
    const rows = new Map();
    for (const r of await (0, db_1.q)(`SELECT role_name, page_key, allowed FROM RolePageAccess`))
        rows.set(`${r.role_name}|${r.page_key}`, !!r.allowed);
    cache = { at: Date.now(), rows };
    return rows;
}
/** Whether a role may be given the page at all */
const configurable = (p, role) => !p.always && !p.rootOnly && (!p.floor || auth_1.ROLE_ID[role] >= auth_1.ROLE_ID[p.floor]);
exports.configurable = configurable;
function isAllowed(p, role, saved) {
    if (role === 'root')
        return true;
    if (p.rootOnly)
        return false;
    if (p.always)
        return true;
    if (p.floor && auth_1.ROLE_ID[role] < auth_1.ROLE_ID[p.floor])
        return false;
    return saved.get(`${role}|${p.key}`) ?? p.defaults.includes(role);
}
/** Keys of the pages / features a role sees */
async function pagesFor(role) {
    const saved = await savedAccess();
    return registry_1.PAGES.filter((p) => isAllowed(p, role, saved)).map((p) => p.key);
}
/** Server side of a page whose access a root sets: same rule as the left bar */
const requirePage = (key) => (req, _res, next) => {
    const p = registry_1.PAGES.find((x) => x.key === key);
    if (!req.user || !p)
        return next((0, http_1.forbidden)());
    savedAccess()
        .then((saved) => (isAllowed(p, req.user.role, saved) ? next() : next((0, http_1.forbidden)(`บทบาทของคุณยังไม่ได้รับสิทธิ์ใช้ "${p.label}" (ผู้ใช้ Root กำหนดได้ที่หน้า จัดการสิทธิ์)`))))
        .catch(next);
};
exports.requirePage = requirePage;
//# sourceMappingURL=service.js.map