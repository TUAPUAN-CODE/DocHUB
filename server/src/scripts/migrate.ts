import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import { getPool } from '../config/db';
import { env } from '../config/env';
import { logger } from '../shared/logger';

/**
 * Applies every database/NN_*.sql file with NN >= 02 (all idempotent), so an existing
 * database picks up new tables without a manual step. 01_schema.sql is handled by db:init.
 */
export async function applyMigrations() {
  const dir = path.resolve(__dirname, '../../../database');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => /^(0[2-9]|[1-9]\d)_.*\.sql$/.test(f)).sort();
  const pool = await getPool();
  // two servers starting together: one waits for the other (app lock held by the transaction), the scripts are idempotent
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).query(`DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'dochub-migrate', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 120000; IF @r < 0 THROW 50000, N'migration lock timeout', 1;`);
    for (const f of files) {
      const batches = fs.readFileSync(path.join(dir, f), 'utf8').split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
      for (const b of batches) await new sql.Request(tx).batch(b);
      logger.info(`Migration applied: ${f}`);
    }
    await tx.commit();
  } catch (e) {
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
export async function applySeeds() {
  const dir = path.resolve(__dirname, '../../../database/seed');
  if (!fs.existsSync(dir)) return;
  try {
    const pics = path.join(dir, 'files');
    if (fs.existsSync(pics)) {
      const up = path.resolve(env.uploadDir);
      fs.mkdirSync(up, { recursive: true });
      for (const f of fs.readdirSync(pics)) if (!fs.existsSync(path.join(up, f))) fs.copyFileSync(path.join(pics, f), path.join(up, f));
    }
  } catch (e: any) {
    logger.error(`Seed pictures not copied: ${e?.message}`);
  }
  const pool = await getPool();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await new sql.Request(tx).query(`DECLARE @r INT; EXEC @r = sp_getapplock @Resource = N'dochub-seed', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 120000; IF @r < 0 THROW 50000, N'seed lock timeout', 1;`);
      const done = await new sql.Request(tx).input('n', sql.NVarChar(200), f).query(`SELECT 1 AS x FROM AppliedSeeds WHERE seed_name = @n`);
      if (done.recordset.length) { await tx.commit(); continue; }
      const r = await new sql.Request(tx).batch(fs.readFileSync(path.join(dir, f), 'utf8'));
      const sets = (r.recordsets ?? []) as any[];
      const result = String(sets[sets.length - 1]?.[0]?.result ?? 'done');
      if (!/no user/.test(result)) {
        await new sql.Request(tx).input('n', sql.NVarChar(200), f).input('r', sql.NVarChar(200), result.slice(0, 200))
          .query(`INSERT INTO AppliedSeeds (seed_name, result) VALUES (@n, @r)`);
      }
      await tx.commit();
      logger.info(`Seed ${f}: ${result}`);
    } catch (e: any) {
      await tx.rollback().catch(() => undefined);
      logger.error(`Seed ${f} failed (rolled back, server continues): ${e?.message}`);
    }
  }
}
