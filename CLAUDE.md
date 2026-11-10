# DocHUB (DataSheet Pro) — notes for AI agents

## Deploy = `git pull` (always ship a build)

The production server (Windows, PM2 `ecosystem.production.config.js`) only runs `git pull`. It does **not** build.
So every change must include the build output:

```
cd client && npm run build      # → client/dist (tsc --noEmit + vite build)
cd ../server && npm run build   # → server/dist (tsc)
git add -A client/dist server/dist
```

- Commit `client/dist` and `server/dist` together with the source change, every time either side changes.
- PM2 watches `server/dist` and `database/` and restarts `dochub` ~4 s after a pull; the web app (`client/dist`) needs no restart.
- If a change adds or upgrades a dependency in `server/package.json`, tell the user to run `npm ci` in `server` once (dist alone is not enough).
- Database changes: add an idempotent `database/NN_*.sql` (applied automatically at start-up). Never drop or rewrite existing data.
- Data that must appear on every server: `database/seed/*.sql` (see Data below).

## Data

The GitHub repository is **public**. Never commit company data (Excel files, notes, product codes, passwords, `.env`).
Import scripts read the company's files on the server at run time (see `server/scripts/seedQualityHighlight.ts`).

Exception, decided by the owner: the Quality Highlight master data is published as a start-up seed
(`database/seed/quality_highlight_rev9.sql` + pictures in `database/seed/files`). Do not add other company data there
without the owner asking for it.

- `database/seed/*.sql` run at start-up after the migrations, once per database (`AppliedSeeds`), each in its own
  transaction; a failing seed is logged and the server still starts (`applySeeds` in `server/src/scripts/migrate.ts`).
- Seeds are generated, not hand-written: `server/scripts/exportSeedSql.ts --file-id <id>` dumps one file (sheets, rows,
  cells, history, revisions, dashboards) from a test database. Keep its ids; it re-credits rows to the target's first admin.
- Changing a seed that already ran does nothing on existing databases: ship new data under a new file name.

## Checks before pushing

- `cd server && npm test` (node:test, `src/**/*.test.ts`) and `npm run build`
- `cd client && npm run build`
- UI text is Thai; the users work on phones on the production floor — check phone widths too.
