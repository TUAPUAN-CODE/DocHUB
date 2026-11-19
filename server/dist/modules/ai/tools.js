"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOLS = void 0;
exports.resolveWhen = resolveWhen;
exports.slicerPlan = slicerPlan;
exports.withPlan = withPlan;
exports.nameScore = nameScore;
exports.describeItem = describeItem;
exports.runTool = runTool;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../../config/db");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const mappers_1 = require("../../shared/mappers");
const cellWriter_1 = require("../../services/cellWriter");
const rowQuery_1 = require("../../services/rowQuery");
const widgetData_1 = require("../../services/widgetData");
const schemas_1 = require("../../shared/schemas");
const zod_1 = require("zod");
const dsParams = {
    type: 'object',
    properties: {
        sheetId: { type: 'string', description: 'sheet id (from list_files / get_sheet_schema)' },
        xColumnId: { type: 'string', description: 'column for the X axis / category (omit for KPI)' },
        xBucket: { type: 'string', enum: ['none', 'day', 'week', 'month', 'quarter', 'year'], description: 'group dates' },
        groupByColumnId: { type: 'string', description: 'optional second grouping column (splits series)' },
        series: { type: 'array', description: 'what to measure', items: { type: 'object', properties: { columnId: { type: 'string', description: 'omit for count' }, aggregation: { type: 'string', enum: ['sum', 'avg', 'count', 'count_distinct', 'min', 'max', 'none'] }, label: { type: 'string' } }, required: ['aggregation'] } },
        sort: { type: 'string', enum: ['x_asc', 'x_desc', 'value_asc', 'value_desc'] },
        limit: { type: 'integer', description: 'max categories (default 20)' },
        filters: { type: 'array', description: 'optional column filters', items: { type: 'object', properties: { columnId: { type: 'string' }, op: { type: 'string', enum: ['contains', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'] }, value: { type: 'string' }, value2: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } }, required: ['columnId'] } },
    },
    required: ['sheetId', 'series'],
};
exports.TOOLS = [
    { name: 'list_files', description: 'List the files (workbooks) the user can read with their sheets. Use first to find sheet ids.', parameters: { type: 'object', properties: { search: { type: 'string', description: 'part of file name' } } } },
    { name: 'get_sheet_schema', description: 'Columns of a sheet (id, name, data type) and row count.', parameters: { type: 'object', properties: { sheetId: { type: 'string' } }, required: ['sheetId'] } },
    { name: 'query_rows', description: 'Read up to 30 rows of a sheet (to look at samples). For totals use aggregate instead of reading rows.', parameters: { type: 'object', properties: { sheetId: { type: 'string' }, limit: { type: 'integer' }, search: { type: 'string' } }, required: ['sheetId'] } },
    { name: 'aggregate', description: 'Compute grouped numbers (same engine the dashboard charts use): sums/counts/averages by category or date bucket. Use this to summarise data.', parameters: dsParams },
    { name: 'list_dashboards', description: 'Dashboards of a file.', parameters: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] } },
    { name: 'find_items', description: 'Find folders, files or dashboards by NAME (also approximate: the name may have been mis-heard from speech, e.g. "Let\'s Meat Bone" for "Red Meat Bone"). Returns kind, id, name, path and a match score; if the best score is low, ask the user to confirm the name.', parameters: { type: 'object', properties: { query: { type: 'string' }, kind: { type: 'string', enum: ['any', 'folder', 'file', 'dashboard'] } }, required: ['query'] } },
    { name: 'describe_item', description: 'What is inside a folder (its files and sheets), a file (sheets + dashboards) or a dashboard (its widgets). Use for items the user attached or found with find_items.', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['folder', 'file', 'dashboard'] }, id: { type: 'string' } }, required: ['kind', 'id'] } },
    { name: 'open_page', description: 'Take the user to a folder, file or dashboard in the web app (the browser navigates). Use when the user says "open …".', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['folder', 'file', 'dashboard'] }, id: { type: 'string' } }, required: ['kind', 'id'] } },
    { name: 'present_dashboard', description: 'Present a dashboard: the browser opens it (full screen by default), scrolls through its widgets one by one and the cat explains each. Use when the user says "present" / "นำเสนอ" / "พรีเซนต์". The dashboard must be known (attached, current page, or found with find_items).', parameters: { type: 'object', properties: { dashboardId: { type: 'string' }, fullscreen: { type: 'boolean' }, when: { type: 'string', enum: ['today', 'yesterday', 'last7days', 'last30days', 'thismonth', 'lastmonth'], description: 'date range to show (yesterday = เมื่อวาน). The dashboard date filter is set to it BEFORE presenting, so only that period is presented' }, dateFrom: { type: 'string', description: 'YYYY-MM-DD (instead of when)' }, dateTo: { type: 'string', description: 'YYYY-MM-DD' }, slicers: { type: 'array', description: 'other filters to set, e.g. shift DS: [{name:"กะ", values:["DS"]}]', items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } }, required: ['name', 'values'] } } }, required: ['dashboardId'] } },
    { name: 'show_chart', description: 'Draw a chart (or a small summary table) INSIDE THE CHAT for the user — use it when the user asks to see / summarise numbers as a chart, graph or table ("สรุปเป็นกราฟ", "ขอดูกราฟ", "สรุปเป็นตาราง"). It is NOT a dashboard widget. Same data parameters as aggregate. The result lists the numbers so you can comment on them in one or two sentences.', parameters: { type: 'object', properties: { ...dsParams.properties, chartType: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'doughnut', 'pareto', 'table'], description: 'bar for comparing categories, line / area for trends over time, pie / doughnut for shares, pareto for "what causes most", table for a small summary table' }, title: { type: 'string', description: 'Thai title above the chart' } }, required: ['sheetId', 'series', 'chartType', 'title'] } },
    { name: 'export_data', description: 'Make a file for the user to download: a PDF or Excel of the rows of a sheet (optionally filtered / sorted / only some columns), or the Delay report forms of the Delay sheet. The browser creates and downloads it. Use when the user says "ส่งออก", "export", "ขอ PDF", "ขอ Excel", "พิมพ์เป็น PDF". Filters use the same shorthand as aggregate (a date range: op between + value + value2, yyyy-mm-dd). Never claim the file is ready before this tool answered ok.', parameters: { type: 'object', properties: {
                sheetId: { type: 'string' },
                format: { type: 'string', enum: ['pdf', 'xlsx', 'delay_pdf', 'delay_xlsx'], description: 'pdf / xlsx = table of the rows; delay_pdf / delay_xlsx = form F3PFPF67 (PDF) / F3PFPV04 (Excel) — only for the sheet "Delay" of รายงาน Delay F3PFPF67' },
                template: { type: 'string', description: 'name (or part of the name) of a saved PDF layout of the file; omit for the standard report' },
                title: { type: 'string', description: 'heading of the standard PDF report' },
                columns: { type: 'array', items: { type: 'string' }, description: 'column ids or names to include (standard pdf / xlsx); omit for all' },
                filters: dsParams.properties.filters, search: { type: 'string', description: 'text to search in the rows' },
                sort: { type: 'object', properties: { columnId: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } } },
            }, required: ['sheetId', 'format'] } },
    { name: 'create_dashboard', description: 'Create an empty dashboard in a file (needs manage permission). Returns dashboardId.', parameters: { type: 'object', properties: { fileId: { type: 'string' }, name: { type: 'string' } }, required: ['fileId', 'name'] } },
    {
        name: 'add_widgets', description: 'Add widgets (charts / KPI cards / tables / text) to a dashboard. They are laid out automatically in a grid. Widget types: bar, line, area, pie, doughnut, scatter, pareto, histogram, kpi, table, text. For kpi use no xColumnId and one series. For text put the text in "text".',
        parameters: { type: 'object', properties: { dashboardId: { type: 'string' }, widgets: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'pareto', 'histogram', 'kpi', 'table', 'text'] }, title: { type: 'string' }, text: { type: 'string' }, dataSource: dsParams }, required: ['type', 'title'] } } }, required: ['dashboardId', 'widgets'] },
    },
];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** "yesterday" etc. (or explicit dates) → a date range in the server's local time */
function resolveWhen(when, from, to, now = new Date()) {
    if (isYmd(from) || isYmd(to)) {
        const f = isYmd(from) ? from : to, e = isYmd(to) ? to : f;
        return { from: f, to: e, label: f === e ? f : `${f} ถึง ${e}` };
    }
    const day = (back) => { const d = new Date(now); d.setDate(d.getDate() - back); return d; };
    switch (String(when ?? '')) {
        case 'today': return { from: ymd(now), to: ymd(now), label: `วันนี้ (${ymd(now)})` };
        case 'yesterday': return { from: ymd(day(1)), to: ymd(day(1)), label: `เมื่อวาน (${ymd(day(1))})` };
        case 'last7days': return { from: ymd(day(6)), to: ymd(now), label: `7 วันล่าสุด (${ymd(day(6))} ถึง ${ymd(now)})` };
        case 'last30days': return { from: ymd(day(29)), to: ymd(now), label: `30 วันล่าสุด (${ymd(day(29))} ถึง ${ymd(now)})` };
        case 'thismonth': {
            const a = new Date(now.getFullYear(), now.getMonth(), 1);
            return { from: ymd(a), to: ymd(now), label: `เดือนนี้ (${ymd(a)} ถึง ${ymd(now)})` };
        }
        case 'lastmonth': {
            const a = new Date(now.getFullYear(), now.getMonth() - 1, 1), e = new Date(now.getFullYear(), now.getMonth(), 0);
            return { from: ymd(a), to: ymd(e), label: `เดือนที่แล้ว (${ymd(a)} ถึง ${ymd(e)})` };
        }
        default: return null;
    }
}
const slicerName = (w) => String(w.config?.label || w.title || '').trim();
const isSlicer = (w) => w.type === 'slicer' && !w.style?.hidden && w.dataSource?.sheetId && w.dataSource?.xColumnId;
/** the slicer widgets of a dashboard that these filters would set, and what could not be matched */
function slicerPlan(widgets, pf) {
    const filters = new Map();
    const unmatched = [];
    const all = widgets.filter(isSlicer);
    if (pf.from || pf.to) {
        const dates = all.filter((s) => ['date', 'range'].includes(s.config?.mode ?? ''));
        if (!dates.length)
            unmatched.push('วันที่');
        for (const s of dates)
            filters.set(s.id, { columnId: s.dataSource.xColumnId, op: 'between', value: pf.from ?? pf.to, value2: pf.to ?? pf.from });
    }
    for (const want of pf.slicers ?? []) {
        const n = want.name.trim().toLowerCase();
        const hit = all.find((s) => { const sn = slicerName(s).toLowerCase(); return !['date', 'range', 'search'].includes(s.config?.mode ?? '') && sn && n && (sn.includes(n) || n.includes(sn)); });
        if (hit && want.values.length)
            filters.set(hit.id, { columnId: hit.dataSource.xColumnId, mode: 'include', values: want.values });
        else
            unmatched.push(want.name);
    }
    return { filters, unmatched, available: all.map((s) => ({ name: slicerName(s), mode: s.config?.mode ?? 'dropdown_search' })) };
}
/** same rule as the web page's withSlicers: a slicer filters the widgets on its own sheet (or the ones it targets) */
function withPlan(widgets, plan, widgetId, ds) {
    const extra = [];
    for (const s of widgets) {
        const f = plan.get(s.id);
        if (!f || s.dataSource?.sheetId !== ds.sheetId)
            continue;
        const targets = s.config?.targets ?? [];
        if (targets.length && !targets.includes(widgetId))
            continue;
        extra.push(f);
    }
    return extra.length ? { ...ds, filters: [...(ds.filters ?? []), ...extra] } : ds;
}
const clip = (v, n = 120) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v);
const out = (v) => JSON.stringify(v).slice(0, 12000);
const needStr = (a, k) => { if (typeof a[k] !== 'string' || !a[k])
    throw (0, http_1.badRequest)(`ต้องระบุ ${k}`); return a[k].toLowerCase(); };
