import { Router } from 'express';
import { z } from 'zod';
import { q, q1, T } from '../../config/db';
import { ah, badRequest, notFound, ok, parse, pid, zId } from '../../shared/http';
import { LV, requireFile } from '../../shared/permissions';

/**
 * "รับทราบ" on a records widget (Quality Highlight): an employee picked from a drop-down presses รับทราบ on an item; the daily
 * summary lists who read which items. Anyone who can open the dashboard (read access to its file) can read and acknowledge.
 * The employee list = active DocHUB users, or only the members of the tag set in the widget (config.ackTagId).
 */
const router = Router();

async function widgetOf(req: any) {
  const dashId = pid(req, 'dashId'), wid = pid(req, 'wid');
  const w = await q1(`SELECT w.widget_id, w.config, w.data_source, d.dashboard_id, d.file_id FROM DashboardWidgets w JOIN Dashboards d ON d.dashboard_id = w.dashboard_id
                      WHERE w.widget_id = @w AND d.dashboard_id = @d AND w.widget_type = N'records'`, { w: T.uuid(wid), d: T.uuid(dashId) });
  if (!w) throw notFound('ไม่พบวิดเจ็ต');
  await requireFile(req.user!, w.file_id, LV.read);
  let cfg: any = {};
  try { cfg = JSON.parse(w.config ?? '{}'); } catch { /* keep {} */ }
  let ds: any = {};
  try { ds = JSON.parse(w.data_source ?? '{}'); } catch { /* keep {} */ }
  return { ...w, cfg, sheetId: ds?.sheetId as string | undefined };
}

router.get('/dashboards/:dashId/widgets/:wid/ack-people', ah(async (req, res) => {
  const w = await widgetOf(req);
  const tag = w.cfg?.ackTagId ? String(w.cfg.ackTagId) : null;
  const rows = await q(`
    SELECT u.user_id, u.display_name FROM Users u
    WHERE u.is_active = 1 AND (@t IS NULL OR EXISTS (SELECT 1 FROM UserTagsAll ut WHERE ut.user_id = u.user_id AND ut.tag_id = @t))
    ORDER BY u.display_name`, { t: T.uuid(tag) });
  ok(res, rows.map((r: any) => ({ id: r.user_id, name: r.display_name })));
}));

router.post('/dashboards/:dashId/widgets/:wid/acks', ah(async (req, res) => {
  const w = await widgetOf(req);
  if (!w.cfg?.ack) throw badRequest('วิดเจ็ตนี้ไม่ได้เปิดปุ่มรับทราบ');
  const b = parse(z.object({ rowId: zId, rowLabel: z.string().trim().max(400).optional(), employeeId: zId }), req.body);
  const emp = await q1(`SELECT user_id, display_name FROM Users WHERE user_id = @u AND is_active = 1`, { u: T.uuid(b.employeeId) });
  if (!emp) throw badRequest('ไม่พบชื่อพนักงาน');
  const row = await q1(`SELECT r.row_id, r.sheet_id FROM Rows r WHERE r.row_id = @r AND r.is_deleted = 0 ${w.sheetId ? 'AND r.sheet_id = @s' : ''}`, { r: T.uuid(b.rowId), s: T.uuid(w.sheetId ?? null) });
  if (!row) throw notFound('ไม่พบรายการ');
  const out = await q1(`INSERT INTO WidgetAcks (dashboard_id, widget_id, sheet_id, row_id, row_label, employee_id, employee_name, acked_by)
                        OUTPUT inserted.ack_id, inserted.acked_at VALUES (@d, @w, @s, @r, @l, @e, @n, @by)`, {
    d: T.uuid(w.dashboard_id), w: T.uuid(w.widget_id), s: T.uuid(row.sheet_id), r: T.uuid(b.rowId), l: T.text(b.rowLabel ?? null),
    e: T.uuid(emp.user_id), n: emp.display_name, by: T.uuid(req.user!.id),
  });
  ok(res, { id: out!.ack_id, at: out!.acked_at, employeeName: emp.display_name }, 201);
}));

const mapAck = (r: any) => ({ id: r.ack_id, rowId: r.row_id, rowLabel: r.row_label, employeeId: r.employee_id, employeeName: r.employee_name, at: r.acked_at, by: r.by_name ?? null });

/** ?rowId= → the acknowledgements of one item (newest first) · ?date=YYYY-MM-DD → every acknowledgement of that day (Thai time) */
router.get('/dashboards/:dashId/widgets/:wid/acks', ah(async (req, res) => {
  const w = await widgetOf(req);
  const rowId = typeof req.query.rowId === 'string' ? req.query.rowId : null;
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;
  if (!rowId && !date) throw badRequest('ระบุ rowId หรือ date');
  const rows = await q(`
    SELECT TOP 2000 a.ack_id, a.row_id, a.row_label, a.employee_id, a.employee_name, a.acked_at, u.display_name AS by_name
    FROM WidgetAcks a LEFT JOIN Users u ON u.user_id = a.acked_by
    WHERE a.widget_id = @w
      ${rowId ? 'AND a.row_id = @r' : ''}
      ${date ? "AND CAST(DATEADD(HOUR, 7, a.acked_at) AS DATE) = @d" : ''}
    ORDER BY a.acked_at DESC`, { w: T.uuid(w.widget_id), r: T.uuid(rowId), d: date });
  ok(res, rows.map(mapAck));
}));

export default router;
