/**
 * Turns one file of a DocHUB database (its sheets, columns, rows, cells, history, revisions and dashboards) into a SQL seed
 * that any DocHUB inserts by itself at start-up (database/seed/*.sql, see src/scripts/migrate.ts → applySeeds).
 *
 *   npx ts-node --transpile-only scripts/exportSeedSql.ts --file-id <file id> --folder "Quality Highlight Report" --sub "Data" \
 *     --out ../database/seed/quality_highlight.sql [--skip-names "Quality Highlight - Master,Quality Hilight - Master"]
 *
 * Uses the database of server/.env. The seed:
 *   - runs once per database (AppliedSeeds) and does nothing if the file id, or a live file with one of the --skip-names,
 *     already exists;
 *   - puts the file in the folders named --folder / --sub (re-used when they exist, created otherwise);
 *   - credits everything to the first active admin of the target database;
 *   - pictures referenced by the cells are copied to database/seed/files (copied into UPLOAD_DIR at start-up).
 */
import fs from 'fs';
import path from 'path';
import { getPool, q } from '../src/config/db';
import { env } from '../src/config/env';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const FILE = arg('--file-id')?.toLowerCase();
const FOLDER = arg('--folder') ?? 'Quality Highlight Report';
const SUB = arg('--sub') ?? 'Data';
const OUT = path.resolve(arg('--out') ?? path.resolve(__dirname, '../../database/seed/seed.sql'));
const SKIP = (arg('--skip-names') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const lit = (s: string) => `N'${s.replace(/'/g, "''")}'`;
const sqlType = (t: string) => ({ uniqueidentifier: 'UNIQUEIDENTIFIER', int: 'INT', bigint: 'BIGINT', bit: 'BIT', float: 'FLOAT', datetime2: 'DATETIME2' } as Record<string, string>)[t] ?? 'NVARCHAR(MAX)';
const jsonValue = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 23) : v); // datetime2 in UTC, without "Z" (OPENJSON → DATETIME2)

/** INSERT … SELECT FROM OPENJSON(<rows>) for the rows of `table` matching `where`; *_by → @u, Files.folder_id → @sub */
async function insertFor(table: string, where: string, params: Record<string, unknown>): Promise<{ sql: string; rows: any[] }> {
  const cols = (await q(`SELECT c.name, TYPE_NAME(c.user_type_id) AS t, c.is_identity, c.is_computed FROM sys.columns c WHERE c.object_id = OBJECT_ID(@t) ORDER BY c.column_id`, { t: `dbo.${table}` }))
    .filter((c) => !c.is_identity && !c.is_computed);
  const rows = await q(`SELECT ${cols.map((c) => `[${c.name}]`).join(', ')} FROM ${table} WHERE ${where}`, params);
  if (!rows.length) return { sql: `-- ${table}: none`, rows };
  const data = JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c.name, jsonValue(r[c.name])]))));
  const pick = cols.map((c) => {
    if (/_by$/.test(c.name)) return `CASE WHEN j.[${c.name}] IS NULL THEN NULL ELSE @u END`;
    if (table === 'Files' && c.name === 'folder_id') return '@sub';
    return `j.[${c.name}]`;
  });
  return {
    rows,
    sql: `-- ${table}: ${rows.length}\nINSERT INTO ${table} (${cols.map((c) => `[${c.name}]`).join(', ')})\nSELECT ${pick.join(', ')}\nFROM OPENJSON(${lit(data)})\nWITH (${cols.map((c) => `[${c.name}] ${sqlType(c.t)} '$.${c.name}'`).join(', ')}) AS j;`,
  };
}

