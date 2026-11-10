"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrations = applyMigrations;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mssql_1 = __importDefault(require("mssql"));
const db_1 = require("../config/db");
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
//# sourceMappingURL=migrate.js.map