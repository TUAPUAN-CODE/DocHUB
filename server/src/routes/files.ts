import crypto from 'crypto';
import { Request, Router } from 'express';
import { isBasicRole } from '../middleware/auth';
import { z } from 'zod';
import { q, q1, T, withTx, Tx } from '../config/db';
import { audit } from '../shared/audit';
import { ah, AppError, badRequest, forbidden, likeEscape, notFound, ok, parse, pid, zColor, zId } from '../shared/http';
import { mapFile, mapSheet } from '../shared/mappers';
import { LV, PermCtx, requireFile, requireFolder } from '../shared/permissions';
import { sheetInput } from '../shared/schemas';
import { assertUniqueNames, insertColumn } from '../services/structure';
import { parseTemplates, remapTemplates, sheetsOfFile } from '../services/pdfTemplates';
import { runAfterSheetCopied } from '../services/hooks';
import { FILES_SQL, favoriteSet } from './folders';

const router = Router();

const permEnum = z.enum(['read', 'write', 'manage']);
const fileMeta = z.object({
  name: z.string().trim().min(1, 'กรุณาตั้งชื่อไฟล์').max(300),
  description: z.string().max(2000).nullish(),
  color: zColor.nullish(),
  icon: z.string().max(100).nullish(),
});

router.get(
  '/files/accessible',
  ah(async (req, res) => {
    const s = String(req.query.q ?? '').trim();
    const ctx = await PermCtx.load(req.user!);
    const rows = await q(
      `SELECT TOP 500 f.file_id, f.file_name, f.folder_id, f.created_by, f.color, f.updated_at FROM Files f
       WHERE f.is_deleted = 0 ${s ? 'AND f.file_name LIKE @s' : ''} ORDER BY f.updated_at DESC`,
      { s: `%${likeEscape(s)}%` },
    );
    ok(
      res,
      rows
        .filter((f) => ctx.fileLevel(f) >= LV.read)
        .slice(0, 100)
        .map((f) => ({ id: f.file_id, name: f.file_name, color: f.color, folderId: f.folder_id, path: ctx.pathText(f.folder_id) })),
    );
  }),
);

router.get(
  '/files/:id',
  ah(async (req, res) => {
    const id = pid(req);
    const u = req.user!;
    let level: number;
    let ctx: PermCtx;
    try {
      ({ level, ctx } = await requireFile(u, id, LV.read));
    } catch (e) {
      if (e instanceof AppError && e.code === 'NO_ACCESS') {
        const pending = await q1(
          `SELECT TOP 1 request_id, permission, created_at FROM AccessRequests
           WHERE file_id = @f AND requester_id = @u AND status = 'pending' ORDER BY created_at DESC`,
          { f: T.uuid(id), u: T.uuid(u.id) },
        );
        e.details = { ...(e.details as object), pending: pending ? { id: pending.request_id, permission: pending.permission, createdAt: pending.created_at } : null };
      }
      throw e;
    }
    const [file] = await q(`${FILES_SQL} WHERE f.file_id = @id`, { id: T.uuid(id) });
    const sheets = await q(`SELECT * FROM Sheets WHERE file_id = @id AND is_deleted = 0 ORDER BY sort_order, created_at`, { id: T.uuid(id) });
    const dashboards = await q(
      `SELECT dashboard_id, dashboard_name, updated_at FROM Dashboards WHERE file_id = @id ORDER BY sort_order, created_at`,
      { id: T.uuid(id) },
    );
    await q(
      `MERGE RecentFiles AS t USING (SELECT @u AS user_id, @f AS file_id) AS s
       ON t.user_id = s.user_id AND t.file_id = s.file_id
       WHEN MATCHED THEN UPDATE SET viewed_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (user_id, file_id) VALUES (s.user_id, s.file_id);`,
      { u: T.uuid(u.id), f: T.uuid(id) },
    );
    const favs = await favoriteSet(u.id, 'file');
    ok(res, {
      file: mapFile(file, level, favs.has(id)),
      breadcrumb: ctx.path(file.folder_id).map((n) => ({ id: n.id, name: n.name })),
      sheets: sheets.map(mapSheet),
      dashboards: dashboards.map((d) => ({ id: d.dashboard_id, name: d.dashboard_name, updatedAt: d.updated_at })),
      level,
    });
  }),
);

const createSchema = fileMeta.extend({
  folderId: zId,
  sheets: z.array(sheetInput).min(1, 'ต้องมีอย่างน้อย 1 ชีต').max(50),
  access: z
    .array(z.object({ userId: zId, permission: permEnum, expiresAt: z.string().datetime().nullish() }))
    .max(500)
    .default([]),
});

