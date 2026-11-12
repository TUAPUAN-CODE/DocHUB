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

Exceptions, decided by the owner: the Quality Highlight master data (`database/seed/quality_highlight_rev9.sql` + pictures in
`database/seed/files`) and the Metal Detector program / sensitivity tables + form F3QCPF06 (`database/seed/metal_detector_f3qcpf06.sql`)
are published as start-up seeds, and so is the Metal Detector problem log F3QCPP28 (`metal_detector_record_problem.sql`, owner's
request 2026-11), and the bone check log F3QCPF51 (`bone_f3qcpf51.sql` + `bone_f3qcpf51_data.sql`, a compact data seed written by
`server/scripts/buildBone.ts --data-sql`). The empty Quality Highlight - Incoming file + dashboard (`quality_highlight_incoming.sql`)
is a structure-only seed (no data). Do not add other company data there without the owner asking for it.

- `database/seed/*.sql` run at start-up after the migrations, once per database (`AppliedSeeds`), each in its own
  transaction; a failing seed is logged and the server still starts (`applySeeds` in `server/src/scripts/migrate.ts`).
- Seeds are generated, not hand-written: `server/scripts/exportSeedSql.ts --file-id <id>` dumps one file (sheets, rows,
  cells, history, revisions, dashboards) from a test database. Keep its ids; it re-credits rows to the target's first admin.
- Changing a seed that already ran does nothing on existing databases: ship new data under a new file name.

## Checks before pushing

- `cd server && npm test` (node:test, `src/**/*.test.ts`) and `npm run build`
- `cd client && npm run build`
- UI text is Thai; the users work on phones on the production floor — check phone widths too.

## UI rules

- Dialogs (`components/ui/Modal.tsx`) close only from their own buttons (✕ / ยกเลิก …): no backdrop tap, no Esc. Do not bring those back.
- The in-app manual (`/guide`, docs/GUIDE.md) is generated from the real UI: after a UI change that a guide shows, re-run
  `client/scripts/guide/capture.cjs` (demo database only) and commit `client/public/guide`.
- A select column can take its options from another sheet (`validation.lookup` sheet/column, optional parent filter) or from the
  users' names (`validation.lookup.users.tag`). Lines of a header row are entered by scanning or with a form (`settings.lines.entry`).
- Code that runs inside a transaction (e.g. `registerAfterSheetCopied` hooks) must pass `tx` to every query: a query outside the
  transaction waits for the rows that transaction has just written (union sheets used to hang 120 s this way).
- Access = own grants + grants to the user's tags (`FileTagAccess` / `FolderTagAccess`), capped by role (`shared/permissions.ts`).
  Read tag memberships through the view `UserTagsAll` (adds the system tag All = everyone, which has no `UserTags` rows); write to `UserTags`.
- Roles: viewer < user < master < admin < root. Use `isAdminRole()` (admin or root) instead of `role === 'admin'`; `requireRole` lets root through.
  Only a root gives the root role or edits a root account. The root account is created at start-up (`scripts/rootAccount.ts`), never in the repo.
- Pages of the left bar are listed in `server/src/modules/pageAccess/registry.ts` and `client/src/lib/pages.tsx` (same keys); a new page needs
  both, plus `RequirePage` in `App.tsx` (and `requirePage(key)` on its API when anyone may be given it). See docs/NEWS_TAGS_ROOT.md.
- E-mail is optional (`Users.email` may be NULL): never assume it is there.
- Files have a document type (`Files.doc_type`: master_data | record | NULL). Revisions also freeze the sheet's format; a `record` (form)
  issues format-only revisions. A typed file gets a first Rev automatically. See docs/NEWS_TAGS_ROOT.md → ประเภทเอกสารและ Rev.
- The dashboard on phones (stacked layout) brings font sizes down (`phoneSized`); keep inputs at 16 px or iPhone zooms in.
