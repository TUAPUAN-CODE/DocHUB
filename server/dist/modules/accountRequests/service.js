"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signSignupToken = void 0;
exports.readSignupToken = readSignupToken;
exports.pendingForIdentity = pendingForIdentity;
exports.uniqueUsername = uniqueUsername;
exports.notifyAdmins = notifyAdmins;
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const notify_1 = require("../../shared/notify");
const signSignupToken = (v) => jsonwebtoken_1.default.sign({ ...v, purpose: 'signup' }, env_1.env.jwt.secret, { expiresIn: '30m' });
exports.signSignupToken = signSignupToken;
function readSignupToken(token) {
    try {
        const v = jsonwebtoken_1.default.verify(token, env_1.env.jwt.secret);
        return v.purpose === 'signup' && v.sub && v.email ? v : null;
    }
    catch {
        return null;
    }
}
async function pendingForIdentity(p, sub) {
    return (0, db_1.q1)(`SELECT request_id FROM AccountRequests WHERE status = 'pending' AND provider = @p AND provider_subject = @s`, { p, s: sub });
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 40) || 'user';
/** A free username made from `base` (e-mail local part) */
async function uniqueUsername(base) {
    const name = slug(base);
    for (let i = 0; i < 50; i++) {
        const candidate = i === 0 ? name : `${name}${i + 1}`;
        const taken = await (0, db_1.q1)(`SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM Users WHERE username = @u) OR EXISTS (SELECT 1 FROM AccountRequests WHERE status = 'pending' AND username = @u)`, { u: candidate });
        if (!taken)
            return candidate;
    }
    return `${name}${crypto_1.default.randomBytes(3).toString('hex')}`;
}
async function notifyAdmins(title, message) {
    const admins = await (0, db_1.q)(`SELECT u.user_id FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id AND ur.role_id >= 3 WHERE u.is_active = 1`);
    await (0, notify_1.notify)(admins.map((a) => a.user_id), { type: 'account_request', title, message, link: '/users/requests' });
}
//# sourceMappingURL=service.js.map