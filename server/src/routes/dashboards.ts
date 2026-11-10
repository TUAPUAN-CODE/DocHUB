import { Router } from 'express';
import { z } from 'zod';
import { q, q1, T, withTx } from '../config/db';
import { audit } from '../shared/audit';
import { ah, isGuid, notFound, ok, parse, pid } from '../shared/http';
import { mapDashboard, mapSheet, mapWidget } from '../shared/mappers';
import { LV, PermCtx, requireFile } from '../shared/permissions';
import { filterSchema } from '../shared/schemas';
import { computeWidgetData } from '../services/widgetData';

const router = Router();

const WIDGET_TYPES = ['bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'kpi', 'table', 'text', 'image', 'shape',
  'heatmap', 'pareto', 'histogram', 'xchart', 'xbar', 'pct', 'slicer', 'card', 'condition', 'records', 'revision'] as const;

const dataSourceSchema = z.object({
  sheetId: z.string().regex(/^[0-9a-fA-F-]{36}$/).transform((s) => s.toLowerCase()),
  xColumnId: z.string().max(60).nullish().transform((s) => s?.toLowerCase() ?? null),
  xBucket: z.enum(['none', 'day', 'week', 'month', 'quarter', 'year']).optional(),
  series: z
    .array(
      z.object({
        columnId: z.string().max(60).nullish().transform((s) => s?.toLowerCase() ?? null),
        aggregation: z.enum(['sum', 'avg', 'count', 'count_distinct', 'min', 'max', 'none']),
        label: z.string().max(200).nullish(),
      }),
    )
    .min(1)
    .max(12),
  groupByColumnId: z.string().max(60).nullish().transform((s) => s?.toLowerCase() ?? null),
  filters: z.array(filterSchema).max(20).optional(),
  sort: z.enum(['x_asc', 'x_desc', 'value_asc', 'value_desc']).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  kind: z.enum(['histogram', 'xchart', 'xbar']).nullish(),
  bins: z.number().int().min(2).max(100).optional(),
});

const widgetSchema = z.object({
  id: z.string().max(60).optional(),
  type: z.enum(WIDGET_TYPES),
  title: z.string().max(300).nullish(),
  x: z.number().min(-5000).max(20000),
  y: z.number().min(-5000).max(20000),
  w: z.number().min(10).max(20000),
  h: z.number().min(10).max(20000),
  z: z.number().int().min(0).max(100000),
  locked: z.boolean().optional(),
  config: z.record(z.any()).default({}),
  style: z.record(z.any()).default({}),
  dataSource: z.any().nullish(),
});

async function getDashboard(id: string) {
  const d = await q1(`SELECT * FROM Dashboards WHERE dashboard_id = @id`, { id: T.uuid(id) });
  if (!d) throw notFound('ไม่พบแดชบอร์ด');
  return d;
}

/** Every dashboard the current user can open (read access to its file) */
router.get(
  '/dashboards',
  ah(async (req, res) => {
    const rows = await q(
      `SELECT d.dashboard_id, d.dashboard_name, d.updated_at, d.file_id, f.file_name, f.folder_id, f.created_by AS file_created_by, f.color AS file_color
       FROM Dashboards d JOIN Files f ON f.file_id = d.file_id
       WHERE f.is_deleted = 0 ORDER BY d.updated_at DESC`,
    );
    const ctx = await PermCtx.load(req.user!);
    ok(
      res,
      rows
        .map((r) => ({ r, level: ctx.fileLevel({ file_id: r.file_id, folder_id: r.folder_id, created_by: r.file_created_by }) }))
        .filter((x) => x.level >= LV.read)
        .map(({ r, level }) => ({
          id: r.dashboard_id, name: r.dashboard_name, updatedAt: r.updated_at, fileId: r.file_id, fileName: r.file_name,
          fileColor: r.file_color, path: ctx.pathText(r.folder_id), canEdit: level >= LV.manage,
        })),
    );
  }),
);

router.get(
  '/files/:fileId/dashboards',
  ah(async (req, res) => {
    const fileId = pid(req, 'fileId');
    await requireFile(req.user!, fileId, LV.read);
    const rows = await q(`SELECT * FROM Dashboards WHERE file_id = @f ORDER BY sort_order, created_at`, { f: T.uuid(fileId) });
    ok(res, rows.map(mapDashboard));
  }),
);

