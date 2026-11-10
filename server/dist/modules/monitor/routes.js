"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const os_1 = __importDefault(require("os"));
const express_1 = require("express");
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const auth_1 = require("../../middleware/auth");
const http_1 = require("../../shared/http");
const logger_1 = require("../../shared/logger");
const socket_1 = require("../../socket");
const traffic_1 = require("./traffic");
/** Admin "Monitor": how many requests come in, through the Cloudflare tunnel or the LAN */
const router = (0, express_1.Router)();
const TZ = 'Asia/Bangkok';
const dayOf = (d) => d.toLocaleDateString('sv-SE', { timeZone: TZ }); // YYYY-MM-DD in Thai time
const zero = () => ({ cloudflare: 0, lan: 0, errors: 0, slow: 0, bytes: 0 });
/* ---------- Cloudflare's own numbers (optional: CF_API_TOKEN with "Zone Analytics: Read" + CF_ZONE_ID) ---------- */
let cfCache = null;
async function cloudflareDays() {
    if (!env_1.env.cloudflare.apiToken || !env_1.env.cloudflare.zoneId)
        return { configured: false };
    if (cfCache && Date.now() - cfCache.at < 5 * 60_000)
        return cfCache.data;
    const until = new Date();
    const since = new Date(Date.now() - 29 * 86400_000);
    const query = `query($zone: String!, $since: Date!, $until: Date!) { viewer { zones(filter: { zoneTag: $zone }) {
    httpRequests1dGroups(limit: 31, filter: { date_geq: $since, date_leq: $until }, orderBy: [date_ASC]) {
      dimensions { date } sum { requests cachedRequests bytes threats } uniq { uniques } } } } }`;
    let data;
    try {
        const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: { authorization: `Bearer ${env_1.env.cloudflare.apiToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({ query, variables: { zone: env_1.env.cloudflare.zoneId, since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) } }),
            signal: AbortSignal.timeout(10_000),
        });
        const j = await r.json();
        if (j.errors?.length)
            throw new Error(j.errors.map((e) => e.message).join('; '));
        const days = (j.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? []).map((g) => ({
            date: g.dimensions.date, requests: g.sum.requests, cachedRequests: g.sum.cachedRequests, bytes: g.sum.bytes, threats: g.sum.threats, visitors: g.uniq?.uniques ?? null,
        }));
        data = { configured: true, days };
    }
    catch (e) {
        logger_1.logger.warn(`cloudflare analytics: ${e?.message}`);
        data = { configured: true, error: `อ่านข้อมูลจาก Cloudflare ไม่ได้: ${String(e?.message ?? e).slice(0, 200)}` };
    }
    cfCache = { at: Date.now(), data };
    return data;
}
router.get('/monitor/traffic', (0, auth_1.requireRole)('admin'), (0, http_1.ah)(async (_req, res) => {
    const rows = await (0, db_1.q)(`SELECT hour_start, source, requests, errors, slow, bytes FROM TrafficHourly WHERE hour_start >= DATEADD(day, -400, SYSUTCDATETIME()) ORDER BY hour_start`);
    const all = [
        ...rows.map((r) => ({ hour: new Date(`${new Date(r.hour_start).toISOString().slice(0, 19)}Z`), source: r.source, requests: r.requests, errors: r.errors, slow: r.slow, bytes: Number(r.bytes) })),
        ...(0, traffic_1.unflushed)().map((u) => ({ ...u, hour: new Date(u.hour) })),
    ];
    const days = new Map();
    const hours = new Map();
    for (const r of all) {
        const d = dayOf(r.hour);
        for (const [m, k] of [[days, d], [hours, r.hour.getTime()]]) {
            if (!m.has(k))
                m.set(k, zero());
            const s = m.get(k);
            s[r.source === 'cloudflare' ? 'cloudflare' : 'lan'] += r.requests;
            s.errors += r.errors;
            s.slow += r.slow;
            s.bytes += r.bytes;
        }
    }
    const today = dayOf(new Date());
    const month = today.slice(0, 7);
    const months = new Map();
    for (const [d, s] of days) {
        const m = d.slice(0, 7);
        if (!months.has(m))
            months.set(m, zero());
        const t = months.get(m);
        t.cloudflare += s.cloudflare;
        t.lan += s.lan;
        t.errors += s.errors;
        t.slow += s.slow;
        t.bytes += s.bytes;
    }
    const last31 = [...Array(31)].map((_, i) => dayOf(new Date(Date.now() - (30 - i) * 86400_000)));
    const minutes = (0, traffic_1.minuteSeries)(60);
    const peak = minutes.reduce((p, m) => (m.cloudflare + m.lan > p.requests ? { requests: m.cloudflare + m.lan, at: m.t } : p), { requests: 0, at: null });
    const h0 = new Date();
    h0.setUTCMinutes(0, 0, 0);
    (0, http_1.ok)(res, {
        now: new Date(),
        server: {
            startedAt: traffic_1.startedAt, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576),
            load: os_1.default.loadavg()[0], cpus: os_1.default.cpus().length, sockets: (0, socket_1.onlineSockets)(),
        },
        today: { day: today, ...(days.get(today) ?? zero()) },
        month: { month, ...(months.get(month) ?? zero()) },
        minutes,
        peakMinute: peak,
        hours: [...Array(48)].map((_, i) => { const t = h0.getTime() - (47 - i) * 3600_000; return { hour: new Date(t), ...(hours.get(t) ?? zero()) }; }),
        days: last31.map((d) => ({ day: d, ...(days.get(d) ?? zero()) })),
        months: [...months].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([m, s]) => ({ month: m, ...s })),
        topPaths: (0, traffic_1.topPaths)(12),
        cloudflare: await cloudflareDays(),
    });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map