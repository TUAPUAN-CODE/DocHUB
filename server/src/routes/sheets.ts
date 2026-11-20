import { Router } from 'express';
import { z } from 'zod';
import { q, q1, T, withTx } from '../config/db';
import { audit } from '../shared/audit';
import { ah, badRequest, conflict, ok, parse, pid, safeJson, zColor, zId } from '../shared/http';
import { mapColumn, mapSheet } from '../shared/mappers';
import { LV, levelName, requireFile, requireSheet } from '../shared/permissions';
import { loadColumns } from '../services/cellWriter';
import { assertUniqueNames, insertColumn } from '../services/structure';
import { filterSchema, sheetInput, sortSchema } from '../shared/schemas';
import { copySheet } from './files';
import { syncUnionIfStale, unionStatus } from '../services/union';
import { runColumnDecorators } from '../services/hooks';

const router = Router();

export const DEFAULT_PREFS = {
  zoom: 1,
  frozenCols: 0,
  frozenRows: 0,
  colWidths: {} as Record<string, number>,
  rowHeights: {} as Record<string, number>,
  hiddenCols: [] as string[],
  rowHeight: 34,
  pageSize: 100,
};

router.get(
  '/sheets/:id',
  ah(async (req, res) => {
    const id = pid(req);
    const { sheet, level } = await requireSheet(req.user!, id, LV.read);
    const cols = await loadColumns(id, null, level >= LV.manage);
    const prefsRow = await q1(`SELECT prefs_json FROM UserSheetPrefs WHERE user_id = @u AND sheet_id = @s`, { u: T.uuid(req.user!.id), s: T.uuid(id) });
    const union = await unionStatus(sheet);
    if (union) syncUnionIfStale(sheet);
    const columnsOut = cols.filter((c) => !c.is_deleted).map(mapColumn);
    if (level >= LV.manage) await runColumnDecorators({ user: req.user!, sheetId: id, columns: columnsOut as { id: string; validation: Record<string, any> }[] });
    ok(res, {
      union,
      settings: safeJson(sheet.settings_json, {}) ?? {},
      sheet: mapSheet(sheet),
      file: { id: sheet.file_id, name: sheet.file_name, folderId: sheet.folder_id },
      level,
      permission: levelName(level),
      columns: columnsOut,
      deletedColumns: cols.filter((c) => c.is_deleted).map(mapColumn),
      prefs: { ...DEFAULT_PREFS, ...safeJson(prefsRow?.prefs_json, {}) },
    });
  }),
);

router.put(
  '/sheets/:id/prefs',
  ah(async (req, res) => {
    const id = pid(req);
    await requireSheet(req.user!, id, LV.read);
    const prefs = parse(
      z.object({
        zoom: z.number().min(0.25).max(3).optional(),
        frozenCols: z.number().int().min(0).max(50).optional(),
        frozenRows: z.number().int().min(0).max(50).optional(),
        colWidths: z.record(z.number().min(30).max(2000)).optional(),
        rowHeights: z.record(z.number().min(18).max(600)).optional(),
        hiddenCols: z.array(z.string().max(60)).max(500).optional(),
        rowHeight: z.number().min(20).max(200).optional(),
        pageSize: z.number().int().min(10).max(1000).optional(),
        query: z.object({ sorts: z.array(sortSchema).max(5), filters: z.array(filterSchema).max(50) }).optional(),
      }),
      req.body,
    );
    const json = JSON.stringify(prefs);
    if (json.length > 200_000) throw badRequest('ข้อมูลการตั้งค่ามีขนาดใหญ่เกินไป');
    await q(
      `MERGE UserSheetPrefs AS t USING (SELECT @u AS user_id, @s AS sheet_id) AS s
       ON t.user_id = s.user_id AND t.sheet_id = s.sheet_id
       WHEN MATCHED THEN UPDATE SET prefs_json = @j, updated_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (user_id, sheet_id, prefs_json) VALUES (s.user_id, s.sheet_id, @j);`,
      { u: T.uuid(req.user!.id), s: T.uuid(id), j: T.text(json) },
    );
    ok(res, { ...DEFAULT_PREFS, ...prefs });
  }),
);

router.post(
  '/files/:fileId/sheets',
  ah(async (req, res) => {
    const fileId = pid(req, 'fileId');
    const u = req.user!;
    await requireFile(u, fileId, LV.manage);
    const body = parse(sheetInput.extend({ copyStructureFrom: zId.nullish() }), req.body);
    const exists = await q1(`SELECT 1 AS x FROM Sheets WHERE file_id = @f AND is_deleted = 0 AND sheet_name = @n`, { f: T.uuid(fileId), n: body.name });
    if (exists) throw conflict('มีชีตชื่อนี้อยู่แล้ว');
    assertUniqueNames(body.columns.map((c) => c.name));
    const order = await q1(`SELECT ISNULL(MAX(sort_order), -1) + 1 AS o FROM Sheets WHERE file_id = @f`, { f: T.uuid(fileId) });
    const sheetId = await withTx(async (tx) => {
      if (body.copyStructureFrom) {
        const src = await q1(`SELECT file_id FROM Sheets WHERE sheet_id = @s AND is_deleted = 0`, { s: T.uuid(body.copyStructureFrom) }, tx);
        if (!src || src.file_id !== fileId) throw badRequest('ชีตต้นแบบไม่ถูกต้อง');
        return copySheet(tx, body.copyStructureFrom, fileId, order!.o, u.id, false, body.name);
      }
      const sh = await q1(
        `INSERT INTO Sheets (file_id, sheet_name, sort_order, tab_color, created_by) OUTPUT inserted.sheet_id VALUES (@f, @n, @o, @c, @u)`,
        { f: T.uuid(fileId), n: body.name, o: T.int(order!.o), c: T.text(body.tabColor ?? null), u: T.uuid(u.id) },
        tx,
      );
      const cols = body.columns.length ? body.columns : [{ name: 'คอลัมน์ 1', dataType: 'varchar' as const, isRequired: false, width: 180 }];
      for (const [i, c] of cols.entries()) await insertColumn(tx, sh!.sheet_id, c, i, u.id);
      return sh!.sheet_id as string;
    });
    await audit({ userId: u.id, action: 'sheet_create', entityType: 'sheet', entityId: sheetId, fileId, sheetId, newValue: { name: body.name } }, req);
    const s = await q1(`SELECT * FROM Sheets WHERE sheet_id = @s`, { s: T.uuid(sheetId) });
    ok(res, mapSheet(s), 201);
  }),
);