router.post(
  '/files/:fileId/dashboards',
  ah(async (req, res) => {
    const fileId = pid(req, 'fileId');
    await requireFile(req.user!, fileId, LV.manage);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(300) }), req.body);
    const row = await q1(
      `INSERT INTO Dashboards (file_id, dashboard_name, layout_config, background, created_by) OUTPUT inserted.*
       VALUES (@f, @n, @l, @b, @u)`,
      {
        f: T.uuid(fileId), n: name, u: T.uuid(req.user!.id),
        l: T.text(JSON.stringify({ width: 1600, height: 900, gridSize: 10, snap: true })),
        b: T.text(JSON.stringify({ color: '#F4F6FB', imageUrl: null, fit: 'cover' })),
      },
    );
    await audit({ userId: req.user!.id, action: 'dashboard_create', entityType: 'dashboard', entityId: row!.dashboard_id, fileId, newValue: { name } }, req);
    ok(res, mapDashboard(row), 201);
  }),
);

router.get(
  '/dashboards/:id',
  ah(async (req, res) => {
    const d = await getDashboard(pid(req));
    const { file, level } = await requireFile(req.user!, d.file_id, LV.read);
    const widgets = await q(`SELECT * FROM DashboardWidgets WHERE dashboard_id = @id ORDER BY z_index`, { id: T.uuid(d.dashboard_id) });
    const sheets = await q(`SELECT * FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: T.uuid(d.file_id) });
    ok(res, {
      dashboard: mapDashboard(d),
      widgets: widgets.map(mapWidget),
      file: { id: file.file_id, name: file.file_name },
      sheets: sheets.map(mapSheet),
      level,
    });
  }),
);

router.put(
  '/dashboards/:id',
  ah(async (req, res) => {
    const d = await getDashboard(pid(req));
    await requireFile(req.user!, d.file_id, LV.manage);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(300),
        canvas: z.object({ width: z.number().min(320).max(10000), height: z.number().min(240).max(20000), gridSize: z.number().min(2).max(200), snap: z.boolean() }),
        background: z.object({ color: z.string().max(40).nullish(), imageUrl: z.string().max(1000).nullish(), fit: z.enum(['cover', 'contain', 'repeat']).nullish() }),
        widgets: z.array(widgetSchema).max(300),
      }),
      req.body,
    );
    await withTx(async (tx) => {
      await q(
        `UPDATE Dashboards SET dashboard_name = @n, layout_config = @l, background = @b, updated_at = SYSUTCDATETIME() WHERE dashboard_id = @id`,
        { n: body.name, l: T.text(JSON.stringify(body.canvas)), b: T.text(JSON.stringify(body.background)), id: T.uuid(d.dashboard_id) },
        tx,
      );
      await q(`DELETE FROM DashboardWidgets WHERE dashboard_id = @id`, { id: T.uuid(d.dashboard_id) }, tx);
      for (const w of body.widgets) {
        await q(
          `INSERT INTO DashboardWidgets (widget_id, dashboard_id, widget_type, title, pos_x, pos_y, width, height, z_index, is_locked,
             config, style_config, data_source)
           VALUES (COALESCE(@wid, NEWID()), @d, @t, @ti, @x, @y, @w, @h, @z, @l, @c, @s, @ds)`,
          {
            wid: T.uuid(w.id && isGuid(w.id) ? w.id.toLowerCase() : null), d: T.uuid(d.dashboard_id), t: w.type, ti: T.text(w.title ?? null),
            x: T.float(w.x), y: T.float(w.y), w: T.float(w.w), h: T.float(w.h), z: T.int(w.z), l: T.bit(!!w.locked),
            c: T.text(JSON.stringify(w.config ?? {})), s: T.text(JSON.stringify(w.style ?? {})),
            ds: T.text(w.dataSource ? JSON.stringify(w.dataSource) : null),
          },
          tx,
        );
      }
      await audit({ userId: req.user!.id, action: 'dashboard_update', entityType: 'dashboard', entityId: d.dashboard_id, fileId: d.file_id,
        newValue: { name: body.name, widgets: body.widgets.length } }, req, tx);
    });
    ok(res, { saved: true, updatedAt: new Date().toISOString() });
  }),
);

router.delete(
  '/dashboards/:id',
  ah(async (req, res) => {
    const d = await getDashboard(pid(req));
    await requireFile(req.user!, d.file_id, LV.manage);
    await q(`DELETE FROM Dashboards WHERE dashboard_id = @id`, { id: T.uuid(d.dashboard_id) });
    await audit({ userId: req.user!.id, action: 'dashboard_delete', entityType: 'dashboard', entityId: d.dashboard_id, fileId: d.file_id,
      oldValue: { name: d.dashboard_name } }, req);
    ok(res, { deleted: true });
  }),
);

router.post(
  '/dashboards/data',
  ah(async (req, res) => {
    const { dataSource } = parse(z.object({ dataSource: dataSourceSchema }), req.body);
    ok(res, await computeWidgetData(req.user!, dataSource));
  }),
);

export default router;
