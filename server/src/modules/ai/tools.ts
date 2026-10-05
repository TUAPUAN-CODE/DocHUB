import crypto from 'crypto';
import { q, q1, T } from '../../config/db';
import type { AuthUser } from '../../middleware/auth';
import { audit } from '../../shared/audit';
import { badRequest } from '../../shared/http';
import { LV, PermCtx, requireFile, requireSheet } from '../../shared/permissions';
import { loadColumns } from '../../services/cellWriter';
import { queryRows } from '../../services/rowQuery';
import { computeWidgetData, DataSource } from '../../services/widgetData';
import { filterSchema } from '../../shared/schemas';
import { z } from 'zod';
import type { ToolDef } from './providers';

export interface Ctx { user: AuthUser; fileId?: string; sheetId?: string; dashboardId?: string; changed: Set<string> }

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

export const TOOLS: ToolDef[] = [
  { name: 'list_files', description: 'List the files (workbooks) the user can read with their sheets. Use first to find sheet ids.', parameters: { type: 'object', properties: { search: { type: 'string', description: 'part of file name' } } } },
  { name: 'get_sheet_schema', description: 'Columns of a sheet (id, name, data type) and row count.', parameters: { type: 'object', properties: { sheetId: { type: 'string' } }, required: ['sheetId'] } },
  { name: 'query_rows', description: 'Read up to 30 rows of a sheet (to look at samples). For totals use aggregate instead of reading rows.', parameters: { type: 'object', properties: { sheetId: { type: 'string' }, limit: { type: 'integer' }, search: { type: 'string' } }, required: ['sheetId'] } },
  { name: 'aggregate', description: 'Compute grouped numbers (same engine the dashboard charts use): sums/counts/averages by category or date bucket. Use this to summarise data.', parameters: dsParams },
  { name: 'list_dashboards', description: 'Dashboards of a file.', parameters: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] } },
  { name: 'create_dashboard', description: 'Create an empty dashboard in a file (needs manage permission). Returns dashboardId.', parameters: { type: 'object', properties: { fileId: { type: 'string' }, name: { type: 'string' } }, required: ['fileId', 'name'] } },
  {
    name: 'add_widgets', description: 'Add widgets (charts / KPI cards / tables / text) to a dashboard. They are laid out automatically in a grid. Widget types: bar, line, area, pie, doughnut, scatter, pareto, histogram, kpi, table, text. For kpi use no xColumnId and one series. For text put the text in "text".',
    parameters: { type: 'object', properties: { dashboardId: { type: 'string' }, widgets: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'pareto', 'histogram', 'kpi', 'table', 'text'] }, title: { type: 'string' }, text: { type: 'string' }, dataSource: dsParams }, required: ['type', 'title'] } } }, required: ['dashboardId', 'widgets'] },
  },
];

const clip = (v: unknown, n = 120) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v);
const out = (v: unknown) => JSON.stringify(v).slice(0, 12000);
const needStr = (a: Record<string, unknown>, k: string) => { if (typeof a[k] !== 'string' || !a[k]) throw badRequest(`ต้องระบุ ${k}`); return (a[k] as string).toLowerCase(); };

/** The model's filter shorthand → the engine's ColumnFilter */
function toFilters(raw: unknown) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.slice(0, 10).map((f: any) => {
    const o: Record<string, unknown> = { columnId: String(f.columnId ?? '') };
    if (f.op) { o.op = f.op; if (f.value !== undefined) o.value = f.value; if (f.value2 !== undefined) o.value2 = f.value2; }
    if (Array.isArray(f.values)) o.values = f.values;
    return filterSchema.parse(o);
  });
}
function toDs(a: Record<string, any>): DataSource {
  const series = (Array.isArray(a.series) && a.series.length ? a.series : [{ aggregation: 'count' }]).slice(0, 6).map((s: any) => ({ columnId: s.columnId ? String(s.columnId).toLowerCase() : null, aggregation: s.aggregation ?? 'count', label: s.label ?? null }));
  return {
    sheetId: needStr(a, 'sheetId'), xColumnId: a.xColumnId ? String(a.xColumnId).toLowerCase() : null, xBucket: a.xBucket ?? 'none',
    groupByColumnId: a.groupByColumnId ? String(a.groupByColumnId).toLowerCase() : null, series, sort: a.sort, limit: Math.min(500, Math.max(1, Number(a.limit) || 20)), filters: toFilters(a.filters),
  };
}

