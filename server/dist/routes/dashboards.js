"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const permissions_1 = require("../shared/permissions");
const schemas_1 = require("../shared/schemas");
const widgetData_1 = require("../services/widgetData");
const router = (0, express_1.Router)();
const WIDGET_TYPES = ['bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'kpi', 'table', 'text', 'image', 'shape',
    'heatmap', 'pareto', 'histogram', 'xchart', 'xbar', 'pct', 'slicer', 'card', 'condition', 'records', 'revision'];
const dataSourceSchema = zod_1.z.object({
    sheetId: zod_1.z.string().regex(/^[0-9a-fA-F-]{36}$/).transform((s) => s.toLowerCase()),
    xColumnId: zod_1.z.string().max(60).nullish().transform((s) => s?.toLowerCase() ?? null),
    xBucket: zod_1.z.enum(['none', 'day', 'week', 'month', 'quarter', 'year']).optional(),
    series: zod_1.z
        .array(zod_1.z.object({
        columnId: zod_1.z.string().max(60).nullish().transform((s) => s?.toLowerCase() ?? null),
        aggregation: zod_1.z.enum(['sum', 'avg', 'count', 'count_distinct', 'min', 'max', 'none']),
        label: zod_1.z.string().max(200).nullish(),
    }))
        .min(1)
        .max(24), // e.g. one series per bone part (F3QCPF51 has 14)
    groupByColumnId: zod_1.z.string().max(60).nullish().transform((s) => s?.toLowerCase() ?? null),
    filters: zod_1.z.array(schemas_1.filterSchema).max(20).optional(),
    sort: zod_1.z.enum(['x_asc', 'x_desc', 'value_asc', 'value_desc']).optional(),
    limit: zod_1.z.number().int().min(1).max(500).optional(),
    kind: zod_1.z.enum(['histogram', 'xchart', 'xbar']).nullish(),
    bins: zod_1.z.number().int().min(2).max(100).optional(),
});
const widgetSchema = zod_1.z.object({
    id: zod_1.z.string().max(60).optional(),
    type: zod_1.z.enum(WIDGET_TYPES),
    title: zod_1.z.string().max(300).nullish(),
    x: zod_1.z.number().min(-5000).max(20000),
    y: zod_1.z.number().min(-5000).max(20000),
    w: zod_1.z.number().min(10).max(20000),
    h: zod_1.z.number().min(10).max(20000),
    z: zod_1.z.number().int().min(0).max(100000),
    locked: zod_1.z.boolean().optional(),
    config: zod_1.z.record(zod_1.z.any()).default({}),
    style: zod_1.z.record(zod_1.z.any()).default({}),
    dataSource: zod_1.z.any().nullish(),
});
async function getDashboard(id) {
    const d = await (0, db_1.q1)(`SELECT * FROM Dashboards WHERE dashboard_id = @id`, { id: db_1.T.uuid(id) });
    if (!d)
        throw (0, http_1.notFound)('ไม่พบแดชบอร์ด');
    return d;
}
/** Every dashboard the current user can open (read access to its file) */
router.get('/dashboards', (0, http_1.ah)(async (req, res) => {
    const rows = await (0, db_1.q)(`SELECT d.dashboard_id, d.dashboard_name, d.updated_at, d.file_id, f.file_name, f.folder_id, f.created_by AS file_created_by, f.color AS file_color
       FROM Dashboards d JOIN Files f ON f.file_id = d.file_id
       WHERE f.is_deleted = 0 ORDER BY d.updated_at DESC`);
    const ctx = await permissions_1.PermCtx.load(req.user);
    (0, http_1.ok)(res, rows
        .map((r) => ({ r, level: ctx.fileLevel({ file_id: r.file_id, folder_id: r.folder_id, created_by: r.file_created_by }) }))
        .filter((x) => x.level >= permissions_1.LV.read)
        .map(({ r, level }) => ({
        id: r.dashboard_id, name: r.dashboard_name, updatedAt: r.updated_at, fileId: r.file_id, fileName: r.file_name,
        fileColor: r.file_color, path: ctx.pathText(r.folder_id), canEdit: level >= permissions_1.LV.manage,
    })));
}));
router.get('/files/:fileId/dashboards', (0, http_1.ah)(async (req, res) => {
    const fileId = (0, http_1.pid)(req, 'fileId');
    await (0, permissions_1.requireFile)(req.user, fileId, permissions_1.LV.read);
    const rows = await (0, db_1.q)(`SELECT * FROM Dashboards WHERE file_id = @f ORDER BY sort_order, created_at`, { f: db_1.T.uuid(fileId) });
    (0, http_1.ok)(res, rows.map(mappers_1.mapDashboard));
}));
router.post('/files/:fileId/dashboards', (0, http_1.ah)(async (req, res) => {
    const fileId = (0, http_1.pid)(req, 'fileId');
    await (0, permissions_1.requireFile)(req.user, fileId, permissions_1.LV.manage);
    const { name } = (0, http_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(300) }), req.body);
    const row = await (0, db_1.q1)(`INSERT INTO Dashboards (file_id, dashboard_name, layout_config, background, created_by) OUTPUT inserted.*
       VALUES (@f, @n, @l, @b, @u)`, {
        f: db_1.T.uuid(fileId), n: name, u: db_1.T.uuid(req.user.id),
        l: db_1.T.text(JSON.stringify({ width: 1600, height: 900, gridSize: 10, snap: true })),
        b: db_1.T.text(JSON.stringify({ color: '#F4F6FB', imageUrl: null, fit: 'cover' })),
    });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'dashboard_create', entityType: 'dashboard', entityId: row.dashboard_id, fileId, newValue: { name } }, req);
    (0, http_1.ok)(res, (0, mappers_1.mapDashboard)(row), 201);
}));
router.get('/dashboards/:id', (0, http_1.ah)(async (req, res) => {
    const d = await getDashboard((0, http_1.pid)(req));
    const { file, level } = await (0, permissions_1.requireFile)(req.user, d.file_id, permissions_1.LV.read);
    const widgets = await (0, db_1.q)(`SELECT * FROM DashboardWidgets WHERE dashboard_id = @id ORDER BY z_index`, { id: db_1.T.uuid(d.dashboard_id) });
    const sheets = await (0, db_1.q)(`SELECT * FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: db_1.T.uuid(d.file_id) });
    (0, http_1.ok)(res, {
        dashboard: (0, mappers_1.mapDashboard)(d),
        widgets: widgets.map(mappers_1.mapWidget),
        file: { id: file.file_id, name: file.file_name },
        sheets: sheets.map(mappers_1.mapSheet),
        level,
    });
}));
router.put('/dashboards/:id', (0, http_1.ah)(async (req, res) => {
    const d = await getDashboard((0, http_1.pid)(req));
    await (0, permissions_1.requireFile)(req.user, d.file_id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({
        name: zod_1.z.string().trim().min(1).max(300),
        canvas: zod_1.z.object({ width: zod_1.z.number().min(320).max(10000), height: zod_1.z.number().min(240).max(20000), gridSize: zod_1.z.number().min(2).max(200), snap: zod_1.z.boolean() }),
        background: zod_1.z.object({ color: zod_1.z.string().max(40).nullish(), imageUrl: zod_1.z.string().max(1000).nullish(), fit: zod_1.z.enum(['cover', 'contain', 'repeat']).nullish() }),
        widgets: zod_1.z.array(widgetSchema).max(300),
    }), req.body);
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.q)(`UPDATE Dashboards SET dashboard_name = @n, layout_config = @l, background = @b, updated_at = SYSUTCDATETIME() WHERE dashboard_id = @id`, { n: body.name, l: db_1.T.text(JSON.stringify(body.canvas)), b: db_1.T.text(JSON.stringify(body.background)), id: db_1.T.uuid(d.dashboard_id) }, tx);
        await (0, db_1.q)(`DELETE FROM DashboardWidgets WHERE dashboard_id = @id`, { id: db_1.T.uuid(d.dashboard_id) }, tx);
        for (const w of body.widgets) {
            await (0, db_1.q)(`INSERT INTO DashboardWidgets (widget_id, dashboard_id, widget_type, title, pos_x, pos_y, width, height, z_index, is_locked,
             config, style_config, data_source)
           VALUES (COALESCE(@wid, NEWID()), @d, @t, @ti, @x, @y, @w, @h, @z, @l, @c, @s, @ds)`, {
                wid: db_1.T.uuid(w.id && (0, http_1.isGuid)(w.id) ? w.id.toLowerCase() : null), d: db_1.T.uuid(d.dashboard_id), t: w.type, ti: db_1.T.text(w.title ?? null),
                x: db_1.T.float(w.x), y: db_1.T.float(w.y), w: db_1.T.float(w.w), h: db_1.T.float(w.h), z: db_1.T.int(w.z), l: db_1.T.bit(!!w.locked),
                c: db_1.T.text(JSON.stringify(w.config ?? {})), s: db_1.T.text(JSON.stringify(w.style ?? {})),
                ds: db_1.T.text(w.dataSource ? JSON.stringify(w.dataSource) : null),
            }, tx);
        }
        await (0, audit_1.audit)({ userId: req.user.id, action: 'dashboard_update', entityType: 'dashboard', entityId: d.dashboard_id, fileId: d.file_id,
            newValue: { name: body.name, widgets: body.widgets.length } }, req, tx);
    });
    (0, http_1.ok)(res, { saved: true, updatedAt: new Date().toISOString() });
}));
router.delete('/dashboards/:id', (0, http_1.ah)(async (req, res) => {
    const d = await getDashboard((0, http_1.pid)(req));
    await (0, permissions_1.requireFile)(req.user, d.file_id, permissions_1.LV.manage);
    await (0, db_1.q)(`DELETE FROM Dashboards WHERE dashboard_id = @id`, { id: db_1.T.uuid(d.dashboard_id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'dashboard_delete', entityType: 'dashboard', entityId: d.dashboard_id, fileId: d.file_id,
        oldValue: { name: d.dashboard_name } }, req);
    (0, http_1.ok)(res, { deleted: true });
}));
router.post('/dashboards/data', (0, http_1.ah)(async (req, res) => {
    const { dataSource } = (0, http_1.parse)(zod_1.z.object({ dataSource: dataSourceSchema }), req.body);
    (0, http_1.ok)(res, await (0, widgetData_1.computeWidgetData)(req.user, dataSource));
}));
exports.default = router;
//# sourceMappingURL=dashboards.js.map