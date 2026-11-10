# DataSheet Pro

A Google-Sheets-style data platform with a SharePoint-style file manager and Power BI-style dashboards, built for Thai factory and office teams.

- **Front end:** React 18, TypeScript, Vite, Tailwind
- **Back end:** Node.js, Express, TypeScript, Socket.IO
- **Database:** Microsoft SQL Server (manage it in SSMS)

The UI is in Thai. This README is in English and uses Thai terms where helpful.

---

## 1. What's inside (requirement → feature)

| Requirement | Where / how |
|---|---|
| Files with multiple sheets; columns with name, type and required flag | **File Builder** (`/files/new`): 12 column types — `varchar`, `text`, `int`, `float`, `date`, `datetime`, `boolean`, `select`, `multi_select`, `email`, `url`, `json`. Each type has validation: min/max, length, regex, decimals, and select options with colours. Column types can be changed later, with a preview of values that will not convert. |
| Roles | `user` enters data. `master` creates files/forms and manages the folders they created or were granted. `admin` can do everything. |
| Per-file / per-folder access control | Share dialog grants `read` / `write` / `manage`, optionally with an expiry date. Folder grants inherit down the tree. |
| Access requests with a required note | A locked file shows a request form. The note (≥10 characters) is required. Reviewers are notified in real time and approve or reject with a note. |
| Data rollback, and who edited what and when | Every cell write is versioned in `CellHistory`. Rollback is available at four levels (details below). The audit log is searchable and has one-click **ย้อนค่า** (revert) per cell change. |
| Filter / sort bar above the table | Each column has a chip that opens a dropdown with search. The dropdown combines sort, condition operators and an Excel-style value checklist with counts. Multi-column sort is available with Shift+click. |
| Required columns | Marked with `*`. Empty required cells are tinted in the grid, and the server enforces the rule. |
| Folders and sub-folders | Unlimited depth: tree in the sidebar, breadcrumbs, move with a folder picker, soft-delete to trash. |
| Zoom, fullscreen, resizable columns and rows, freeze panes | Zoom 50–200% with Ctrl + wheel or Ctrl +/−/0. Fullscreen API. Drag to resize; double-click a column edge to auto-fit. Freeze rows and columns like Excel. All of these are saved **per user, per sheet**. |
| Favorites (star) and file search | Star any file or folder (shown in the sidebar). Global search covers file names, folders and cell contents (Ctrl+K). |
| Dashboards | Excel-like chart builder and Power BI-like free canvas. See details below. |
| UI customization | Every colour, radius, spacing and font size can be changed. **Google Fonts** can be chosen in the app (42 curated fonts, including Thai, plus any other font by name). Per-component overrides are available for sidebar, top bar, card, button, input, table header/cell, modal and widget. Themes are saved per user; admins can set an organisation default. |
| SharePoint-like file manager, icons, animations | Activity feed cards ("Viewed/Edited N min ago"), grid/list views, and folder names in accent colours. A file card expands into the workspace when opened. Rows animate in, and remote edits flash. |

### What's new