/** The model's filter shorthand → the engine's ColumnFilter */
function toFilters(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    return arr.slice(0, 10).map((f) => {
        const o = { columnId: String(f.columnId ?? '') };
        if (f.op) {
            o.op = f.op;
            if (f.value !== undefined)
                o.value = f.value;
            if (f.value2 !== undefined)
                o.value2 = f.value2;
        }
        if (Array.isArray(f.values))
            o.values = f.values;
        return schemas_1.filterSchema.parse(o);
    });
}
function toDs(a) {
    const series = (Array.isArray(a.series) && a.series.length ? a.series : [{ aggregation: 'count' }]).slice(0, 6).map((s) => ({ columnId: s.columnId ? String(s.columnId).toLowerCase() : null, aggregation: s.aggregation ?? 'count', label: s.label ?? null }));
    return {
        sheetId: needStr(a, 'sheetId'), xColumnId: a.xColumnId ? String(a.xColumnId).toLowerCase() : null, xBucket: a.xBucket ?? 'none',
        groupByColumnId: a.groupByColumnId ? String(a.groupByColumnId).toLowerCase() : null, series, sort: a.sort, limit: Math.min(500, Math.max(1, Number(a.limit) || 20)), filters: toFilters(a.filters),
    };
}
const PALETTE = ['#1552F0', '#16A34A', '#F59E0B', '#E5484D', '#8B5CF6', '#0EA5E9', '#EC4899', '#14B8A6'];
const SIZE = { bar: [520, 340], line: [520, 340], area: [520, 340], pie: [380, 340], doughnut: [380, 340], scatter: [480, 340], pareto: [560, 360], histogram: [520, 340], kpi: [300, 150], table: [480, 320], text: [1000, 70] };
function buildWidget(spec, x, y, z) {
    const type = String(spec.type);
    if (!(type in SIZE))
        throw (0, http_1.badRequest)(`ไม่รองรับวิดเจ็ตชนิด ${type}`);
    const [w, h] = SIZE[type];
    const base = { id: crypto_1.default.randomUUID(), type, title: String(spec.title ?? '').slice(0, 300), x, y, w, h, z, locked: false, config: {}, style: { showTitle: true }, dataSource: null };
    if (type === 'text')
        return Object.assign(base, { title: '', config: { text: String(spec.text ?? spec.title ?? ''), fontSize: 24, fontWeight: 600, align: 'left', color: '' }, style: { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 4 } });
    const ds = toDs(spec.dataSource ?? {});
    if (type === 'pie' || type === 'doughnut' || type === 'pareto')
        ds.sort = ds.sort ?? 'value_desc';
    if (type === 'scatter')
        ds.series = [{ columnId: ds.series[0]?.columnId ?? null, aggregation: 'none' }];
    if (type === 'histogram') {
        ds.kind = 'histogram';
        ds.bins = 10;
    }
    base.dataSource = ds;
    base.config = type === 'kpi' ? { decimals: 0, color: '', prefix: '', suffix: '' } : type === 'table' ? { decimals: 2 } : { legend: true, grid: true, labels: type === 'pareto', colors: PALETTE.slice(0, 6) };
    return base;
}
const norm = (x) => x.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const bigrams = (x) => { const c = x.replace(/ /g, ''); const m = new Map(); for (let i = 0; i < c.length - 1; i++) {
    const g = c.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
} return m; };
/** 0..1: contains → high; otherwise Dice coefficient of letter pairs (survives a mis-heard word such as "Red" → "Let's") */
function nameScore(query, name) {
    const a = norm(query), b = norm(name);
    if (!a || !b)
        return 0;
    if (a === b)
        return 1;
    if (b.includes(a) || a.includes(b))
        return 0.9 - Math.min(0.3, Math.abs(a.length - b.length) / 100);
    const A = bigrams(a), B = bigrams(b);
    let inter = 0, na = 0, nb = 0;
    for (const [g, n] of A) {
        na += n;
        inter += Math.min(n, B.get(g) ?? 0);
    }
    for (const n of B.values())
        nb += n;
    const dice = na + nb ? (2 * inter) / (na + nb) : 0;
    // a name that has most of the query's words
    const tb = new Set(b.split(' ')), ta = a.split(' ');
    const tok = ta.filter((t) => tb.has(t)).length / ta.length;
    return Math.max(dice, tok * 0.8);
}
async function findItems(u, query, kind) {
    const pc = await permissions_1.PermCtx.load(u);
    const res = [];
    const pathOf = (folderId) => { const parts = []; let cur = folderId ? pc.index.map.get(folderId) : undefined; for (let i = 0; cur && i < 12; i++) {
        parts.unshift(cur.name);
        cur = cur.parentId ? pc.index.map.get(cur.parentId) : undefined;
    } return parts.join(' / '); };
    if (kind === 'any' || kind === 'folder')
        for (const f of pc.index.map.values())
            if (pc.folderLevel(f.id) >= permissions_1.LV.read)
                res.push({ kind: 'folder', id: f.id, name: f.name, path: pathOf(f.parentId), score: nameScore(query, f.name) });
    if (kind === 'any' || kind === 'file') {
        for (const f of await (0, db_1.q)(`SELECT file_id, file_name, folder_id, created_by FROM Files WHERE is_deleted = 0`))
            if (pc.fileLevel({ file_id: f.file_id, folder_id: f.folder_id, created_by: f.created_by }) >= permissions_1.LV.read)
                res.push({ kind: 'file', id: f.file_id, name: f.file_name, path: pathOf(f.folder_id), score: nameScore(query, f.file_name) });
    }
    if (kind === 'any' || kind === 'dashboard') {
        for (const d of await (0, db_1.q)(`SELECT d.dashboard_id, d.dashboard_name, f.file_id, f.file_name, f.folder_id, f.created_by FROM Dashboards d JOIN Files f ON f.file_id = d.file_id WHERE f.is_deleted = 0`))
            if (pc.fileLevel({ file_id: d.file_id, folder_id: d.folder_id, created_by: d.created_by }) >= permissions_1.LV.read)
                res.push({ kind: 'dashboard', id: d.dashboard_id, name: d.dashboard_name, path: `${pathOf(d.folder_id)} / ${d.file_name}`, score: Math.max(nameScore(query, d.dashboard_name), nameScore(query, d.file_name) * 0.85) });
    }
    return res.filter((r) => r.score >= 0.3).sort((a, b) => b.score - a.score).slice(0, 8).map((r) => ({ ...r, score: Math.round(r.score * 100) / 100 }));
}
async function describeItem(u, kind, id) {
    const pc = await permissions_1.PermCtx.load(u);
    if (kind === 'folder') {
        const f = pc.index.map.get(id);
        if (!f || pc.folderLevel(id) < permissions_1.LV.read)
            throw (0, http_1.badRequest)('ไม่พบโฟลเดอร์หรือไม่มีสิทธิ์');
        const files = (await (0, db_1.q)(`SELECT file_id, file_name, folder_id, created_by FROM Files WHERE is_deleted = 0 AND folder_id = @f ORDER BY file_name`, { f: db_1.T.uuid(id) })).filter((x) => pc.fileLevel({ file_id: x.file_id, folder_id: x.folder_id, created_by: x.created_by }) >= permissions_1.LV.read).slice(0, 40);
        const sheets = files.length ? await (0, db_1.q)(`SELECT sheet_id, file_id, sheet_name FROM Sheets WHERE is_deleted = 0 AND file_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`, { ids: db_1.T.text(JSON.stringify(files.map((x) => x.file_id))) }) : [];
        const subs = [...pc.index.map.values()].filter((x) => x.parentId === id && pc.folderLevel(x.id) >= permissions_1.LV.read).map((x) => ({ folderId: x.id, name: x.name }));
        return { kind, id, name: f.name, folders: subs, files: files.map((x) => ({ fileId: x.file_id, name: x.file_name, sheets: sheets.filter((s) => s.file_id === x.file_id).map((s) => ({ sheetId: s.sheet_id, name: s.sheet_name })) })) };
    }
    if (kind === 'file') {
        await (0, permissions_1.requireFile)(u, id, permissions_1.LV.read);
        const f = await (0, db_1.q1)(`SELECT file_name FROM Files WHERE file_id = @f AND is_deleted = 0`, { f: db_1.T.uuid(id) });
        const sheets = await (0, db_1.q)(`SELECT sheet_id, sheet_name FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: db_1.T.uuid(id) });
        const dashes = await (0, db_1.q)(`SELECT dashboard_id, dashboard_name FROM Dashboards WHERE file_id = @f ORDER BY sort_order`, { f: db_1.T.uuid(id) });
        return { kind, id, name: f?.file_name, sheets: sheets.map((s) => ({ sheetId: s.sheet_id, name: s.sheet_name })), dashboards: dashes.map((d) => ({ dashboardId: d.dashboard_id, name: d.dashboard_name })) };
    }
    const d = await (0, db_1.q1)(`SELECT dashboard_id, dashboard_name, file_id FROM Dashboards WHERE dashboard_id = @d`, { d: db_1.T.uuid(id) });
    if (!d)
        throw (0, http_1.badRequest)('ไม่พบแดชบอร์ด');
    await (0, permissions_1.requireFile)(u, d.file_id, permissions_1.LV.read);
    const ws = (await (0, db_1.q)(`SELECT * FROM DashboardWidgets WHERE dashboard_id = @d ORDER BY pos_y, pos_x`, { d: db_1.T.uuid(id) })).map(mappers_1.mapWidget);
    return { kind: 'dashboard', id, fileId: d.file_id, name: d.dashboard_name, widgets: ws.filter((w) => w.type !== 'shape').map((w) => ({ id: w.id, type: w.type, title: w.title })) };
}
async function runTool(name, a, ctx) {
    const u = ctx.user;
    switch (name) {
        case 'list_files': {
            const like = a.search ? `%${String(a.search).replace(/[[\]%_]/g, (m) => `[${m}]`)}%` : null;
            const files = await (0, db_1.q)(`SELECT TOP 200 file_id, file_name, folder_id, created_by FROM Files WHERE is_deleted = 0 ${like ? 'AND file_name LIKE @l' : ''} ORDER BY updated_at DESC`, { l: db_1.T.text(like) });
            const pc = await permissions_1.PermCtx.load(u);
            const ok = files.filter((f) => pc.fileLevel({ file_id: f.file_id, folder_id: f.folder_id, created_by: f.created_by }) >= permissions_1.LV.read).slice(0, 40);
            const sheets = ok.length ? await (0, db_1.q)(`SELECT sheet_id, file_id, sheet_name FROM Sheets WHERE is_deleted = 0 AND file_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`, { ids: db_1.T.text(JSON.stringify(ok.map((f) => f.file_id))) }) : [];
            return out(ok.map((f) => ({ fileId: f.file_id, name: f.file_name, sheets: sheets.filter((s) => s.file_id === f.file_id).map((s) => ({ sheetId: s.sheet_id, name: s.sheet_name })) })));
        }
        case 'get_sheet_schema': {
            const id = needStr(a, 'sheetId');
            await (0, permissions_1.requireSheet)(u, id, permissions_1.LV.read);
            const cols = await (0, cellWriter_1.loadColumns)(id);
            const n = await (0, db_1.q1)(`SELECT COUNT_BIG(*) AS n FROM Rows WHERE sheet_id = @s AND is_deleted = 0`, { s: db_1.T.uuid(id) });
            return out({ rowCount: Number(n?.n ?? 0), columns: cols.map((c) => ({ columnId: c.column_id, name: c.column_name, type: c.data_type })) });
        }
        case 'query_rows': {
            const id = needStr(a, 'sheetId');
            await (0, permissions_1.requireSheet)(u, id, permissions_1.LV.read);
            const cols = await (0, cellWriter_1.loadColumns)(id);
            const r = await (0, rowQuery_1.queryRows)(id, cols, { page: 1, pageSize: Math.min(30, Math.max(1, Number(a.limit) || 10)), search: a.search ? String(a.search) : undefined });
            const names = new Map(cols.map((c) => [c.column_id, c.column_name]));
            return out({ total: r.total, rows: r.rows.map((row) => Object.fromEntries(Object.entries(row.values ?? {}).filter(([k, v]) => names.has(k) && v !== null && !(typeof v === 'string' && v.startsWith('/uploads'))).map(([k, v]) => [names.get(k), clip(v)]))) });
        }
        case 'aggregate': {
            const ds = toDs(a);
            await (0, permissions_1.requireSheet)(u, ds.sheetId, permissions_1.LV.read);
            const d = await (0, widgetData_1.computeWidgetData)(u, ds);
            return out({ totalRows: d.totalRows, categories: d.categories?.slice(0, 60), series: d.series?.map((s) => ({ name: s.name, values: s.values.slice(0, 60) })), points: d.points?.slice(0, 60) });
        }
        case 'show_chart': {
            const ds = toDs(a);
            await (0, permissions_1.requireSheet)(u, ds.sheetId, permissions_1.LV.read);
            const type = ['bar', 'line', 'area', 'pie', 'doughnut', 'pareto', 'table'].find((t) => t === a.chartType) ?? 'bar';
            const d = await (0, widgetData_1.computeWidgetData)(u, ds);
            const categories = (d.categories ?? []).slice(0, 60).map((c) => String(c));
            const series = (d.series ?? []).slice(0, 6).map((x) => ({ name: String(x.name ?? ''), values: x.values.slice(0, 60) }));
            if (!categories.length || !series.length)
                return out({ ok: false, error: 'no data for this chart — check the filters / columns' });
            (ctx.charts ??= []).push({ type, title: String(a.title ?? '').slice(0, 200), categories, series, totalRows: d.totalRows });
            return out({ ok: true, shown: type, note: 'the chart is now shown in the chat; do not repeat every number, give the key finding in one or two sentences', totalRows: d.totalRows, categories: categories.slice(0, 30), series: series.map((x) => ({ name: x.name, values: x.values.slice(0, 30) })) });
        }
        case 'export_data': {
            const sheetId = needStr(a, 'sheetId');
            const format = ['pdf', 'xlsx', 'delay_pdf', 'delay_xlsx'].find((f) => f === a.format);
            if (!format)
                throw (0, http_1.badRequest)('format ต้องเป็น pdf, xlsx, delay_pdf หรือ delay_xlsx');
            const { sheet } = await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.read);
            const cols = await (0, cellWriter_1.loadColumns)(sheetId);
            if (format.startsWith('delay')) {
                const names = new Set(cols.map((c) => c.column_name));
                if (!['mapping_id', 'บรรจุเสร็จ (F)', 'ช่วงที่ 1', 'เตรียมเสร็จ (A)'].every((n) => names.has(n)))
                    return out({ ok: false, error: 'this sheet is not the Delay report (F3PFPF67): use format pdf or xlsx' });
            }
            const filters = toFilters(a.filters);
            const sorts = a.sort && a.sort.columnId && cols.some((c) => c.column_id === String(a.sort.columnId).toLowerCase()) ? [{ columnId: String(a.sort.columnId).toLowerCase(), dir: a.sort.dir === 'desc' ? 'desc' : 'asc' }] : undefined;
            const search = a.search ? String(a.search).slice(0, 200) : undefined;
            // columns by id or by name
            let picked;
            if (Array.isArray(a.columns) && a.columns.length) {
                const found = a.columns.slice(0, 60).map((x) => { const t = String(x).toLowerCase(); return cols.find((c) => c.column_id === t) ?? cols.find((c) => String(c.column_name).toLowerCase() === t) ?? cols.find((c) => String(c.column_name).toLowerCase().includes(t)); }).filter(Boolean);
                picked = [...new Set(found.map((c) => c.column_id))];
                if (!picked.length)
                    return out({ ok: false, error: 'no column matches the names given', columns: cols.map((c) => c.column_name) });
            }
            const r = await (0, rowQuery_1.queryRows)(sheetId, cols, { page: 1, pageSize: 1, filters, sorts, search });
            if (!r.total)
                return out({ ok: false, error: 'no rows match these filters — nothing to export' });
            const label = format === 'delay_pdf' ? 'PDF F3PFPF67' : format === 'delay_xlsx' ? 'Excel F3PFPV04' : format === 'pdf' ? 'PDF' : 'Excel';
            (ctx.actions ??= []).push({ type: 'export', format, fileId: sheet.file_id, fileName: sheet.file_name, sheetId, sheetName: sheet.sheet_name, label, template: a.template ? String(a.template).slice(0, 200) : undefined, title: a.title ? String(a.title).slice(0, 200) : undefined, columns: picked, filters, search, sorts, total: r.total });
            return out({ ok: true, exporting: label, file: sheet.file_name, rows: r.total, note: 'the browser now builds the file and downloads it; tell the user the file is on its way (name, how many rows, which filter)' });
        }
        case 'find_items': return out(await findItems(u, needStr(a, 'query'), ['folder', 'file', 'dashboard'].includes(a.kind) ? a.kind : 'any'));
        case 'describe_item': return out(await describeItem(u, String(a.kind), needStr(a, 'id')));
        case 'open_page': {
            const kind = String(a.kind), id = needStr(a, 'id');
            const d = await describeItem(u, kind, id);
            const to = kind === 'folder' ? `/folders/${id}` : kind === 'file' ? `/files/${id}` : `/files/${d.fileId}/dashboards/${id}`;
            (ctx.actions ??= []).push({ type: 'open', to, label: d.name });
            return out({ ok: true, opened: d.name });
        }
        case 'present_dashboard': {
            const id = needStr(a, 'dashboardId');
            const d = await describeItem(u, 'dashboard', id);
            const range = resolveWhen(a.when, a.dateFrom, a.dateTo);
            const pf = { ...(range ? { from: range.from, to: range.to, label: range.label } : {}), slicers: Array.isArray(a.slicers) ? a.slicers.slice(0, 5).map((s) => ({ name: String(s?.name ?? '').slice(0, 80), values: (Array.isArray(s?.values) ? s.values : []).slice(0, 50).map((v) => String(v)) })).filter((s) => s.name && s.values.length) : [] };
            const wrows = await (0, db_1.q)(`SELECT * FROM DashboardWidgets WHERE dashboard_id = @d`, { d: db_1.T.uuid(id) });
            const plan = slicerPlan(wrows.map(mappers_1.mapWidget), pf);
            if (plan.unmatched.length)
                return out({ ok: false, error: `this dashboard has no filter for: ${plan.unmatched.join(', ')}. Tell the user, and ask whether to present all data instead`, availableFilters: plan.available });
            (ctx.actions ??= []).push({ type: 'present', fileId: d.fileId, dashboardId: id, fullscreen: a.fullscreen !== false, label: d.name, ...(plan.filters.size ? { filters: pf } : {}) });
            return out({ ok: true, presenting: d.name, widgets: d.widgets.length, filteredTo: plan.filters.size ? { date: range?.label ?? null, slicers: pf.slicers } : 'all data', note: 'the browser now filters the dashboard first, opens it and the cat explains each widget; do not read the widgets yourself, just confirm briefly (say which period/filter is presented)' });
        }
        case 'list_dashboards': {
            const id = needStr(a, 'fileId');
            await (0, permissions_1.requireFile)(u, id, permissions_1.LV.read);
            return out((await (0, db_1.q)(`SELECT dashboard_id, dashboard_name FROM Dashboards WHERE file_id = @f ORDER BY sort_order, created_at`, { f: db_1.T.uuid(id) })).map((d) => ({ dashboardId: d.dashboard_id, name: d.dashboard_name })));
        }
        case 'create_dashboard': {
            const fileId = needStr(a, 'fileId');
            await (0, permissions_1.requireFile)(u, fileId, permissions_1.LV.manage);
            const name = String(a.name ?? '').trim().slice(0, 300) || 'แดชบอร์ดใหม่';
            const row = await (0, db_1.q1)(`INSERT INTO Dashboards (file_id, dashboard_name, layout_config, background, created_by) OUTPUT inserted.dashboard_id VALUES (@f, @n, @l, @b, @u)`, { f: db_1.T.uuid(fileId), n: name, u: db_1.T.uuid(u.id), l: db_1.T.text(JSON.stringify({ width: 1600, height: 900, gridSize: 10, snap: true })), b: db_1.T.text(JSON.stringify({ color: '#F4F6FB', imageUrl: null, fit: 'cover' })) });
            await (0, audit_1.audit)({ userId: u.id, action: 'dashboard_create', entityType: 'dashboard', entityId: row.dashboard_id, fileId, newValue: { name, via: 'ai' } });
            ctx.changed.add(row.dashboard_id);
            return out({ dashboardId: row.dashboard_id, name });
        }
        case 'add_widgets': {
            const id = needStr(a, 'dashboardId');
            const d = await (0, db_1.q1)(`SELECT dashboard_id, file_id, layout_config FROM Dashboards WHERE dashboard_id = @i`, { i: db_1.T.uuid(id) });
            if (!d)
                throw (0, http_1.badRequest)('ไม่พบแดชบอร์ด');
            await (0, permissions_1.requireFile)(u, d.file_id, permissions_1.LV.manage);
            const specs = (Array.isArray(a.widgets) ? a.widgets : []).slice(0, 20);
            if (!specs.length)
                throw (0, http_1.badRequest)('ไม่มีวิดเจ็ตที่จะเพิ่ม');
            for (const s of specs) {
                const sid = s?.dataSource?.sheetId;
                if (sid)
                    await (0, permissions_1.requireSheet)(u, String(sid).toLowerCase(), permissions_1.LV.read);
            }
            const canvasW = (() => { try {
                return JSON.parse(d.layout_config).width;
            }
            catch {
                return 1600;
            } })();
            const ex = await (0, db_1.q1)(`SELECT ISNULL(MAX(pos_y + height), 0) AS bottom, ISNULL(MAX(z_index), 0) AS z FROM DashboardWidgets WHERE dashboard_id = @i`, { i: db_1.T.uuid(id) });
            let cx = 20, cy = Number(ex?.bottom ?? 0) > 0 ? Number(ex.bottom) + 20 : 20, rowH = 0, z = Number(ex?.z ?? 0);
            const built = [];
            for (const s of specs) {
                const w = buildWidget(s, 0, 0, 0);
                if (cx + w.w > canvasW - 20 && cx > 20) {
                    cx = 20;
                    cy += rowH + 20;
                    rowH = 0;
                }
                w.x = cx;
                w.y = cy;
                w.z = ++z;
                cx += w.w + 20;
                rowH = Math.max(rowH, w.h);
                built.push(w);
            }
            for (const w of built) {
                await (0, db_1.q)(`INSERT INTO DashboardWidgets (widget_id, dashboard_id, widget_type, title, pos_x, pos_y, width, height, z_index, is_locked, config, style_config, data_source)
                 VALUES (@wid, @d, @t, @ti, @x, @y, @w, @h, @z, 0, @c, @s, @ds)`, { wid: db_1.T.uuid(w.id), d: db_1.T.uuid(id), t: w.type, ti: db_1.T.text(w.title), x: db_1.T.float(w.x), y: db_1.T.float(w.y), w: db_1.T.float(w.w), h: db_1.T.float(w.h), z: db_1.T.int(w.z), c: db_1.T.text(JSON.stringify(w.config)), s: db_1.T.text(JSON.stringify(w.style)), ds: db_1.T.text(w.dataSource ? JSON.stringify(w.dataSource) : null) });
            }
            await (0, db_1.q)(`UPDATE Dashboards SET updated_at = SYSUTCDATETIME() WHERE dashboard_id = @i`, { i: db_1.T.uuid(id) });
            await (0, audit_1.audit)({ userId: u.id, action: 'dashboard_update', entityType: 'dashboard', entityId: id, fileId: d.file_id, newValue: { addedByAi: built.map((w) => `${w.type}:${w.title}`) } });
            ctx.changed.add(id);
            return out({ added: built.length });
        }
        default: throw (0, http_1.badRequest)(`ไม่รู้จักเครื่องมือ ${name}`);
    }
}
void zod_1.z;
//# sourceMappingURL=tools.js.map