const PALETTE = ['#1552F0', '#16A34A', '#F59E0B', '#E5484D', '#8B5CF6', '#0EA5E9', '#EC4899', '#14B8A6'];
const SIZE: Record<string, [number, number]> = { bar: [520, 340], line: [520, 340], area: [520, 340], pie: [380, 340], doughnut: [380, 340], scatter: [480, 340], pareto: [560, 360], histogram: [520, 340], kpi: [300, 150], table: [480, 320], text: [1000, 70] };

function buildWidget(spec: any, x: number, y: number, z: number) {
  const type = String(spec.type);
  if (!(type in SIZE)) throw badRequest(`ไม่รองรับวิดเจ็ตชนิด ${type}`);
  const [w, h] = SIZE[type];
  const base: any = { id: crypto.randomUUID(), type, title: String(spec.title ?? '').slice(0, 300), x, y, w, h, z, locked: false, config: {}, style: { showTitle: true }, dataSource: null };
  if (type === 'text') return Object.assign(base, { title: '', config: { text: String(spec.text ?? spec.title ?? ''), fontSize: 24, fontWeight: 600, align: 'left', color: '' }, style: { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 4 } });
  const ds = toDs(spec.dataSource ?? {});
  if (type === 'pie' || type === 'doughnut' || type === 'pareto') ds.sort = ds.sort ?? 'value_desc';
  if (type === 'scatter') ds.series = [{ columnId: ds.series[0]?.columnId ?? null, aggregation: 'none' }];
  if (type === 'histogram') { (ds as any).kind = 'histogram'; (ds as any).bins = 10; }
  base.dataSource = ds;
  base.config = type === 'kpi' ? { decimals: 0, color: '', prefix: '', suffix: '' } : type === 'table' ? { decimals: 2 } : { legend: true, grid: true, labels: type === 'pareto', colors: PALETTE.slice(0, 6) };
  return base;
}