| Area | Feature |
|---|---|
| Dashboard | **Slicers** (filter widgets): dropdown with search, dropdown, checkbox list, buttons, radio, text search, number range, date range. They filter every widget on the same sheet (or only the ones you pick). |
| Dashboard | **Card** with heading / sub-heading / description (each can be shown or hidden), optional icon and an optional live number from a table. |
| Dashboard | **Condition card**: compares value A with value B (each from any sheet in any file) using `<  <=  >  >=  =  !=` and shows your pass / fail message and colour. |
| Dashboard | New charts: **Pareto, Histogram, Heatmap, X chart (individuals), X-bar chart, 100% stacked bar**. |
| Dashboard | **Layer manager** (drag to reorder, show/hide, lock) and **full screen** presentation mode. |
| Dashboard | Power BI-style format pane: axes, data labels, legend, gridlines, number format, reference / average lines, combo series with a secondary axis, control limits (UCL/LCL/USL/LSL). |
| Files | **Excel (.xlsx) export**, and **share links** (`/s/<token>`): visitors without an account get a read-only view; signed-in users receive the permission chosen for the link. |
| Login | **Google / Microsoft sign-in** (see `server/.env.example`). |
| Roles | `viewer` (read only), `user` (enters data in tables; cannot change columns or structure), `master`, `admin`. |
| Tables | **Import from Excel / CSV** (column mapping, validation report, template download), **relationships** (a select column takes its options from a column of another sheet, optionally filtered by another column in the same row, e.g. Plant → Line), and an option to hide the “— ไม่ระบุ —” choice. |
| Tables | **Auto document numbers** (column type “เลขที่เอกสารอัตโนมัติ”): free-form template such as `{PREFIX}-{YYMMDD}-{SEQ:3}` → `CSM-260926-009`; prefixes (CSM/CSN/CSR) come from a fixed list or from a column of another sheet; the running number restarts when the date or prefix changes. |
| Files | **Union files / sheets**: gather the rows of several sheets (from different files) into one read-only sheet. Every source must have exactly the same columns (name, type, required flag, options, rules) – the system lists each difference. A “source” column shows where a row came from; data re-syncs automatically (or with “ซิงค์ตอนนี้”). |
| Tables | Click column headers (Ctrl/Shift for several) to see **row count and sum / average / min / max** of whole columns for the current filter; managers choose which columns appear in the **filter / sort bar** per sheet; file pickers browse **folder → sub-folder → file** (with search). |
| Export | **PDF export** with a per-file layout designer (owners / managers / admin): page size & orientation, margins, Thai fonts, header / footer with page numbers, text, images / logos, lines, multi-column rows, tables (chosen columns, rows per page + page break, colours, zebra rows, summary row), watermark, per-row forms (one page per row) and absolute positioning. Layouts are copied with the file, can be copied from another file and exported / imported as JSON. |
| Tables | **Formula columns (ƒ)**: a column can be computed from the others in the row — `IF`, `ROUND`, `DATEDIFF`, `MINUTES`, `DURATION`, `HOUR`, text and date functions; edited by column names, recalculated on every change, read-only for users. |
| Export | **Export dialog**: questions defined by the layout (Line, Plant, date …), `{{shift}}` (DS/NS), **signature boxes**, a **Date / Shift / Line / Plant row** block, and **“keep a copy in the system”** → *เอกสารที่ออกแล้ว* (who / when / signers, SHA-256, download again). |
| Sidebar | **Dashboards** page listing every dashboard you can open; row delete button (hover the row number, or select rows and use the toolbar). |

> Existing databases: start the API once (or run `npm run db:init`) – `database/02_*.sql` and `03_*.sql` to `05_*.sql` are applied automatically and is safe to re-run.

### Dashboard details

The dashboard supports:

- **Chart types:** bar, line, area, pie, doughnut, scatter, KPI, summary table.
- **Content widgets:** text (with fonts), images (upload), shapes.
- **Canvas editing:** drag and resize, overlapping boxes with layer order, snap-to-grid, lock, duplicate, keyboard nudging, canvas size presets, background colour or image.
- **Data:** a widget can read from **any file you have read access to**. Aggregations are sum, avg, count, count distinct, min and max. Dates can be grouped by day, week, month, quarter or year. Series can be split by a column, and filters can be added.

### Rollback levels

1. **Undo / redo** in the grid (Ctrl+Z / Ctrl+Y), for your own recent edits.
2. **Cell:** restore any previous version from the cell history, or from the audit log.
3. **Row:** return a whole row to any point in its history. Requires the `manage` permission.
4. **Sheet (admin):** point-in-time rollback of an entire sheet to a timestamp. You get a preview (cells changed, rows to delete, rows to restore) and must give a reason. Rows created after that time are soft-deleted, and rows deleted after it are restored.

Every rollback is itself recorded as new history, so it can be rolled back again.

---

## 2. Project structure

