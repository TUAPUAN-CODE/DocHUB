"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leaderTasks = void 0;
exports.leaderTask = leaderTask;
exports.releaseLeases = releaseLeases;
const db_1 = require("../config/db");
const logger_1 = require("../shared/logger");
const cluster_1 = require("./cluster");
/**
 * Jobs that must run on ONE server only (the LINE alert worker, the RFID gateway — a reader accepts a single connection —,
 * clean-ups). Every server asks for the lease of a job; the one that holds it runs the job, and when it stops or dies
 * (lease not renewed for LEASE_SEC) another server takes over by itself. The lease lives in SQL Server (table ServiceLeases).
 */
const LEASE_SEC = 30;
const RENEW_MS = 10_000;
async function holdLease(name) {
    const rows = await (0, db_1.q)(`UPDATE ServiceLeases SET holder = @h, expires_at = DATEADD(SECOND, @ttl, SYSUTCDATETIME())
       WHERE name = @n AND (holder = @h OR expires_at < SYSUTCDATETIME());
     IF @@ROWCOUNT = 0 AND NOT EXISTS (SELECT 1 FROM ServiceLeases WHERE name = @n)
       BEGIN TRY INSERT INTO ServiceLeases (name, holder, expires_at) VALUES (@n, @h, DATEADD(SECOND, @ttl, SYSUTCDATETIME())); END TRY BEGIN CATCH END CATCH
     SELECT holder FROM ServiceLeases WHERE name = @n`, { n: db_1.T.text(name), h: db_1.T.text(cluster_1.NODE_ID), ttl: db_1.T.int(LEASE_SEC) });
    return rows[0]?.holder === cluster_1.NODE_ID;
}
const running = new Map();
/** `start` returns the function that stops the job (called when this server loses the lease or shuts down) */
function leaderTask(name, start) {
    const tick = async () => {
        let mine = false;
        try {
            mine = await holdLease(name);
        }
        catch (e) {
            logger_1.logger.warn(`lease ${name}: ${e.message}`);
            mine = running.has(name); /* DB hiccup: keep running, retry */
        }
        const on = running.get(name);
        if (mine && !on) {
            logger_1.logger.info(`▶ ${name}: this server (${cluster_1.NODE_ID}) runs it`);
            const stop = start();
            running.set(name, { stop: typeof stop === 'function' ? stop : () => undefined });
        }
        else if (!mine && on) {
            logger_1.logger.info(`■ ${name}: another server took over`);
            on.stop();
            running.delete(name);
        }
    };
    void tick();
    setInterval(() => void tick(), RENEW_MS).unref();
}
/** Who runs what (for /api/health and the admin) */
const leaderTasks = () => [...running.keys()];
exports.leaderTasks = leaderTasks;
async function releaseLeases() {
    for (const [name, t] of running) {
        t.stop();
        await (0, db_1.q)(`UPDATE ServiceLeases SET expires_at = SYSUTCDATETIME() WHERE name = @n AND holder = @h`, { n: db_1.T.text(name), h: db_1.T.text(cluster_1.NODE_ID) }).catch(() => undefined);
    }
    running.clear();
}
//# sourceMappingURL=leader.js.map