export async function runTool(name: string, a: Record<string, any>, ctx: Ctx): Promise<string> {
  const u = ctx.user;
  switch (name) {
    case 'list_files': {
      const like = a.search ? `%${String(a.search).replace(/[[\]%_]/g, (m) => `[${m}]`)}%` : null;
      const files = await q(`SELECT TOP 200 file_id, file_name, folder_id, created_by FROM Files WHERE is_deleted = 0 ${like ? 'AND file_name LIKE @l' : ''} ORDER BY updated_at DESC`, { l: T.text(like) });
      const pc = await PermCtx.load(u);
      const ok = files.filter((f) => pc.fileLevel({ file_id: f.file_id, folder_id: f.folder_id, created_by: f.created_by }) >= LV.read).slice(0, 40);
      const sheets = ok.length ? await q(`SELECT sheet_id, file_id, sheet_name FROM Sheets WHERE is_deleted = 0 AND file_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`, { ids: T.text(JSON.stringify(ok.map((f) => f.file_id))) }) : [];
      return out(ok.map((f) => ({ fileId: f.file_id, name: f.file_name, sheets: sheets.filter((s) => s.file_id === f.file_id).map((s) => ({ sheetId: s.sheet_id, name: s.sheet_name })) })));
    }
    case 'get_sheet_schema': {
      const id = needStr(a, 'sheetId');
      await requireSheet(u, id, LV.read);
      const cols = await loadColumns(id);
      const n = await q1(`SELECT COUNT_BIG(*) AS n FROM Rows WHERE sheet_id = @s AND is_deleted = 0`, { s: T.uuid(id) });
      return out({ rowCount: Number(n?.n ?? 0), columns: cols.map((c: any) => ({ columnId: c.column_id, name: c.column_name, type: c.data_type })) });
    }
    case 'query_rows': {
      const id = needStr(a, 'sheetId');
      await requireSheet(u, id, LV.read);
      const cols = await loadColumns(id);
      const r = await queryRows(id, cols, { page: 1, pageSize: Math.min(30, Math.max(1, Number(a.limit) || 10)), search: a.search ? String(a.search) : undefined });
      const names = new Map(cols.map((c: any) => [c.column_id, c.column_name]));
      return out({ total: r.total, rows: r.rows.map((row: any) => Object.fromEntries(Object.entries(row.values ?? {}).filter(([k, v]) => names.has(k) && v !== null && !(typeof v === 'string' && v.startsWith('/uploads'))).map(([k, v]) => [names.get(k), clip(v)]))) });
    }
    case 'aggregate': {
      const ds = toDs(a);
      await requireSheet(u, ds.sheetId, LV.read);
      const d = await computeWidgetData(u, ds);
      return out({ totalRows: d.totalRows, categories: d.categories?.slice(0, 60), series: d.series?.map((s: any) => ({ name: s.name, values: s.values.slice(0, 60) })), points: d.points?.slice(0, 60) });
    }
    case 'list_dashboards': {
      const id = needStr(a, 'fileId');
      await requireFile(u, id, LV.read);
      return out((await q(`SELECT dashboard_id, dashboard_name FROM Dashboards WHERE file_id = @f ORDER BY sort_order, created_at`, { f: T.uuid(id) })).map((d) => ({ dashboardId: d.dashboard_id, name: d.dashboard_name })));
    }
    case 'create_dashboard': {
      const fileId = needStr(a, 'fileId');
      await requireFile(u, fileId, LV.manage);
      const name = String(a.name ?? '').trim().slice(0, 300) || 'แดชบอร์ดใหม่';
      const row = await q1(`INSERT INTO Dashboards (file_id, dashboard_name, layout_config, background, created_by) OUTPUT inserted.dashboard_id VALUES (@f, @n, @l, @b, @u)`,
        { f: T.uuid(fileId), n: name, u: T.uuid(u.id), l: T.text(JSON.stringify({ width: 1600, height: 900, gridSize: 10, snap: true })), b: T.text(JSON.stringify({ color: '#F4F6FB', imageUrl: null, fit: 'cover' })) });
      await audit({ userId: u.id, action: 'dashboard_create', entityType: 'dashboard', entityId: row!.dashboard_id, fileId, newValue: { name, via: 'ai' } });
      ctx.changed.add(row!.dashboard_id);
      return out({ dashboardId: row!.dashboard_id, name });
    }
    case 'add_widgets': {
      const id = needStr(a, 'dashboardId');
      const d = await q1(`SELECT dashboard_id, file_id, layout_config FROM Dashboards WHERE dashboard_id = @i`, { i: T.uuid(id) });
      if (!d) throw badRequest('ไม่พบแดชบอร์ด');
      await requireFile(u, d.file_id, LV.manage);
      const specs = (Array.isArray(a.widgets) ? a.widgets : []).slice(0, 20);
      if (!specs.length) throw badRequest('ไม่มีวิดเจ็ตที่จะเพิ่ม');
      for (const s of specs) { const sid = s?.dataSource?.sheetId; if (sid) await requireSheet(u, String(sid).toLowerCase(), LV.read); }
      const canvasW = (() => { try { return JSON.parse(d.layout_config).width as number; } catch { return 1600; } })();
      const ex = await q1(`SELECT ISNULL(MAX(pos_y + height), 0) AS bottom, ISNULL(MAX(z_index), 0) AS z FROM DashboardWidgets WHERE dashboard_id = @i`, { i: T.uuid(id) });
      let cx = 20, cy = Number(ex?.bottom ?? 0) > 0 ? Number(ex!.bottom) + 20 : 20, rowH = 0, z = Number(ex?.z ?? 0);
      const built: any[] = [];
      for (const s of specs) {
        const w = buildWidget(s, 0, 0, 0);
        if (cx + w.w > canvasW - 20 && cx > 20) { cx = 20; cy += rowH + 20; rowH = 0; }
        w.x = cx; w.y = cy; w.z = ++z; cx += w.w + 20; rowH = Math.max(rowH, w.h);
        built.push(w);
      }
      for (const w of built) {
        await q(`INSERT INTO DashboardWidgets (widget_id, dashboard_id, widget_type, title, pos_x, pos_y, width, height, z_index, is_locked, config, style_config, data_source)
                 VALUES (@wid, @d, @t, @ti, @x, @y, @w, @h, @z, 0, @c, @s, @ds)`,
          { wid: T.uuid(w.id), d: T.uuid(id), t: w.type, ti: T.text(w.title), x: T.float(w.x), y: T.float(w.y), w: T.float(w.w), h: T.float(w.h), z: T.int(w.z), c: T.text(JSON.stringify(w.config)), s: T.text(JSON.stringify(w.style)), ds: T.text(w.dataSource ? JSON.stringify(w.dataSource) : null) });
      }
      await q(`UPDATE Dashboards SET updated_at = SYSUTCDATETIME() WHERE dashboard_id = @i`, { i: T.uuid(id) });
      await audit({ userId: u.id, action: 'dashboard_update', entityType: 'dashboard', entityId: id, fileId: d.file_id, newValue: { addedByAi: built.map((w) => `${w.type}:${w.title}`) } });
      ctx.changed.add(id);
      return out({ added: built.length });
    }
    default: throw badRequest(`ไม่รู้จักเครื่องมือ ${name}`);
  }
}
void z;
