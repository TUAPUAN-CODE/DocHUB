"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
/**
 * "รับทราบ" on a records widget (Quality Highlight): an employee picked from a drop-down presses รับทราบ on an item; the daily
 * summary lists who read which items. Anyone who can open the dashboard (read access to its file) can read and acknowledge.
 * The employee list = active DocHUB users, or only the members of the tag set in the widget (config.ackTagId).
 */
const router = (0, express_1.Router)();
async function widgetOf(req) {
    const dashId = (0, http_1.pid)(req, 'dashId'), wid = (0, http_1.pid)(req, 'wid');
    const w = await (0, db_1.q1)(`SELECT w.widget_id, w.config, w.data_source, d.dashboard_id, d.file_id FROM DashboardWidgets w JOIN Dashboards d ON d.dashboard_id = w.dashboard_id
                      WHERE w.widget_id = @w AND d.dashboard_id = @d AND w.widget_type = N'records'`, { w: db_1.T.uuid(wid), d: db_1.T.uuid(dashId) });
    if (!w)
        throw (0, http_1.notFound)('ไม่พบวิดเจ็ต');
    await (0, permissions_1.requireFile)(req.user, w.file_id, permissions_1.LV.read);
    let cfg = {};
    try {
        cfg = JSON.parse(w.config ?? '{}');
    }
    catch { /* keep {} */ }
    let ds = {};
    try {
        ds = JSON.parse(w.data_source ?? '{}');
    }
    catch { /* keep {} */ }
    return { ...w, cfg, sheetId: ds?.sheetId };
}
router.get('/dashboards/:dashId/widgets/:wid/ack-people', (0, http_1.ah)(async (req, res) => {
    const w = await widgetOf(req);
    const tag = w.cfg?.ackTagId ? String(w.cfg.ackTagId) : null;
    const rows = await (0, db_1.q)(`
    SELECT u.user_id, u.display_name FROM Users u
    WHERE u.is_active = 1 AND (@t IS NULL OR EXISTS (SELECT 1 FROM UserTagsAll ut WHERE ut.user_id = u.user_id AND ut.tag_id = @t))
    ORDER BY u.display_name`, { t: db_1.T.uuid(tag) });
    (0, http_1.ok)(res, rows.map((r) => ({ id: r.user_id, name: r.display_name })));
}));
router.post('/dashboards/:dashId/widgets/:wid/acks', (0, http_1.ah)(async (req, res) => {
    const w = await widgetOf(req);
    if (!w.cfg?.ack)
        throw (0, http_1.badRequest)('วิดเจ็ตนี้ไม่ได้เปิดปุ่มรับทราบ');
    const b = (0, http_1.parse)(zod_1.z.object({ rowId: http_1.zId, rowLabel: zod_1.z.string().trim().max(400).optional(), employeeId: http_1.zId }), req.body);
    const emp = await (0, db_1.q1)(`SELECT user_id, display_name FROM Users WHERE user_id = @u AND is_active = 1`, { u: db_1.T.uuid(b.employeeId) });
    if (!emp)
        throw (0, http_1.badRequest)('ไม่พบชื่อพนักงาน');
    const row = await (0, db_1.q1)(`SELECT r.row_id, r.sheet_id FROM Rows r WHERE r.row_id = @r AND r.is_deleted = 0 ${w.sheetId ? 'AND r.sheet_id = @s' : ''}`, { r: db_1.T.uuid(b.rowId), s: db_1.T.uuid(w.sheetId ?? null) });
    if (!row)
        throw (0, http_1.notFound)('ไม่พบรายการ');
    const out = await (0, db_1.q1)(`INSERT INTO WidgetAcks (dashboard_id, widget_id, sheet_id, row_id, row_label, employee_id, employee_name, acked_by)
                        OUTPUT inserted.ack_id, inserted.acked_at VALUES (@d, @w, @s, @r, @l, @e, @n, @by)`, {
        d: db_1.T.uuid(w.dashboard_id), w: db_1.T.uuid(w.widget_id), s: db_1.T.uuid(row.sheet_id), r: db_1.T.uuid(b.rowId), l: db_1.T.text(b.rowLabel ?? null),
        e: db_1.T.uuid(emp.user_id), n: emp.display_name, by: db_1.T.uuid(req.user.id),
    });
    (0, http_1.ok)(res, { id: out.ack_id, at: out.acked_at, employeeName: emp.display_name }, 201);
}));
const mapAck = (r) => ({ id: r.ack_id, rowId: r.row_id, rowLabel: r.row_label, employeeId: r.employee_id, employeeName: r.employee_name, at: r.acked_at, by: r.by_name ?? null });
/** ?rowId= → the acknowledgements of one item (newest first) · ?date=YYYY-MM-DD → every acknowledgement of that day (Thai time) */
router.get('/dashboards/:dashId/widgets/:wid/acks', (0, http_1.ah)(async (req, res) => {
    const w = await widgetOf(req);
    const rowId = typeof req.query.rowId === 'string' ? req.query.rowId : null;
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;
    if (!rowId && !date)
        throw (0, http_1.badRequest)('ระบุ rowId หรือ date');
    const rows = await (0, db_1.q)(`
    SELECT TOP 2000 a.ack_id, a.row_id, a.row_label, a.employee_id, a.employee_name, a.acked_at, u.display_name AS by_name
    FROM WidgetAcks a LEFT JOIN Users u ON u.user_id = a.acked_by
    WHERE a.widget_id = @w
      ${rowId ? 'AND a.row_id = @r' : ''}
      ${date ? "AND CAST(DATEADD(HOUR, 7, a.acked_at) AS DATE) = @d" : ''}
    ORDER BY a.acked_at DESC`, { w: db_1.T.uuid(w.widget_id), r: db_1.T.uuid(rowId), d: date });
    (0, http_1.ok)(res, rows.map(mapAck));
}));
exports.default = router;
//# sourceMappingURL=routes.js.map