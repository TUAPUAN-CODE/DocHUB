"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRead = exports.idList = exports.jsonParam = exports.T = void 0;
exports.dbConfig = dbConfig;
exports.getPool = getPool;
exports.closePool = closePool;
exports.isTransient = isTransient;
exports.q = q;
exports.q1 = q1;
exports.qm = qm;
exports.withTx = withTx;
const mssql_1 = __importDefault(require("mssql"));
const env_1 = require("./env");
const logger_1 = require("../shared/logger");
let poolPromise = null;
function dbConfig(database = env_1.env.db.database, poolMax = env_1.env.db.poolMax) {
    return {
        server: env_1.env.db.server,
        port: env_1.env.db.instanceName ? undefined : env_1.env.db.port,
        database,
        user: env_1.env.db.user,
        password: env_1.env.db.password,
        options: {
            encrypt: env_1.env.db.encrypt,
            trustServerCertificate: env_1.env.db.trustServerCertificate,
            enableArithAbort: true,
            instanceName: env_1.env.db.instanceName,
            multiSubnetFailover: env_1.env.db.multiSubnetFailover,
        },
        pool: { min: Math.min(env_1.env.db.poolMin, poolMax), max: poolMax, idleTimeoutMillis: 30_000 },
        requestTimeout: 120_000,
        connectionTimeout: 30_000,
    };
}
function getPool() {
    if (poolPromise)
        return poolPromise;
    const pool = new mssql_1.default.ConnectionPool(dbConfig());
    // a failover (Always On) or a restart of SQL Server breaks the open connections: forget the pool, the next request builds a new one
    pool.on('error', (err) => {
        logger_1.logger.warn(`SQL pool error: ${err.message} — reconnecting`);
        if (poolPromise === p)
            poolPromise = null;
        void pool.close().catch(() => undefined);
    });
    const p = pool
        .connect()
        .catch((err) => {
        if (poolPromise === p)
            poolPromise = null;
        throw err;
    });
    poolPromise = p;
    return p;
}
async function closePool() {
    if (poolPromise) {
        const p = await poolPromise;
        await p.close();
        poolPromise = null;
    }
}
const typed = (type, value) => ({ __typed: true, type, value });
exports.T = {
    uuid: (v) => typed(mssql_1.default.UniqueIdentifier, v ?? null),
    dt: (v) => typed(mssql_1.default.DateTime2, v == null || v === '' ? null : new Date(v)),
    text: (v) => typed(mssql_1.default.NVarChar(mssql_1.default.MAX), v ?? null),
    bigint: (v) => typed(mssql_1.default.BigInt, v ?? null),
    int: (v) => typed(mssql_1.default.Int, v ?? null),
    float: (v) => typed(mssql_1.default.Float, v ?? null),
    bit: (v) => typed(mssql_1.default.Bit, v ?? null),
};
/** JSON array parameter for `IN (SELECT ... FROM OPENJSON(@p))` */
const jsonParam = (arr) => exports.T.text(JSON.stringify(arr));
exports.jsonParam = jsonParam;
/** SQL fragment that turns a JSON-array parameter into a set of uniqueidentifiers */
const idList = (param) => `(SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(${param}))`;
exports.idList = idList;
function bind(req, params) {
    for (const [name, v] of Object.entries(params)) {
        if (v && typeof v === 'object' && v.__typed) {
            const t = v;
            req.input(name, t.type, t.value);
        }
        else if (v === undefined || v === null)
            req.input(name, mssql_1.default.NVarChar(mssql_1.default.MAX), null);
        else if (v instanceof Date)
            req.input(name, mssql_1.default.DateTime2, v);
        else if (typeof v === 'boolean')
            req.input(name, mssql_1.default.Bit, v);
        else if (typeof v === 'number')
            req.input(name, Number.isInteger(v) ? mssql_1.default.BigInt : mssql_1.default.Float, v);
        else
            req.input(name, mssql_1.default.NVarChar(mssql_1.default.MAX), String(v));
    }
}
/* SQL Server returns GUIDs in upper case; the API always uses lower case. */
const GUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const ID_NAME_RE = /(^id$|_id$|_by$)/i;
function normalize(rs) {
    if (!rs)
        return [];
    const meta = rs.columns ?? {};
    const cols = Object.values(meta)
        .filter((c) => c.type === mssql_1.default.UniqueIdentifier || ID_NAME_RE.test(c.name))
        .map((c) => c.name);
    if (cols.length) {
        for (const row of rs) {
            for (const c of cols) {
                const v = row[c];
                if (typeof v === 'string' && GUID_RE.test(v))
                    row[c] = v.toLowerCase();
            }
        }
    }
    return rs;
}
async function request(tx) {
    return tx ? new mssql_1.default.Request(tx) : (await getPool()).request();
}
/** Connection-level failures seen during an Always On failover / SQL Server restart */
const NOT_EXECUTED = new Set([983, 4060, 40613, 40197, 40501, 10928, 10929, 18456]); // the statement never ran
function isTransient(err) {
    const code = String(err?.code ?? '');
    const no = Number(err?.number ?? err?.originalError?.info?.number ?? 0);
    return ['ECONNCLOSED', 'ESOCKET', 'ECONNRESET', 'ELOGIN', 'ENOTOPEN', 'EINVALIDSTATE'].includes(code) || NOT_EXECUTED.has(no);
}
const notExecuted = (err) => NOT_EXECUTED.has(Number(err?.number ?? err?.originalError?.info?.number ?? 0)) || ['ELOGIN', 'ENOTOPEN'].includes(String(err?.code ?? ''));
const isRead = (text) => /^\s*(WITH|SELECT)\b/i.test(text);
exports.isRead = isRead;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function resetPool() {
    const p = poolPromise;
    poolPromise = null;
    try {
        (await p)?.close();
    }
    catch { /* already gone */ }
}
async function q(text, params = {}, tx) {
    // outside a transaction a broken connection is retried (a few seconds is how long a failover takes); a WRITE is only retried when it certainly did not run
    for (let attempt = 0;; attempt++) {
        try {
            const req = await request(tx);
            bind(req, params);
            const res = await req.query(text);
            return normalize(res.recordset);
        }
        catch (err) {
            if (tx || attempt >= 3 || !isTransient(err) || !((0, exports.isRead)(text) || notExecuted(err)))
                throw err;
            logger_1.logger.warn(`SQL transient error (${err?.code ?? err?.number}) — retry ${attempt + 1}/3`);
            await resetPool();
            await sleep(800 * (attempt + 1));
        }
    }
}
async function q1(text, params = {}, tx) {
    const rows = await q(text, params, tx);
    return rows[0] ?? null;
}
/** Runs a batch and returns every recordset */
async function qm(text, params = {}, tx) {
    const req = await request(tx);
    bind(req, params);
    const res = await req.query(text);
    const sets = res.recordsets ?? [];
    return sets.map((s) => normalize(s));
}
/** Runs fn inside a transaction. Requests inside must be awaited sequentially. */
async function withTx(fn) {
    let pool = await getPool();
    let tx = new mssql_1.default.Transaction(pool);
    try {
        await tx.begin(mssql_1.default.ISOLATION_LEVEL.READ_COMMITTED);
    }
    catch (err) {
        if (!isTransient(err))
            throw err; // beginning failed = nothing ran yet: safe to try once more on a fresh pool
        await resetPool();
        await sleep(1000);
        pool = await getPool();
        tx = new mssql_1.default.Transaction(pool);
        await tx.begin(mssql_1.default.ISOLATION_LEVEL.READ_COMMITTED);
    }
    try {
        const result = await fn(tx);
        await tx.commit();
        return result;
    }
    catch (err) {
        try {
            await tx.rollback();
        }
        catch {
            /* already rolled back */
        }
        throw err;
    }
}
//# sourceMappingURL=db.js.map