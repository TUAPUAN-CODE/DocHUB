"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.msExchangeCode = exports.msRedirect = exports.msConfigured = exports.NeedsAuth = void 0;
exports.msAuthorizeUrl = msAuthorizeUrl;
exports.fetchSource = fetchSource;
exports.loadRecords = loadRecords;
const env_1 = require("../../config/env");
const secret_1 = require("./secret");
const safeFetch_1 = require("./safeFetch");
const parse_1 = require("./parse");
/** Thrown when the source says "who are you?" so the UI can ask for credentials / start the Microsoft sign-in */
class NeedsAuth extends Error {
    constructor(kind, msg) {
        super(msg);
        this.kind = kind;
    }
}
exports.NeedsAuth = NeedsAuth;
const FORBIDDEN_HEADERS = /^(host|content-length|connection|transfer-encoding|cookie)$/i;
const msConfigured = () => !!(env_1.env.oauth.microsoft.clientId && env_1.env.oauth.microsoft.clientSecret);
exports.msConfigured = msConfigured;
const msRedirect = (base) => `${base}/api/connectors/ms/callback`;
exports.msRedirect = msRedirect;
const MS_SCOPE = 'offline_access Files.Read.All Sites.Read.All';
function msAuthorizeUrl(base, state) {
    const t = encodeURIComponent(env_1.env.oauth.microsoft.tenant);
    return `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize?` + new URLSearchParams({
        client_id: env_1.env.oauth.microsoft.clientId, response_type: 'code', redirect_uri: (0, exports.msRedirect)(base), response_mode: 'query', scope: MS_SCOPE, state, prompt: 'select_account',
    });
}
async function msToken(params) {
    const t = encodeURIComponent(env_1.env.oauth.microsoft.tenant);
    const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env_1.env.oauth.microsoft.clientId, client_secret: env_1.env.oauth.microsoft.clientSecret, scope: MS_SCOPE, ...params }), signal: AbortSignal.timeout(30_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
        throw new Error(j.error_description || j.error || `Microsoft ${r.status}`);
    return j;
}
const msExchangeCode = (base, code) => msToken({ grant_type: 'authorization_code', code, redirect_uri: (0, exports.msRedirect)(base) });
exports.msExchangeCode = msExchangeCode;
/** Returns the bytes of the source. `saveSecret` is called when a refreshed Microsoft token must be stored. */
async function fetchSource(kind, cfg, secretEnc, saveSecret) {
    const secret = (0, secret_1.decryptJson)(secretEnc);
    const headers = {};
    for (const [k, v] of Object.entries(cfg.headers ?? {}))
        if (k && !FORBIDDEN_HEADERS.test(k))
            headers[k] = String(v);
    let url = cfg.url;
    if (kind === 'sharepoint') {
        if (!(0, exports.msConfigured)())
            throw new Error('ยังไม่ได้ตั้งค่า MS_CLIENT_ID / MS_CLIENT_SECRET ในเซิร์ฟเวอร์ (ดู docs/CONNECTORS.md)');
        if (!secret?.msRefresh)
            throw new NeedsAuth('sharepoint', 'ต้องเข้าสู่ระบบ Microsoft ที่มีสิทธิ์เข้าถึงไฟล์นี้ก่อน');
        let tok;
        try {
            tok = await msToken({ grant_type: 'refresh_token', refresh_token: secret.msRefresh });
        }
        catch {
            throw new NeedsAuth('sharepoint', 'การเข้าสู่ระบบ Microsoft หมดอายุ กรุณาเข้าสู่ระบบใหม่');
        }
        if (tok.refresh_token && saveSecret)
            await saveSecret((0, secret_1.encryptJson)({ ...secret, msRefresh: tok.refresh_token }));
        const share = 'u!' + Buffer.from(cfg.url).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
        url = `https://graph.microsoft.com/v1.0/shares/${share}/driveItem/content`;
        headers.Authorization = `Bearer ${tok.access_token}`;
    }
    else if (secret) {
        if (secret.type === 'basic')
            headers.Authorization = 'Basic ' + Buffer.from(`${secret.username ?? ''}:${secret.password ?? ''}`).toString('base64');
        else if (secret.type === 'bearer')
            headers.Authorization = `Bearer ${secret.token ?? ''}`;
        else if (secret.type === 'header' && secret.headerName && !FORBIDDEN_HEADERS.test(secret.headerName))
            headers[secret.headerName] = secret.token ?? '';
    }
    const r = await (0, safeFetch_1.safeFetch)(url, { method: cfg.method ?? 'GET', headers, body: cfg.method === 'POST' ? cfg.body : undefined });
    const ct = r.headers.get('content-type') ?? '';
    if (r.status === 401 || r.status === 403)
        throw new NeedsAuth(kind, kind === 'sharepoint' ? 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงไฟล์ — เข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์' : 'ลิงก์นี้ต้องเข้าสู่ระบบ — กรอกชื่อผู้ใช้/รหัสผ่านหรือโทเคนที่มีสิทธิ์');
    if (r.status >= 400)
        throw new Error(`ต้นทางตอบกลับ HTTP ${r.status}`);
    // a login page where data was expected
    if (/text\/html/i.test(ct))
        throw new NeedsAuth(kind, 'ต้นทางส่งหน้าเว็บ (อาจเป็นหน้าเข้าสู่ระบบ) แทนข้อมูล');
    return { body: r.body, contentType: ct, finalUrl: r.finalUrl };
}
async function loadRecords(kind, cfg, secretEnc, saveSecret) {
    const f = await fetchSource(kind, cfg, secretEnc, saveSecret);
    return (0, parse_1.parseRecords)(f.body, cfg, f.contentType, f.finalUrl);
}
//# sourceMappingURL=source.js.map