router.post(
  '/files',
  ah(async (req, res) => {
    const u = req.user!;
    if (isBasicRole(u.role)) throw forbidden('เฉพาะ Master หรือ Admin เท่านั้นที่สร้างไฟล์ได้');
    const body = parse(createSchema, req.body);
    await requireFolder(u, body.folderId, LV.write);
    assertUniqueNames(body.sheets.map((s) => s.name), 'ชีต');
    body.sheets.forEach((s) => assertUniqueNames(s.columns.map((c) => c.name)));
    if (body.sheets.some((s) => !s.columns.length)) throw badRequest('ทุกชีตต้องมีคอลัมน์อย่างน้อย 1 คอลัมน์');

    const fileId = await withTx(async (tx) => {
      const f = await q1(
        `INSERT INTO Files (file_name, folder_id, description, color, icon, created_by) OUTPUT inserted.file_id
         VALUES (@n, @fo, @d, COALESCE(@c, N'#16A34A'), COALESCE(@i, N'sheet'), @u)`,
        { n: body.name, fo: T.uuid(body.folderId), d: T.text(body.description ?? null), c: T.text(body.color ?? null), i: T.text(body.icon ?? null), u: T.uuid(u.id) },
        tx,
      );
      const fid = f!.file_id as string;
      for (const [si, s] of body.sheets.entries()) {
        const sh = await q1(
          `INSERT INTO Sheets (file_id, sheet_name, sort_order, tab_color, created_by) OUTPUT inserted.sheet_id VALUES (@f, @n, @o, @c, @u)`,
          { f: T.uuid(fid), n: s.name, o: T.int(si), c: T.text(s.tabColor ?? null), u: T.uuid(u.id) },
          tx,
        );
        for (const [ci, c] of s.columns.entries()) await insertColumn(tx, sh!.sheet_id, c, ci, u.id);
      }
      for (const a of body.access) {
        if (a.userId === u.id) continue;
        await q(
          `INSERT INTO FileAccess (file_id, user_id, permission, granted_by, expires_at) VALUES (@f, @u, @p, @by, @e)`,
          { f: T.uuid(fid), u: T.uuid(a.userId), p: a.permission, by: T.uuid(u.id), e: T.dt(a.expiresAt ?? null) },
          tx,
        );
      }
      await audit({ userId: u.id, action: 'file_create', entityType: 'file', entityId: fid, fileId: fid,
        newValue: { name: body.name, sheets: body.sheets.map((s) => ({ name: s.name, columns: s.columns.length })) } }, req, tx);
      return fid;
    });
    ok(res, { id: fileId }, 201);
  }),
);

router.put(
  '/files/:id',
  ah(async (req, res) => {
    const id = pid(req);
    const { file } = await requireFile(req.user!, id, LV.manage);
    const body = parse(fileMeta.partial().extend({ status: z.enum(['active', 'archived']).optional() }), req.body);
    await q(
      `UPDATE Files SET file_name = COALESCE(@n, file_name), description = CASE WHEN @hasD = 1 THEN @d ELSE description END,
         color = COALESCE(@c, color), icon = COALESCE(@i, icon), status = COALESCE(@st, status), updated_at = SYSUTCDATETIME()
       WHERE file_id = @id`,
      { n: T.text(body.name ?? null), hasD: body.description !== undefined, d: T.text(body.description ?? null), c: T.text(body.color ?? null),
        i: T.text(body.icon ?? null), st: T.text(body.status ?? null), id: T.uuid(id) },
    );
    await audit({ userId: req.user!.id, action: 'file_update', entityType: 'file', entityId: id, fileId: id,
      oldValue: { name: file.file_name, status: file.status }, newValue: body }, req);
    ok(res, { updated: true });
  }),
);

