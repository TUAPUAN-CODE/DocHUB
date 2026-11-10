"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clusterEnabled = exports.NODE_ID = void 0;
exports.attachCluster = attachCluster;
exports.broadcast = broadcast;
exports.onBroadcast = onBroadcast;
const ioredis_1 = __importDefault(require("ioredis"));
const redis_adapter_1 = require("@socket.io/redis-adapter");
const logger_1 = require("../shared/logger");
/**
 * Running more than one server behind a load balancer: Redis (optional) carries
 *  - Socket.IO events between the servers (a person on server A sees what a person on server B edits), and
 *  - "forget this cached value" messages (folders, users, row totals), so a change made on one server is seen on the other at once.
 * REDIS_URL empty = a single server, nothing changes.
 */
exports.NODE_ID = process.env.NODE_ID || `${process.env.COMPUTERNAME || process.env.HOSTNAME || 'node'}-${process.pid}`;
const URL = process.env.REDIS_URL ?? '';
exports.clusterEnabled = !!URL;
const CHANNEL = 'dochub:broadcast';
const handlers = new Map();
let pub = null;
const connect = () => {
    const r = new ioredis_1.default(URL, { maxRetriesPerRequest: null, enableOfflineQueue: true, retryStrategy: (n) => Math.min(2000, n * 200) });
    r.on('error', (e) => logger_1.logger.warn(`Redis: ${e.message}`)); // a Redis outage must never take the site down: servers just stop hearing each other
    return r;
};
function attachCluster(io) {
    if (!exports.clusterEnabled)
        return;
    pub = connect();
    const sub = pub.duplicate();
    sub.on('error', (e) => logger_1.logger.warn(`Redis (sub): ${e.message}`));
    io.adapter((0, redis_adapter_1.createAdapter)(pub, sub));
    const bc = pub.duplicate();
    bc.on('error', (e) => logger_1.logger.warn(`Redis (broadcast): ${e.message}`));
    void bc.subscribe(CHANNEL);
    bc.on('message', (_ch, raw) => {
        try {
            const m = JSON.parse(raw);
            if (m.from === exports.NODE_ID)
                return;
            for (const h of handlers.get(m.kind) ?? [])
                h(m.payload);
        }
        catch { /* not ours */ }
    });
    logger_1.logger.info(`Cluster on (node ${exports.NODE_ID}, Redis ${URL.replace(/\/\/[^@]*@/, '//***@')})`);
}
/** Tell the OTHER servers something (they never get it back to themselves) */
function broadcast(kind, payload = '') {
    if (!pub)
        return;
    void pub.publish(CHANNEL, JSON.stringify({ from: exports.NODE_ID, kind, payload })).catch(() => undefined);
}
function onBroadcast(kind, handler) {
    handlers.set(kind, [...(handlers.get(kind) ?? []), handler]);
}
//# sourceMappingURL=cluster.js.map