```
datasheet-pro/
├── database/
│   ├── 00_create_database.sql   # CREATE DATABASE (Thai_CI_AS)
│   └── 01_schema.sql            # 24 tables, indexes, role seed (run in SSMS or via db:init)
├── server/                      # Express API + Socket.IO
│   └── src/
│       ├── config/              # env, mssql pool + typed params + transactions
│       ├── middleware/          # JWT auth, role guards, error handler
│       ├── shared/              # permissions, cell value parsing, audit, notifications, zod schemas
│       ├── services/            # cellWriter, rowQuery (EAV filters/sort), rollback, widgetData, structure, purge
│       ├── routes/              # auth, users, folders, files, sheets, columns, rows, cells, access,
│       │                        # audit, favorites, activity, search, notifications, themes, dashboards,
│       │                        # uploads, trash
│       ├── scripts/             # initDb.ts, seed.ts
│       ├── socket.ts            # rooms: user:<id>, sheet:<id>; presence
│       └── index.ts
├── client/                      # React SPA
│   └── src/
│       ├── api/                 # axios client (refresh-token queue) + typed endpoints
│       ├── store/               # zustand: auth, theme, data, ui, notifications
│       ├── lib/                 # theme engine, fonts, formatting (Thai), csv, column types
│       ├── components/
│       │   ├── layout/          # AppShell, Sidebar (pill w/ inverted corners), TopBar, FolderTree
│       │   ├── files/           # icons, item views, share/move/request dialogs
│       │   ├── builder/         # column editor & manager
│       │   ├── sheet/           # SpreadsheetGrid, filters, row form, history & rollback modals
│       │   ├── dashboard/       # widgets (recharts), config panel
│       │   ├── settings/        # ThemeCustomizer + Google Fonts picker
│       │   └── ui/              # Button, Modal, Popover, Inputs, SearchSelect, feedback
│       └── pages/               # Home, Folder, File, Builder, Dashboard, Search, Requests, Audit, Users, Trash, Settings
├── Dockerfile                   # single image: API + built client
└── docker-compose.yml           # SQL Server 2022 + app
```

---

## 3. Quick start (development)

**Requirements:** Node.js 18+ (20 recommended) and SQL Server 2019+ (Express/Developer is fine) with **SQL authentication** and **TCP/IP enabled**.

### 3.1 Database

Pick one option:

- **Option A (script):** create the database and schema automatically.
  ```bash
  cd server
  cp .env.example .env        # set DB_HOST, DB_USER, DB_PASSWORD, JWT_SECRET
  npm install
  npm run db:init             # creates DB (if missing) + applies database/01_schema.sql
  npm run db:seed             # demo users, folders, a production file with 70+ rows, a dashboard
  ```
- **Option B (SSMS):** open and execute `database/00_create_database.sql`, then `database/01_schema.sql`. After that, run `npm run db:seed` from `server/`.

`npm run db:init -- --force` drops and recreates the database. **This destroys all data.**

### 3.2 Run

```bash
# terminal 1
cd server && npm run dev          # http://172.48.0.116:4000  (API + websockets)

# terminal 2
cd client && npm install && npm run dev   # http://172.48.0.116:5175  (proxies /api, /uploads, /socket.io)
```

### 3.3 Demo accounts (created by the seed)

| Role | Username | Password |
|---|---|---|
| admin | `admin` | `Admin@123` (or `SEED_ADMIN_PASSWORD`) |
| master | `master` | `Master@123` |
| user | `user` | `User@1234` |

**Change these before any real deployment.**

---

## 4. Configuration (`server/.env`)

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | |
| `DB_HOST` / `DB_PORT` | `172.48.0.116` / `1433` | |
| `DB_INSTANCE` | – | Named instance, e.g. `SQLEXPRESS`. When set, the port is ignored and SQL Browser must be running. |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | – / – / `DataSheetPro` | |
| `DB_ENCRYPT` / `DB_TRUST_CERT` | `false` / `true` | Use `true` / `false` with a real certificate, e.g. on Azure SQL. |
| `JWT_SECRET` | **required** | 32+ random characters. |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_DAYS` | `15m` / `7` | The refresh token is an httpOnly cookie that rotates on every use. |
| `COOKIE_SECURE` | `true` in production | Set to `false` only when serving over plain HTTP on a host other than 172.48.0.116. |
| `CORS_ORIGIN` | `http://172.48.0.116:5175` | Comma-separated list. |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` | `uploads` / `5` | Dashboard images and avatars. |
| `SHOW_LOCKED_ITEMS` | `true` | Show files and folders you can't open with a padlock, so users can request access. |
| `APP_TZ_OFFSET_MINUTES` | `420` | Bangkok (UTC+7). Used for date bucketing and day boundaries. |
| `SERVE_CLIENT_DIR` | – | Path to `client/dist`. The API then also serves the SPA. |
| `TRASH_RETENTION_DAYS` | `30` | Items in the trash older than this are purged automatically every hour. |