async function main() {
  if (!FILE) throw new Error('ระบุ --file-id');
  await getPool();
  const file = (await q(`SELECT file_id, file_name FROM Files WHERE file_id = @f AND is_deleted = 0`, { f: FILE }))[0];
  if (!file) throw new Error(`ไม่พบไฟล์ ${FILE}`);
  const sheets = `(SELECT sheet_id FROM Sheets WHERE file_id = @f AND is_deleted = 0)`;
  const parts = [
    await insertFor('Files', 'file_id = @f', { f: FILE }),
    await insertFor('Sheets', 'file_id = @f AND is_deleted = 0', { f: FILE }),
    await insertFor('Columns', `sheet_id IN ${sheets} AND is_deleted = 0`, { f: FILE }),
    await insertFor('Rows', `sheet_id IN ${sheets} AND is_deleted = 0`, { f: FILE }),
    await insertFor('Cells', `row_id IN (SELECT row_id FROM Rows WHERE sheet_id IN ${sheets} AND is_deleted = 0) AND column_id IN (SELECT column_id FROM Columns WHERE is_deleted = 0)`, { f: FILE }),
    await insertFor('CellHistory', `sheet_id IN ${sheets} AND row_id IN (SELECT row_id FROM Rows WHERE is_deleted = 0)`, { f: FILE }),
    await insertFor('SheetRevisions', `sheet_id IN ${sheets}`, { f: FILE }),
    await insertFor('Dashboards', 'file_id = @f', { f: FILE }),
    await insertFor('DashboardWidgets', 'dashboard_id IN (SELECT dashboard_id FROM Dashboards WHERE file_id = @f)', { f: FILE }),
  ];

  // pictures the cells point to → database/seed/files
  const filesDir = path.join(path.dirname(OUT), 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const pics = new Set<string>();
  for (const c of parts[4].rows) for (const u of (() => { try { return JSON.parse(c.value_json ?? '[]'); } catch { return []; } })()) if (typeof u === 'string' && u.startsWith('/uploads/')) pics.add(u.slice(9));
  for (const p of pics) fs.copyFileSync(path.resolve(env.uploadDir, p), path.join(filesDir, p));

  const names = [file.file_name, ...SKIP].filter((v, i, a) => a.indexOf(v) === i);
  const out = `-- DocHUB seed: "${file.file_name}" (generated by server/scripts/exportSeedSql.ts — do not edit by hand)
-- Inserted automatically at start-up (src/scripts/migrate.ts → applySeeds), once per database (table AppliedSeeds);
-- skipped when the file is already there (same file id, or a live file with one of the names below).
-- Folder: ${FOLDER} / ${SUB} (existing folders are re-used). Pictures: database/seed/files → UPLOAD_DIR.
SET NOCOUNT ON;
IF EXISTS (SELECT 1 FROM Files WHERE file_id = '${FILE}')
   OR EXISTS (SELECT 1 FROM Files WHERE is_deleted = 0 AND file_name IN (${names.map(lit).join(', ')}))
BEGIN SELECT N'skipped (already there)' AS result; RETURN; END;

DECLARE @u UNIQUEIDENTIFIER = (SELECT TOP 1 u.user_id FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id JOIN Roles r ON r.role_id = ur.role_id
                               WHERE r.role_name = N'admin' AND u.is_active = 1 ORDER BY u.created_at);
IF @u IS NULL SET @u = (SELECT TOP 1 user_id FROM Users WHERE is_active = 1 ORDER BY created_at);
IF @u IS NULL BEGIN SELECT N'skipped (no user yet)' AS result; RETURN; END;

DECLARE @top UNIQUEIDENTIFIER = (SELECT TOP 1 folder_id FROM Folders WHERE is_deleted = 0 AND parent_id IS NULL AND folder_name = ${lit(FOLDER)} ORDER BY created_at);
IF @top IS NULL BEGIN SET @top = NEWID(); INSERT INTO Folders (folder_id, folder_name, parent_id, created_by) VALUES (@top, ${lit(FOLDER)}, NULL, @u); END;
DECLARE @sub UNIQUEIDENTIFIER = (SELECT TOP 1 folder_id FROM Folders WHERE is_deleted = 0 AND parent_id = @top AND folder_name = ${lit(SUB)} ORDER BY created_at);
IF @sub IS NULL BEGIN SET @sub = NEWID(); INSERT INTO Folders (folder_id, folder_name, parent_id, created_by) VALUES (@sub, ${lit(SUB)}, @top, @u); END;

${parts.map((p) => p.sql).join('\n\n')}

SELECT N'inserted' AS result;
`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out, 'utf8');
  console.log(`✓ ${OUT} (${(out.length / 1024).toFixed(0)} KB) · ${parts.map((p, i) => `${['files', 'sheets', 'columns', 'rows', 'cells', 'history', 'revisions', 'dashboards', 'widgets'][i]} ${p.rows.length}`).join(' · ')} · รูป ${pics.size}`);
  process.exit(0);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
