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

## Data

The GitHub repository is **public**. Never commit company data (Excel files, notes, product codes, passwords, `.env`).
Import scripts read the company's files on the server at run time (see `server/scripts/seedQualityHighlight.ts`).

## Checks before pushing

- `cd server && npm test` (node:test, `src/**/*.test.ts`) and `npm run build`
- `cd client && npm run build`
- UI text is Thai; the users work on phones on the production floor — check phone widths too.
