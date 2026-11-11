import { Router } from 'express';
import { z } from 'zod';
import { withTx } from '../../config/db';
import { writeSettingsKey } from '../../services/sheetSettings';
import { audit } from '../../shared/audit';
import { ah, badRequest, notFound, ok, parse, pid, zId } from '../../shared/http';
import { LV, requireSheet } from '../../shared/permissions';
import { emitToSheet } from '../../socket';
import { diffCounts } from './diff';
import { createRevision, getRevision, keyColumnIds, listRevisions, pendingCounts, pendingDiff, pendingFormatCount, sheetDocType } from './service';

const router = Router();

/** Revisions of a sheet + a quick count of rows touched since the latest one */
router.get('/sheets/:id/revisions', ah(async (req, res) => {
  const sheetId = pid(req);
  const { level } = await requireSheet(req.user!, sheetId, LV.read, undefined, true);
  const revisions = await listRevisions(sheetId);
  const docType = await sheetDocType(sheetId);
  const pending = revisions.length ? await pendingCounts(sheetId, revisions[0].createdAt) : null;
  // a form's data never waits for a revision; only its format does
  ok(res, { revisions, pending: docType === 'record' ? null : pending, pendingFormat: revisions.length ? await pendingFormatCount(sheetId) : null,
    docType, keyColumnIds: await keyColumnIds(sheetId), canIssue: level >= LV.write });
}));

/** Exactly what changed since the latest revision (what "ออก Rev" would record) */
router.get('/sheets/:id/revisions/pending', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.read, undefined, true);
  ok(res, await pendingDiff(sheetId));
}));

/** Columns that name a row in the change list, e.g. Sub Doc No. + Short Code */
router.put('/sheets/:id/revisions/settings', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.manage);
  const body = parse(z.object({ keyColumnIds: z.array(zId).max(5) }), req.body);
  await writeSettingsKey(sheetId, 'revisions', { keyColumnIds: body.keyColumnIds });
  ok(res, { keyColumnIds: body.keyColumnIds });
}));

/** One revision (number, or "latest") with its changes since the previous one */
router.get('/sheets/:id/revisions/:rev', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.read, undefined, true);
  const raw = String(req.params.rev);
  const n = raw === 'latest' ? null : Number(raw);
  if (n !== null && (!Number.isInteger(n) || n < 0)) throw badRequest('เลข Rev ไม่ถูกต้อง');
  const r = await getRevision(sheetId, n);
  if (!r) throw notFound(n === null ? 'ชีตนี้ยังไม่เคยออก Rev' : `ไม่พบ Rev.${n}`);
  ok(res, r);
}));

/** "ออก Rev ใหม่": freeze the sheet as the next revision */
router.post('/sheets/:id/revisions', ah(async (req, res) => {
  const sheetId = pid(req);
  const { sheet } = await requireSheet(req.user!, sheetId, LV.write);
  const body = parse(z.object({ note: z.string().trim().max(1000).nullish(), firstRevNo: z.number().int().min(0).max(100000).nullish() }), req.body ?? {});
  const r = await withTx((tx) => createRevision(tx, sheetId, req.user!.id, body.note || null, body.firstRevNo ?? null));
  if ('error' in r) throw badRequest(r.error!);
  await audit({ userId: req.user!.id, action: 'revision_create', entityType: 'sheet', entityId: sheetId, fileId: sheet.file_id, sheetId,
    newValue: { revNo: r.revNo, note: body.note || null, rows: r.rowCount, ...(r.diff ? diffCounts(r.diff) : {}) } }, req);
  emitToSheet(sheetId, 'sheet:revision', { revNo: r.revNo });
  ok(res, { revNo: r.revNo, rowCount: r.rowCount, diff: r.diff, formatDiff: r.formatDiff, kind: r.kind }, 201);
}));

export default router;
