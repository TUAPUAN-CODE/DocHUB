import { Router } from 'express';
import { z } from 'zod';
import { idList, jsonParam, q, T, withTx } from '../../config/db';
import { isAdminRole, isBasicRole } from '../../middleware/auth';
import { audit } from '../../shared/audit';
import { ah, badRequest, forbidden, ok, parse, pid, safeJson } from '../../shared/http';
import { logger } from '../../shared/logger';
import { getFolderIndex, LV, requireFile, requireFolder } from '../../shared/permissions';
import { parseTemplates } from '../../services/pdfTemplates';
import { createRevision } from './service';

/**
 * Document types (docs/NEWS_TAGS_ROOT.md → ประเภทเอกสาร): master_data · record · null (ทั่วไป).
 * Giving a file a type starts its revisions: every sheet without one gets a first Rev ("Rev เริ่มต้น").
 */
export const DOC_TYPES = ['master_data', 'record'] as const;
const zType = z.enum(DOC_TYPES).nullable();
export const DOC_TYPE_TH: Record<string, string> = { master_data: 'Master Data (ข้อมูลหลัก)', record: 'แบบฟอร์มบันทึก', general: 'ทั่วไป' };

/** a first revision for every (non-union) sheet of the file that has none */
export async function ensureBaseline(fileId: string, userId: string) {
  const sheets = await q(
    `SELECT s.sheet_id FROM Sheets s WHERE s.file_id = @f AND s.is_deleted = 0 AND s.union_config IS NULL
       AND NOT EXISTS (SELECT 1 FROM SheetRevisions r WHERE r.sheet_id = s.sheet_id)`,
    { f: T.uuid(fileId) },
  );
  let made = 0;
  for (const s of sheets) {
    const r = await withTx((tx) => createRevision(tx, s.sheet_id, userId, 'Rev เริ่มต้น (ตั้งประเภทเอกสาร)', 1));
    if (!('error' in r)) made++;
  }
  return made;
}

/** start-up: typed files (e.g. from a seed) whose sheets have no revision yet */
export async function ensureTypedBaselines() {
  const files = await q(
    `SELECT f.file_id, f.created_by FROM Files f WHERE f.is_deleted = 0 AND f.doc_type IS NOT NULL
       AND EXISTS (SELECT 1 FROM Sheets s WHERE s.file_id = f.file_id AND s.is_deleted = 0 AND s.union_config IS NULL AND NOT EXISTS (SELECT 1 FROM SheetRevisions r WHERE r.sheet_id = s.sheet_id))`,
  );
  for (const f of files) {
    try {
      const n = await ensureBaseline(f.file_id, f.created_by);
      if (n) logger.info(`Doc type: first Rev for ${n} sheet(s) of file ${f.file_id}`);
    } catch (e: any) {
      logger.error(`Doc type: first Rev of ${f.file_id} failed: ${e?.message}`);
    }
  }
}

export const router = Router();

/** one file (Master and up with "จัดการ" on the file) */
router.put('/files/:id/doc-type', ah(async (req, res) => {
  const id = pid(req);
  const u = req.user!;
  if (isBasicRole(u.role)) throw forbidden('ตั้งประเภทเอกสารได้ตั้งแต่ Master ขึ้นไป');
  const { file } = await requireFile(u, id, LV.manage);
  const { docType } = parse(z.object({ docType: zType }), req.body);
  await q(`UPDATE Files SET doc_type = @t, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { t: T.text(docType), id: T.uuid(id) });
  await audit({ userId: u.id, action: 'file_doc_type', entityType: 'file', entityId: id, fileId: id, oldValue: { docType: file.doc_type ?? null }, newValue: { docType } }, req);
  const revs = docType ? await ensureBaseline(id, u.id) : 0;
  ok(res, { docType, firstRevs: revs });
}));

/** every file of a folder (and its sub-folders) — admin */
router.put('/folders/:id/doc-type', ah(async (req, res) => {
  const id = pid(req);
  const u = req.user!;
  if (!isAdminRole(u.role)) throw forbidden('ตั้งประเภทเอกสารทั้งโฟลเดอร์ได้เฉพาะ Admin');
  await requireFolder(u, id, LV.manage);
  const b = parse(z.object({ docType: zType, includeSubfolders: z.boolean().default(true), onlyUntyped: z.boolean().default(false) }), req.body);
  const index = await getFolderIndex();
  const ids = [id.toLowerCase()];
  if (b.includeSubfolders) for (let i = 0; i < ids.length; i++) for (const c of index.children.get(ids[i]) ?? []) ids.push(c);
  const files = await q(`SELECT file_id FROM Files WHERE is_deleted = 0 AND folder_id IN ${idList('@ids')} ${b.onlyUntyped ? 'AND doc_type IS NULL' : ''}`, { ids: jsonParam(ids) });
  if (!files.length) throw badRequest('ไม่มีไฟล์ในโฟลเดอร์นี้');
  await q(`UPDATE Files SET doc_type = @t, updated_at = SYSUTCDATETIME() WHERE file_id IN ${idList('@f')}`, { t: T.text(b.docType), f: jsonParam(files.map((f) => f.file_id)) });
  await audit({ userId: u.id, action: 'folder_doc_type', entityType: 'folder', entityId: id, newValue: { docType: b.docType, files: files.length, includeSubfolders: b.includeSubfolders } }, req);
  let revs = 0;
  if (b.docType) for (const f of files) revs += await ensureBaseline(f.file_id, u.id);
  ok(res, { files: files.length, firstRevs: revs });
}));

/** PDF layouts as they were at earlier format revisions (to print an old record the way it was) */
router.get('/files/:id/pdf-revisions', ah(async (req, res) => {
  const id = pid(req);
  const { file } = await requireFile(req.user!, id, LV.read);
  const current = new Map(parseTemplates(file.pdf_templates).map((t) => [t.id, JSON.stringify(t)]));
  const rows = await q(
    `SELECT r.rev_no, r.created_at, r.format_json, s.sheet_name FROM SheetRevisions r JOIN Sheets s ON s.sheet_id = r.sheet_id
     WHERE s.file_id = @f AND s.is_deleted = 0 AND r.format_json IS NOT NULL ORDER BY r.rev_no DESC`,
    { f: T.uuid(id) },
  );
  const seen = new Set<string>();
  const out: { revNo: number; sheetName: string; createdAt: Date; template: unknown }[] = [];
  for (const r of rows) {
    for (const t of safeJson<{ pdf?: { id: string; json: string }[] }>(r.format_json, {})?.pdf ?? []) {
      if (current.get(t.id) === t.json || seen.has(t.json)) continue;
      seen.add(t.json);
      out.push({ revNo: r.rev_no, sheetName: r.sheet_name, createdAt: r.created_at, template: safeJson(t.json, null) });
    }
  }
  ok(res, out.slice(0, 30));
}));

