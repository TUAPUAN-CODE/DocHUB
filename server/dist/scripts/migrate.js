"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrations = applyMigrations;
exports.applySeeds = applySeeds;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mssql_1 = __importDefault(require("mssql"));
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const logger_1 = require("../shared/logger");
/**
 * Applies every database/NN_*.sql file with NN >= 02 (all idempotent), so an existing
 * database picks up new tables without a manual step. 01_schema.sql is handled by db:init.
 */
async function applyMigrations() {
    const dir = path_1.default.resolve(__dirname, '../../../database');
    if (!fs_1.default.existsSync(dir))
        return;
    const files = fs_1.default.readdirSync(dir).filter((f) => /^(0[2-9]|[1-9]\d)_.*\.sql$/.test(f)).sort();
    const pool = await (0, db_1.getPool)();
    // two servers starting together: one waits for the other (app lock held by the transaction), the scripts are idempotent
    const tx = new mssql_1.default.Transaction(pool);
    await tx.begin();
    try {
        await new mssql_1.default.Request(tx).query(`DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'dochub-migrate', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 120000; IF @r < 0 THROW 50000, N'migration lock timeout', 1;`);
        for (const f of files) {
            const batches = fs_1.default.readFileSync(path_1.default.join(dir, f), 'utf8').split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
            for (const b of batches)
                await new mssql_1.default.Request(tx).batch(b);
            logger_1.logger.info(`Migration applied: ${f}`);
        }
        await tx.commit();
    }
    catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
    }
}
/**
 * Data that ships with the repository: every database/seed/*.sql, run at start-up after the migrations, ONCE per database
 * (recorded in AppliedSeeds — data deleted later is not brought back; delete the AppliedSeeds row to run a seed again).
 * Each script also checks by itself whether its data is already there and ends with
 * `SELECT N'inserted' | N'skipped (…)' AS result`; "skipped (no user yet)" is not recorded, so it is tried at the next start.
 * Pictures in database/seed/files are copied into UPLOAD_DIR first. A seed that fails is rolled back and logged — the
 * server still starts.
 */
async function applySeeds() {
    const dir = path_1.default.resolve(__dirname, '../../../database/seed');
    if (!fs_1.default.existsSync(dir))
        return;
    try {
        const pics = path_1.default.join(dir, 'files');
        if (fs_1.default.existsSync(pics)) {
            const up = path_1.default.resolve(env_1.env.uploadDir);
            fs_1.default.mkdirSync(up, { recursive: true });
            for (const f of fs_1.default.readdirSync(pics))
                if (!fs_1.default.existsSync(path_1.default.join(up, f)))
                    fs_1.default.copyFileSync(path_1.default.join(pics, f), path_1.default.join(up, f));
        }
    }
    catch (e) {
        logger_1.logger.error(`Seed pictures not copied: ${e?.message}`);
    }
    const pool = await (0, db_1.getPool)();
    for (const f of fs_1.default.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
        const tx = new mssql_1.default.Transaction(pool);
        try {
            await tx.begin();
            await new mssql_1.default.Request(tx).query(`DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'dochub-seed', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 120000; IF @r < 0 THROW 50000, N'seed lock timeout', 1;`);
            const done = await new mssql_1.default.Request(tx).input('n', mssql_1.default.NVarChar(200), f).query(`SELECT 1 AS x FROM AppliedSeeds WHERE seed_name = @n`);
            if (done.recordset.length) {
                await tx.commit();
                continue;
            }
            const r = await new mssql_1.default.Request(tx).batch(fs_1.default.readFileSync(path_1.default.join(dir, f), 'utf8'));
            const sets = (r.recordsets ?? []);
            const result = String(sets[sets.length - 1]?.[0]?.result ?? 'done');
            if (!/no user/.test(result)) {
                await new mssql_1.default.Request(tx).input('n', mssql_1.default.NVarChar(200), f).input('r', mssql_1.default.NVarChar(200), result.slice(0, 200))
                    .query(`INSERT INTO AppliedSeeds (seed_name, result) VALUES (@n, @r)`);
            }
            await tx.commit();
            logger_1.logger.info(`Seed ${f}: ${result}`);
        }
        catch (e) {
            await tx.rollback().catch(() => undefined);
            logger_1.logger.error(`Seed ${f} failed (rolled back, server continues): ${e?.message}`);
        }
    }
}
//# sourceMappingURL=migrate.js.map