---

## 5. Production

```bash
cd client && npm ci && npm run build          # → client/dist
cd ../server && npm ci && npm run build       # → server/dist
SERVE_CLIENT_DIR=../client/dist NODE_ENV=production node dist/index.js
```

Put it behind **HTTPS**, for example with IIS ARR, nginx or Caddy, and enable WebSocket upgrade for `/socket.io`.

Quality Hilight (Note การผลิต from the QUALITY HIGHLIGHT Excel, with sheet revisions, auto-filled update date/name and a lookup dashboard): [`docs/QUALITY_HIGHLIGHT.md`](docs/QUALITY_HIGHLIGHT.md) (Thai).

`client/dist` and `server/dist` are committed: a server running `ecosystem.production.config.js` updates with `git pull` alone (PM2 restarts the API when `server/dist` changes).

To open it on the internet from a company server for free (PM2 + Cloudflare Tunnel, no inbound ports, the database stays on site), follow [`docs/DEPLOY_PUBLIC.md`](docs/DEPLOY_PUBLIC.md) (Thai). It uses `ecosystem.production.config.js` and `deploy/cloudflared/config.example.yml`.

With Docker:

```bash
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
docker compose up -d --build
docker compose exec app node dist/scripts/initDb.js
docker compose exec app node dist/scripts/seed.js      # optional demo data
# → http://172.48.0.116:4000
```

**Backups:** a regular SQL Server backup of `DataSheetPro` plus the `uploads/` folder is enough.

---

## 6. Architecture notes

### Permission model

A user's effective level is the highest of the following:

- owner of the file or folder;
- a direct file grant;
- a grant on any ancestor folder;
- being the creator of an ancestor folder (a master "owns" what is inside folders they created).

Levels are `read` (1), `write` (2) and `manage` (3). `admin` always has `manage`. The `user` role is capped at `write`, even if someone grants it `manage`. Expired grants are ignored. All of this is enforced on the server (`shared/permissions.ts`); the UI only mirrors it.

### Data model (EAV)

A sheet's rows live in `Rows`, and values live in `Cells` with one column per type (`value_text`, `value_int`, `value_float`, `value_date`, `value_bool`, `value_json`). This lets users design columns at runtime without `ALTER TABLE`, while still allowing typed sorting and filtering in SQL.

`services/rowQuery.ts` builds parameterised queries with `OPENJSON` value lists. It supports include/exclude, blanks, operators, multi-sort with nulls last, and paging.

Values are parsed leniently, which suits Thai office data:

- `30/09/2569` (Buddhist year) or `30/09/2026` → `2026-09-30`;
- `1,250.50` → a number;
- `ใช่` / `ไม่` → a boolean;
- select labels → option values.

### History and rollback

- Every write goes through `services/cellWriter.ts`. In one transaction it upserts `Cells`, appends to `CellHistory` (with version and source), and writes `AuditLog`.
- Rollback computes the state at time *T* from the **first change after T**. It then applies the old values as new edits.
- Soft-deletes (`is_deleted` plus `delete_batch`) let a folder delete be restored as a single unit.

### Realtime

Socket.IO rooms per sheet push `cells:updated`, `rows:changed`, `columns:changed` and presence (who is viewing). The API sends an `x-socket-id` header so the editor who made a change doesn't receive their own echo. Notifications go to `user:<id>` rooms.

### Theming

Themes are JSON (`UserThemes.theme_json`). They are applied as CSS variables, and Tailwind colours map to those variables. Because of this, a change is shown instantly as a live preview before you save. Google Fonts are loaded on demand, and the picker loads only the preview glyphs it needs (`&text=`).

---

## 7. API overview

