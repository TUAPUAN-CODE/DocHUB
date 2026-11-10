"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertAllowedUrl = assertAllowedUrl;
exports.safeFetch = safeFetch;
const promises_1 = __importDefault(require("dns/promises"));
const net_1 = __importDefault(require("net"));
/**
 * Server-side fetch for user-supplied URLs. Blocks the addresses that make SSRF dangerous (this machine itself,
 * link-local / cloud-metadata). LAN addresses (10.x / 172.16-31.x / 192.168.x) stay allowed because internal company
 * APIs are a normal source — set CONNECTOR_BLOCK_PRIVATE=true to forbid them as well.
 */
const blockPrivate = ['1', 'true', 'yes'].includes(String(process.env.CONNECTOR_BLOCK_PRIVATE ?? '').toLowerCase());
const MAX_BYTES = (Number(process.env.CONNECTOR_MAX_MB) || 50) * 1024 * 1024;
function badAddress(ip) {
    if (net_1.default.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        if (a === 127 || a === 0 || (a === 169 && b === 254) || a >= 224)
            return true;
        return blockPrivate && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
    }
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::' || l.startsWith('fe80') || l.startsWith('::ffff:'))
        return l.startsWith('::ffff:') ? badAddress(l.slice(7)) : true;
    return blockPrivate && (l.startsWith('fc') || l.startsWith('fd'));
}
async function assertAllowedUrl(raw) {
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        throw new Error('ลิงก์ไม่ถูกต้อง');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:')
        throw new Error('รองรับเฉพาะลิงก์ http / https');
    if (u.username || u.password)
        throw new Error('ห้ามใส่ชื่อผู้ใช้/รหัสผ่านในลิงก์ ให้กรอกในช่องข้อมูลเข้าสู่ระบบแทน');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host.toLowerCase() === 'localhost')
        throw new Error('ไม่อนุญาตให้เชื่อมต่อเครื่องนี้เอง');
    const addrs = net_1.default.isIP(host) ? [{ address: host }] : await promises_1.default.lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => badAddress(a.address)))
        throw new Error('ไม่อนุญาตให้เชื่อมต่อที่อยู่ปลายทางนี้');
    return u;
}
/** Follows up to 5 redirects, re-checking every hop; aborts after 60 s or MAX_BYTES */
async function safeFetch(url, init = {}) {
    let cur = url;
    for (let hop = 0; hop < 6; hop++) {
        const u = await assertAllowedUrl(cur);
        const r = await fetch(u, { method: init.method ?? 'GET', headers: init.headers, body: hop === 0 ? init.body : undefined, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
        if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
            cur = new URL(r.headers.get('location'), u).toString();
            // never forward credentials to another host
            if (new URL(cur).host !== u.host)
                init = { ...init, headers: Object.fromEntries(Object.entries(init.headers ?? {}).filter(([k]) => !/^(authorization|cookie|x-api-key)$/i.test(k))) };
            continue;
        }
        const chunks = [];
        let n = 0;
        if (r.body)
            for await (const c of r.body) {
                n += c.length;
                if (n > MAX_BYTES)
                    throw new Error(`ข้อมูลใหญ่เกิน ${Math.round(MAX_BYTES / 1048576)} MB`);
                chunks.push(Buffer.from(c));
            }
        return { status: r.status, headers: r.headers, body: Buffer.concat(chunks), finalUrl: cur };
    }
    throw new Error('ลิงก์เปลี่ยนเส้นทางมากเกินไป');
}
//# sourceMappingURL=safeFetch.js.map