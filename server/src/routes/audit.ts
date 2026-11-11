import { Router } from 'express';
import { isAdminRole, isBasicRole } from '../middleware/auth';
import { jsonParam, q, q1, T } from '../config/db';
import { ah, isGuid, likeEscape, ok, pageParams, safeJson } from '../shared/http';
import { LV, PermCtx, requireFile } from '../shared/permissions';

const router = Router();

router.get(
  '/audit',
  ah(async (req, res) => {
    const u = req.user!;
    const { page, pageSize, offset } = pageParams(req.query, 30, 200);
    const where: string[] = ['1 = 1'];
    const p: Record<string, unknown> = {};
    const qs = req.query as Record<string, string | undefined>;

    if (qs.fileId && isGuid(qs.fileId)) {
      const fileId = qs.fileId.toLowerCase();
      if (!isAdminRole(u.role)) await requireFile(u, fileId, LV.manage);
      where.push('a.file_id = @file');
      p.file = T.uuid(fileId);
    } else if (isBasicRole(u.role)) {
      where.push('a.user_id = @me');
      p.me = T.uuid(u.id);
    } else if (u.role === 'master') {
      const ctx = await PermCtx.load(u);
      const files = await q(`SELECT file_id, folder_id, created_by FROM Files`);
      const manageable = files.filter((f) => ctx.fileLevel(f) >= LV.manage).map((f) => f.file_id);
      where.push(`(a.user_id = @me OR a.file_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@mf)))`);
      p.me = T.uuid(u.id);
      p.mf = jsonParam(manageable);
    }
    if (qs.sheetId && isGuid(qs.sheetId)) {
      where.push('a.sheet_id = @sheet');
      p.sheet = T.uuid(qs.sheetId);
    }
    if (qs.userId && isGuid(qs.userId)) {
      where.push('a.user_id = @uid');
      p.uid = T.uuid(qs.userId);
    }
    if (qs.action) {
      const actions = qs.action.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);
      where.push(`a.action_type IN (SELECT [value] FROM OPENJSON(@acts))`);
      p.acts = jsonParam(actions);
    }
    if (qs.from) {
      where.push('a.created_at >= @from');
      p.from = T.dt(qs.from);
    }
    if (qs.to) {
      where.push('a.created_at <= @to');
      p.to = T.dt(qs.to);
    }
    if (qs.search?.trim()) {
      where.push('(a.new_value LIKE @s OR a.old_value LIKE @s OR f.file_name LIKE @s OR u.display_name LIKE @s)');
      p.s = `%${likeEscape(qs.search.trim())}%`;
    }
    const from = `FROM AuditLog a JOIN Users u ON u.user_id = a.user_id
      LEFT JOIN Files f ON f.file_id = a.file_id LEFT JOIN Sheets s ON s.sheet_id = a.sheet_id
      WHERE ${where.join(' AND ')}`;
    const count = await q1(`SELECT COUNT(*) AS n ${from}`, p);
    const rows = await q(
      `SELECT a.log_id, a.user_id, u.display_name, u.avatar_url, a.action_type, a.entity_type, a.entity_id, a.file_id, f.file_name,
         a.sheet_id, s.sheet_name, a.old_value, a.new_value, a.ip_address, a.created_at
       ${from} ORDER BY a.log_id DESC OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`,
      p,
    );
    ok(res, {
      items: rows.map((r) => ({
        id: Number(r.log_id),
        userId: r.user_id,
        userName: r.display_name,
        avatarUrl: r.avatar_url,
        action: r.action_type,
        entityType: r.entity_type,
        entityId: r.entity_id,
        fileId: r.file_id,
        fileName: r.file_name,
        sheetId: r.sheet_id,
        sheetName: r.sheet_name,
        oldValue: safeJson(r.old_value, null),
        newValue: safeJson(r.new_value, null),
        ip: r.ip_address,
        at: r.created_at,
      })),
      total: Number(count?.n ?? 0),
      page,
      pageSize,
    });
  }),
);

export default router;