/** Sheet-level settings (managers): which columns get a button in the filter / sort bar above the table */
router.put(
  '/sheets/:id/settings',
  ah(async (req, res) => {
    const id = pid(req);
    const { sheet } = await requireSheet(req.user!, id, LV.manage, undefined, true);
    const body = parse(z.object({ filterColumns: z.array(zId).max(1000).nullable().optional(), singleRow: z.boolean().optional() }), req.body);
    const settings: Record<string, unknown> = { ...(safeJson<Record<string, unknown>>(sheet.settings_json, {}) ?? {}) };
    if (body.filterColumns !== undefined) settings.filterColumns = body.filterColumns;
    if (body.singleRow !== undefined) { if (body.singleRow) settings.singleRow = true; else delete settings.singleRow; }
    await q(`UPDATE Sheets SET settings_json = @j, updated_at = SYSUTCDATETIME() WHERE sheet_id = @s`, { j: T.text(JSON.stringify(settings)), s: T.uuid(id) });
    await audit({ userId: req.user!.id, action: 'sheet_update', entityType: 'sheet', entityId: id, fileId: sheet.file_id, sheetId: id, newValue: { filterColumns: body.filterColumns?.length ?? 'all', singleRow: !!settings.singleRow } }, req);
    ok(res, { saved: true, settings });
  }),
);

router.put(
  '/sheets/:id',
  ah(async (req, res) => {
    const id = pid(req);
    const { sheet } = await requireSheet(req.user!, id, LV.manage, undefined, true);
    const body = parse(z.object({ name: z.string().trim().min(1).max(200).optional(), tabColor: zColor.nullish() }), req.body);
    if (body.name && body.name !== sheet.sheet_name) {
      const exists = await q1(`SELECT 1 AS x FROM Sheets WHERE file_id = @f AND is_deleted = 0 AND sheet_name = @n AND sheet_id <> @s`,
        { f: T.uuid(sheet.file_id), n: body.name, s: T.uuid(id) });
      if (exists) throw conflict('มีชีตชื่อนี้อยู่แล้ว');
    }
    await q(
      `UPDATE Sheets SET sheet_name = COALESCE(@n, sheet_name), tab_color = CASE WHEN @hasC = 1 THEN @c ELSE tab_color END,
         updated_at = SYSUTCDATETIME() WHERE sheet_id = @s`,
      { n: T.text(body.name ?? null), hasC: body.tabColor !== undefined, c: T.text(body.tabColor ?? null), s: T.uuid(id) },
    );
    await audit({ userId: req.user!.id, action: 'sheet_update', entityType: 'sheet', entityId: id, fileId: sheet.file_id, sheetId: id,
      oldValue: { name: sheet.sheet_name, tabColor: sheet.tab_color }, newValue: body }, req);
    ok(res, { updated: true });
  }),
);

router.post(
  '/files/:fileId/sheets/reorder',
  ah(async (req, res) => {
    const fileId = pid(req, 'fileId');
    await requireFile(req.user!, fileId, LV.manage);
    const { ids } = parse(z.object({ ids: z.array(zId).min(1).max(100) }), req.body);
    await withTx(async (tx) => {
      for (const [i, sid] of ids.entries())
        await q(`UPDATE Sheets SET sort_order = @o WHERE sheet_id = @s AND file_id = @f`, { o: T.int(i), s: T.uuid(sid), f: T.uuid(fileId) }, tx);
    });
    ok(res, { reordered: true });
  }),
);

router.delete(
  '/sheets/:id',
  ah(async (req, res) => {
    const id = pid(req);
    const { sheet } = await requireSheet(req.user!, id, LV.manage, undefined, true);
    const count = await q1(`SELECT COUNT(*) AS n FROM Sheets WHERE file_id = @f AND is_deleted = 0`, { f: T.uuid(sheet.file_id) });
    if (Number(count?.n) <= 1) throw badRequest('ไฟล์ต้องมีอย่างน้อย 1 ชีต');
    await q(`UPDATE Sheets SET is_deleted = 1, updated_at = SYSUTCDATETIME() WHERE sheet_id = @s`, { s: T.uuid(id) });
    await audit({ userId: req.user!.id, action: 'sheet_delete', entityType: 'sheet', entityId: id, fileId: sheet.file_id, sheetId: id,
      oldValue: { name: sheet.sheet_name } }, req);
    ok(res, { deleted: true });
  }),
);

export default router;
