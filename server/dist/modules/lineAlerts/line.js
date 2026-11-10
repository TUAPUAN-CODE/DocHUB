"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.replyText = exports.pushText = void 0;
exports.validSignature = validSignature;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("./config");
const API = 'https://api.line.me/v2/bot/message';
async function call(path, body) {
    const res = await fetch(`${API}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config_1.lineConfig.accessToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
        throw new Error(`LINE ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}
const pushText = (to, text) => call('push', { to, messages: [{ type: 'text', text }] });
exports.pushText = pushText;
const replyText = (replyToken, text) => call('reply', { replyToken, messages: [{ type: 'text', text }] });
exports.replyText = replyText;
/** X-Line-Signature = base64(HMAC-SHA256(channel secret, raw body)) */
function validSignature(rawBody, signature) {
    if (!rawBody || !signature || !config_1.lineConfig.channelSecret)
        return false;
    const mac = crypto_1.default.createHmac('sha256', config_1.lineConfig.channelSecret).update(rawBody).digest();
    const given = Buffer.from(signature, 'base64');
    return given.length === mac.length && crypto_1.default.timingSafeEqual(given, mac);
}
//# sourceMappingURL=line.js.map