router.post(
  '/files/:id/move',
  ah(async (req, res) => {
    const id = pid(req);
    const u = req.user!;
    const { file } = await requireFile(u, id, LV.manage);
    const { folderId } = parse(z.object({ folderId: zId }), req.body);
    await requireFolder(u, folderId, LV.write);
    await q(`UPDATE Files SET folder_id = @fo, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { fo: T.uuid(folderId), id: T.uuid(id) });
    await audit({ userId: u.id, action: 'file_move', entityType: 'file', entityId: id, fileId: id,
      oldValue: { folderId: file.folder_id }, newValue: { folderId } }, req);
    ok(res, { moved: true });
  }),
);

async function copySheet(tx: Tx, oldSheetId: string, newFileId: string, order: number, userId: string, includeData: boolean, name?: string) {
  const s = await q1(`SELECT * FROM Sheets WHERE sheet_id = @s`, { s: T.uuid(oldSheetId) }, tx);
  const ns = await q1(
    `INSERT INTO Sheets (file_id, sheet_name, sort_order, tab_color, created_by) OUTPUT inserted.sheet_id VALUES (@f, @n, @o, @c, @u)`,
    { f: T.uuid(newFileId), n: name ?? s!.sheet_name, o: T.int(order), c: T.text(s!.tab_color), u: T.uuid(userId) },
    tx,
  );
  const newSheetId = ns!.sheet_id as string;
  const colMap = await q(
    `MERGE INTO Columns AS t
     USING (SELECT * FROM Columns WHERE sheet_id = @old AND is_deleted = 0) AS src ON 1 = 0
     WHEN NOT MATCHED THEN INSERT (sheet_id, column_name, data_type, display_order, width, is_required, default_value, placeholder,
       validation_rule, select_options, description, created_by)
     VALUES (@new, src.column_name, src.data_type, src.display_order, src.width, src.is_required, src.default_value, src.placeholder,
       src.validation_rule, src.select_options, src.description, @u)
     OUTPUT src.column_id AS old_id, inserted.column_id AS new_id;`,
    { old: T.uuid(oldSheetId), new: T.uuid(newSheetId), u: T.uuid(userId) },
    tx,
  );
  await runAfterSheetCopied({ tx, oldSheetId, newSheetId, columnMap: colMap as { old_id: string; new_id: string }[] });
  if (includeData) {
    await q(
      `DECLARE @rm TABLE (old_id UNIQUEIDENTIFIER, new_id UNIQUEIDENTIFIER);
       MERGE INTO Rows AS t
       USING (SELECT row_id, row_order FROM Rows WHERE sheet_id = @old AND is_deleted = 0) AS src ON 1 = 0
       WHEN NOT MATCHED THEN INSERT (sheet_id, row_order, created_by, updated_by) VALUES (@new, src.row_order, @u, @u)
       OUTPUT src.row_id, inserted.row_id INTO @rm;
       INSERT INTO Cells (row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json, updated_by)
       SELECT rm.new_id, cm.new_id, c.value_text, c.value_int, c.value_float, c.value_date, c.value_bool, c.value_json, @u
       FROM Cells c JOIN @rm rm ON rm.old_id = c.row_id
       JOIN OPENJSON(@cm) WITH (old_id UNIQUEIDENTIFIER, new_id UNIQUEIDENTIFIER) cm ON cm.old_id = c.column_id;`,
      { old: T.uuid(oldSheetId), new: T.uuid(newSheetId), u: T.uuid(userId), cm: T.text(JSON.stringify(colMap)) },
      tx,
    );
  }
  return newSheetId;
}

/** Copies a file (sheets with columns / formulas / settings, PDF layouts) into `folderId`; permissions of the caller are checked by the caller */
export async function duplicateFile(u: { id: string }, file: any, folderId: string, name: string, includeData: boolean, req?: Request): Promise<string> {
  const id = file.file_id as string;
  return withTx(async (tx) => {
    const f = await q1(
      `INSERT INTO Files (file_name, folder_id, description, color, icon, created_by) OUTPUT inserted.file_id
       VALUES (@n, @fo, @d, @c, @i, @u)`,
      { n: name, fo: T.uuid(folderId), d: T.text(file.description), c: file.color, i: file.icon, u: T.uuid(u.id) },
      tx,
    );
    const sheets = await q(`SELECT sheet_id FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: T.uuid(id) }, tx);
    for (const [i, s] of sheets.entries()) await copySheet(tx, s.sheet_id, f!.file_id, i, u.id, includeData);
    // PDF layouts travel with the file (a file that follows a master keeps following it)
    if (file.pdf_master_id) await q(`UPDATE Files SET pdf_master_id = @m WHERE file_id = @f`, { m: T.uuid(file.pdf_master_id), f: T.uuid(f!.file_id) }, tx);
    const tpls = parseTemplates(file.pdf_templates);
    if (tpls.length) {
      const mapped = remapTemplates(tpls, await sheetsOfFile(id, tx), await sheetsOfFile(f!.file_id, tx), false);
      await q(`UPDATE Files SET pdf_templates = @t WHERE file_id = @f`, { t: T.text(JSON.stringify(mapped)), f: T.uuid(f!.file_id) }, tx);
    }
    await audit({ userId: u.id, action: 'file_duplicate', entityType: 'file', entityId: f!.file_id, fileId: f!.file_id, newValue: { sourceFileId: id, includeData } }, req, tx);
    return f!.file_id as string;
  });
}

router.post(
  '/files/:id/duplicate',
  ah(async (req, res) => {
    const id = pid(req);
    const u = req.user!;
    if (isBasicRole(u.role)) throw forbidden('เฉพาะ Master หรือ Admin เท่านั้นที่ทำสำเนาไฟล์ได้');
    const { file } = await requireFile(u, id, LV.read);
    const body = parse(z.object({ name: z.string().trim().min(1).max(300).optional(), folderId: zId.optional(), includeData: z.boolean().default(false) }), req.body);
    const folderId = body.folderId ?? file.folder_id;
    await requireFolder(u, folderId, LV.write);
    const newId = await duplicateFile(u, file, folderId, body.name ?? `${file.file_name} (สำเนา)`, body.includeData, req);
    ok(res, { id: newId }, 201);
  }),
);

router.delete(
  '/files/:id',
  ah(async (req, res) => {
    const id = pid(req);
    const { file } = await requireFile(req.user!, id, LV.manage);
    await q(
      `UPDATE Files SET is_deleted = 1, deleted_at = SYSUTCDATETIME(), deleted_by = @u, delete_batch = @b WHERE file_id = @id`,
      { u: T.uuid(req.user!.id), b: T.uuid(crypto.randomUUID()), id: T.uuid(id) },
    );
    await audit({ userId: req.user!.id, action: 'file_delete', entityType: 'file', entityId: id, fileId: id, oldValue: { name: file.file_name } }, req);
    ok(res, { deleted: true });
  }),
);

export { copySheet };
export default router;
