"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptJson = encryptJson;
exports.decryptJson = decryptJson;
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../../config/env");
/**
 * Encrypts what the browser must never read back (API passwords, tokens, AI keys).
 * Key: SECRETS_KEY from the environment (recommended, 32+ chars) — falls back to JWT_SECRET so it works out of the box.
 */
const key = () => crypto_1.default.scryptSync(process.env.SECRETS_KEY || env_1.env.jwt.secret, 'datasheet-secrets-v1', 32);
function encryptJson(v) {
    const iv = crypto_1.default.randomBytes(12);
    const c = crypto_1.default.createCipheriv('aes-256-gcm', key(), iv);
    const enc = Buffer.concat([c.update(JSON.stringify(v), 'utf8'), c.final()]);
    return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
function decryptJson(s) {
    if (!s)
        return null;
    try {
        const [v, iv, tag, data] = s.split('.');
        if (v !== 'v1')
            return null;
        const d = crypto_1.default.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
        d.setAuthTag(Buffer.from(tag, 'base64'));
        return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=secret.js.map