All endpoints are under `/api`, return JSON, and require a Bearer token except `/auth/login` and `/auth/refresh`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`; `GET /auth/me`; `POST /auth/change-password` |
| Users (admin) | `GET/POST /users`, `PUT /users/:id`, `POST /users/bulk`, `POST /users/:id/reset-password`, `GET /users/lookup`, `PUT /users/me/profile` |
| Folders | `GET /folders/tree`, `GET /folders/:id/contents` (`root` allowed), `POST /folders`, `PUT /folders/:id`, `POST /folders/:id/move`, `DELETE /folders/:id` |
| Files | `GET /files/accessible`, `GET /files/:id`, `POST /files` (with sheets and columns), `PUT /files/:id`, `POST /files/:id/move`, `POST /files/:id/duplicate`, `DELETE /files/:id` |
| Sheets and columns | `POST /files/:id/sheets`, `PUT/DELETE /sheets/:id`, `POST /files/:id/sheets/reorder`, `GET /sheets/:id`, `PUT /sheets/:id/prefs`; `POST /sheets/:id/columns`, `PUT/DELETE /columns/:id`, `POST /columns/:id/type-preview`, `POST /columns/:id/restore`, `POST /sheets/:id/columns/reorder` |
| Rows and cells | `POST /sheets/:id/rows/query`, `POST /sheets/:id/rows/distinct`, `POST /sheets/:id/rows`, `POST /sheets/:id/rows/delete`, `GET /sheets/:id/rows/trash`, `POST /sheets/:id/rows/restore`, `GET /rows/:id/history`, `POST /rows/:id/rollback`, `POST /sheets/:id/rollback`; `PUT /cells`, `POST /sheets/:id/cells/bulk`, `GET /cells/history`, `POST /cells/rollback` |
| Access | `GET/POST/DELETE /access/:type/:id`, `GET/POST /access-requests`, `POST /access-requests/:id/approve` \| `/reject` \| `/cancel`, `GET /access-requests/pending-count` |
| Other | `GET /audit`, `GET/POST/DELETE /favorites`, `GET /activity/feed`, `GET /search`, `GET/POST /notifications…`, `GET/PUT/DELETE /themes/me`, `PUT/DELETE /themes/org`, dashboards `GET/POST/PUT/DELETE` + `POST /dashboards/data`, `POST /uploads/image`, `GET /trash`, `POST /trash/restore`, `DELETE /trash/purge` |

---

## 8. Differences from the specification document

- History stores values as JSON (`old_value` / `new_value`) instead of one column per type. This makes rollback type-agnostic and survives column type changes.
- Freeze panes, zoom, widths and hidden columns are **per user**, so one person's layout doesn't change everyone's view.
- Real-time runs on a single node (Socket.IO in memory). No Redis is needed for one server; see the roadmap.
- The theme is stored as one JSON document per user rather than as key/value rows, which is simpler to version and preview.

## 9. Known limitations and roadmap

- **Grid:** row virtualisation is not implemented yet. The default page size is 100 rows (up to 1,000 per page). Very wide pages at 1,000 rows will be slower.
- **Dashboard editor:** it has no multi-select or alignment guides yet (snap-to-grid and arrow-key nudging are available).
- **Import:** CSV/Excel import isn't built. Paste from Excel into the grid works, including multi-cell TSV, and CSV export is available.
- **Scaling:** to run several API instances, add `@socket.io/redis-adapter` and make sure sticky sessions are on.
- **Verification:** the code type-checks and builds (`tsc` and `vite build`). It has not been run end-to-end against a live SQL Server in the build environment, so run through the demo flows once after setup.

## 10. Troubleshooting

- **`ConnectionError: Failed to connect`.** In SQL Server Configuration Manager, enable TCP/IP, restart the service, and allow port 1433 through the firewall. For `SQLEXPRESS`, set `DB_INSTANCE=SQLEXPRESS` and start the SQL Browser service, or give the instance a fixed port.
- **`Login failed for user`.** Enable **SQL Server and Windows Authentication mode** (server properties → Security) and restart the service.
- **`Invalid object name 'OPENJSON'`.** The database compatibility level must be 130 or higher. `00_create_database.sql` sets it to 150.
- **The refresh cookie is not kept after deployment.** Serve the site over HTTPS, or set `COOKIE_SECURE=false` for an internal HTTP-only host. Also make sure `CORS_ORIGIN` matches the site URL.
- **Thai text shows as `?`.** All text columns are `NVARCHAR`. If you query in SSMS, use the `N'...'` prefix for literals.

More: [docs/MODULES.md](docs/MODULES.md) (extension points) · [docs/presets/rm-pack-report.md](docs/presets/rm-pack-report.md) (PFCM report preset).
