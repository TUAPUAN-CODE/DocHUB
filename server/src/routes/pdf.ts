import { Router } from 'express';
import { z } from 'zod';
import { q, q1, T } from '../config/db';
import { audit } from '../shared/audit';
import { ah, badRequest, ok, parse, pid, zId } from '../shared/http';
import { getFileRow, LV, requireFile, requireFolder } from '../shared/permissions';
import { parseTemplates, remapTemplates, sheetsOfFile } from '../services/pdfTemplates';

const router = Router();
const MAX_BYTES = 3_000_000;

const templateSchema = z.object({ id: z.string().min(1).max(60), name: z.string().trim().min(1).max(200) }).passthrough();

/**
 * A file with a master (Files.pdf_master_id) uses the layouts of that file: one edit there changes every file that follows it.
 * A layout with `followSheet` prints the sheet the user is looking at, so the same layout fits every daily sheet / month file.
 */
async function masterOf(file: { pdf_master_id?: string | null }) {
  if (!file.pdf_master_id) return null;
  const m = await getFileRow(file.pdf_master_id as string);
  return m ?? null;
}

/** Anyone who can read the file can export with its layouts */
router.get(
  '/files/:id/pdf-templates',
  ah(async (req, res) => {
    const id = pid(req);
    const { file, level } = await requireFile(req.user!, id, LV.read);
    const m = await masterOf(file);
    if (m) { ok(res, { templates: parseTemplates(m.pdf_templates), canEdit: false, master: { id: m.file_id, name: m.file_name } }); return; }
    ok(res, { templates: parseTemplates(file.pdf_templates), canEdit: level >= LV.manage, master: null });
  }),
);

/** Owner / managers / admin design the layouts */
router.put(
  '/files/:id/pdf-templates',
  ah(async (req, res) => {
    const id = pid(req);
    const { file } = await requireFile(req.user!, id, LV.manage);
    const m = await masterOf(file);
    if (m) throw badRequest(`ไฟล์นี้ใช้รูปแบบ PDF กลางจากไฟล์ "${m.file_name}" — ให้แก้ที่ไฟล์นั้น หรือเลิกใช้รูปแบบกลางก่อน`);
    const body = parse(z.object({ templates: z.array(templateSchema).max(30) }), req.body);
    const json = JSON.stringify(body.templates);
    if (json.length > MAX_BYTES) throw badRequest('รูปแบบ PDF มีขนาดใหญ่เกินไป');
    await q(`UPDATE Files SET pdf_templates = @t, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { t: T.text(json), id: T.uuid(id) });
    await audit({ userId: req.user!.id, action: 'pdf_template_save', entityType: 'file', entityId: id, fileId: id, newValue: { templates: body.templates.map((t) => t.name), name: file.file_name } }, req);
    ok(res, { saved: true });
  }),
);

/** Copy the layouts of another file into this one (sheets are matched by name) */
router.post(
  '/files/:id/pdf-templates/copy-from',
  ah(async (req, res) => {
    const id = pid(req);
    const { file } = await requireFile(req.user!, id, LV.manage);
    const body = parse(z.object({ sourceFileId: zId, templateIds: z.array(z.string()).max(30).optional() }), req.body);
    const { file: src } = await requireFile(req.user!, body.sourceFileId, LV.read);
    let tpls = parseTemplates(src.pdf_templates);
    if (body.templateIds?.length) tpls = tpls.filter((t) => body.templateIds!.includes(t.id));
    if (!tpls.length) throw badRequest('ไฟล์ต้นทางยังไม่มีรูปแบบ PDF');
    const copied = remapTemplates(tpls, await sheetsOfFile(src.file_id), await sheetsOfFile(id));
    const merged = [...parseTemplates(file.pdf_templates), ...copied.map((t) => ({ ...t, name: `${t.name} (คัดลอกจาก ${src.file_name})`.slice(0, 200) }))].slice(0, 30);
    await q(`UPDATE Files SET pdf_templates = @t, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { t: T.text(JSON.stringify(merged)), id: T.uuid(id) });
    await audit({ userId: req.user!.id, action: 'pdf_template_save', entityType: 'file', entityId: id, fileId: id, newValue: { copiedFrom: src.file_name, count: copied.length } }, req);
    ok(res, { templates: merged });
  }),
);

/** Follow (or stop following) the layouts of another file. Stopping keeps a copy of the master's layouts in this file. */
router.post(
  '/files/:id/pdf-templates/master',
  ah(async (req, res) => {
    const id = pid(req);
    const { file } = await requireFile(req.user!, id, LV.manage);
    const body = parse(z.object({ masterFileId: zId.nullable() }), req.body);
    if (body.masterFileId === null) {
      const m = await masterOf(file);
      await q(`UPDATE Files SET pdf_master_id = NULL, pdf_templates = @t, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { t: T.text(m ? JSON.stringify(parseTemplates(m.pdf_templates)) : file.pdf_templates), id: T.uuid(id) });
    } else {
      if (body.masterFileId.toLowerCase() === id.toLowerCase()) throw badRequest('เลือกไฟล์ตัวเองเป็นรูปแบบกลางไม่ได้');
      const { file: m } = await requireFile(req.user!, body.masterFileId, LV.read);
      if (m.pdf_master_id) throw badRequest('ไฟล์ที่เลือกใช้รูปแบบกลางของไฟล์อื่นอยู่ — เลือกไฟล์ต้นทางจริงแทน');
      await q(`UPDATE Files SET pdf_master_id = @m, updated_at = SYSUTCDATETIME() WHERE file_id = @id`, { m: T.uuid(body.masterFileId), id: T.uuid(id) });
    }
    await audit({ userId: req.user!.id, action: 'pdf_template_master', entityType: 'file', entityId: id, fileId: id, newValue: { masterFileId: body.masterFileId, name: file.file_name } }, req);
    ok(res, { saved: true });
  }),
);

/** Make every file in a folder (and its sub-folders) follow the layouts of one master file */
router.post(
  '/folders/:id/pdf-master',
  ah(async (req, res) => {
    const id = pid(req);
    const { ctx } = await requireFolder(req.user!, id, LV.manage);
    const body = parse(z.object({ masterFileId: zId }), req.body);
    const { file: m } = await requireFile(req.user!, body.masterFileId, LV.read);
    if (m.pdf_master_id) throw badRequest('ไฟล์ต้นทางใช้รูปแบบกลางของไฟล์อื่นอยู่ — เลือกไฟล์ต้นทางจริงแทน');
    const folders: string[] = [];
    const stack = [id];
    while (stack.length) { const cur = stack.pop()!; folders.push(cur); stack.push(...(ctx.index.children.get(cur) ?? [])); }
    let changed = 0;
    for (let i = 0; i < folders.length; i += 100) {
      const part = folders.slice(i, i + 100);
      const ph = part.map((_f, k) => `@f${k}`).join(',');
      const params: Record<string, unknown> = { m: T.uuid(body.masterFileId) };
      part.forEach((f, k) => { params[`f${k}`] = T.uuid(f); });
      const r: any = await q(`UPDATE Files SET pdf_master_id = @m, updated_at = SYSUTCDATETIME() OUTPUT inserted.file_id WHERE is_deleted = 0 AND file_id <> @m AND folder_id IN (${ph})`, params);
      changed += Array.isArray(r) ? r.length : 0;
    }
    await audit({ userId: req.user!.id, action: 'pdf_template_master', entityType: 'folder', entityId: id, newValue: { masterFileId: body.masterFileId, files: changed } }, req);
    ok(res, { files: changed });
  }),
);

export default router;
