import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { q, q1, T } from '../../config/db';
import { audit } from '../../shared/audit';
import { ah, badRequest, conflict, forbidden, notFound, ok, parse, pid, safeJson, zId } from '../../shared/http';
import { notify } from '../../shared/notify';
import { LV, requireFile } from '../../shared/permissions';
import { archiveConfig } from '../exportArchive/config';

const router = Router();
const diskPath = (stored: string) => path.join(archiveConfig.dir, path.basename(stored));

const areaSchema = z.object({
  page: z.number().int().min(1).max(5000),
  /** millimetres from the top-left corner of the page */
  x: z.number().min(0).max(5000), y: z.number().min(0).max(5000), w: z.number().min(5).max(500), h: z.number().min(5).max(500),
});
const stepSchema = z.object({
  userId: zId,
  label: z.string().trim().max(200).default(''),
  allowForward: z.boolean().default(false),
  area: areaSchema,
});
type Area = z.infer<typeof areaSchema>;
interface Step {
  id: string; userId: string; userName: string; label: string; allowForward: boolean; area: Area;
  status: 'waiting' | 'pending' | 'approved' | 'rejected'; at?: string; comment?: string;
}

const MM = 72 / 25.4;
const userName = async (id: string) => String((await q1(`SELECT display_name FROM Users WHERE user_id = @i AND is_active = 1`, { i: T.uuid(id) }))?.display_name ?? '');

/* ---------- my signature ---------- */
const PNG_MAGIC = '89504e47';
router.get('/users/me/signature', ah(async (req, res) => {
  const r = await q1(`SELECT image_png FROM UserSignatures WHERE user_id = @u`, { u: T.uuid(req.user!.id) });
  ok(res, { image: r ? `data:image/png;base64,${Buffer.from(r.image_png).toString('base64')}` : null });
}));
router.put('/users/me/signature', ah(async (req, res) => {
  const { image } = parse(z.object({ image: z.string().max(2_000_000) }), req.body);
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) throw badRequest('ลายเซ็นต้องเป็นรูป PNG');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.subarray(0, 4).toString('hex') !== PNG_MAGIC) throw badRequest('ไฟล์ลายเซ็นไม่ถูกต้อง');
  await q(
    `MERGE UserSignatures AS t USING (SELECT @u AS user_id) s ON t.user_id = s.user_id
     WHEN MATCHED THEN UPDATE SET image_png = @img, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (user_id, image_png) VALUES (@u, @img);`,
    { u: T.uuid(req.user!.id), img: buf },
  );
  await audit({ userId: req.user!.id, action: 'signature_save', entityType: 'user', entityId: req.user!.id }, req);
  ok(res, { saved: true });
}));
router.delete('/users/me/signature', ah(async (req, res) => {
  await q(`DELETE FROM UserSignatures WHERE user_id = @u`, { u: T.uuid(req.user!.id) });
  ok(res, { removed: true });
}));

/* ---------- flows (defined per file) ---------- */
const mapFlow = (r: any) => ({ id: r.flow_id, fileId: r.file_id, name: r.flow_name, steps: safeJson<any[]>(r.steps_json, []), createdAt: r.created_at });
router.get('/files/:id/approval-flows', ah(async (req, res) => {
  const id = pid(req);
  const { level } = await requireFile(req.user!, id, LV.read);
  const rows = await q(`SELECT flow_id, file_id, flow_name, steps_json, created_at FROM ApprovalFlows WHERE file_id = @f AND is_deleted = 0 ORDER BY flow_name`, { f: T.uuid(id) });
  const flows = rows.map(mapFlow);
  const ids = [...new Set(flows.flatMap((f: any) => f.steps.map((s: any) => s.userId as string)))];
  const names = new Map<string, string>();
  for (const u of ids) names.set(u, await userName(u));
  for (const f of flows) for (const s of f.steps) s.userName = names.get(s.userId) ?? '';
  ok(res, { flows, canEdit: level >= LV.manage });
}));
router.put('/files/:id/approval-flows', ah(async (req, res) => {
  const id = pid(req);
  await requireFile(req.user!, id, LV.manage);
  const body = parse(z.object({ flows: z.array(z.object({ id: zId.optional(), name: z.string().trim().min(1).max(200), steps: z.array(stepSchema).min(1).max(20) })).max(30) }), req.body);
  const keep: string[] = [];
  for (const f of body.flows) {
    for (const s of f.steps) if (!(await userName(s.userId))) throw badRequest('ไม่พบผู้อนุมัติที่เลือก (หรือถูกปิดการใช้งาน)');
    if (f.id) {
      await q(`UPDATE ApprovalFlows SET flow_name = @n, steps_json = @s WHERE flow_id = @i AND file_id = @f`, { n: f.name, s: T.text(JSON.stringify(f.steps)), i: T.uuid(f.id), f: T.uuid(id) });
      keep.push(f.id);
    } else {
      const r = await q1(`INSERT INTO ApprovalFlows (file_id, flow_name, steps_json, created_by) OUTPUT inserted.flow_id VALUES (@f, @n, @s, @u)`, { f: T.uuid(id), n: f.name, s: T.text(JSON.stringify(f.steps)), u: T.uuid(req.user!.id) });
      keep.push(r!.flow_id);
    }
  }
  await q(`UPDATE ApprovalFlows SET is_deleted = 1 WHERE file_id = @f AND is_deleted = 0 AND flow_id NOT IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@k))`, { f: T.uuid(id), k: T.text(JSON.stringify(keep.map((k) => k.toLowerCase()))) });
  await audit({ userId: req.user!.id, action: 'approval_flow_save', entityType: 'file', entityId: id, fileId: id, newValue: { flows: body.flows.map((f) => f.name) } }, req);
  ok(res, { saved: true });
}));

/* ---------- requests ---------- */
const mapReq = (r: any, userId: string) => {
  const steps = safeJson<Step[]>(r.steps_json, []);
  return {
    id: r.request_id, fileId: r.file_id, archiveId: r.archive_id, title: r.title, status: r.status, steps, currentStep: r.current_step,
    createdBy: r.created_by, createdByName: r.created_by_name ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
    myTurn: r.status === 'pending' && String(r.current_user_id ?? '').toLowerCase() === userId.toLowerCase(),
  };
};
const SEL = `SELECT r.*, u.display_name AS created_by_name FROM ApprovalRequests r JOIN Users u ON u.user_id = r.created_by`;

async function stepsFromFlow(flowSteps: z.infer<typeof stepSchema>[]): Promise<Step[]> {
  const out: Step[] = [];
  for (const [i, s] of flowSteps.entries()) out.push({ id: crypto.randomUUID(), userId: s.userId, userName: await userName(s.userId), label: s.label, allowForward: s.allowForward, area: s.area, status: i === 0 ? 'pending' : 'waiting' });
  return out;
}

/** Start an approval for an archived (exported) PDF using one of the file's flows */
router.post('/exports/:id/approval', ah(async (req, res) => {
  const archiveId = pid(req);
  const body = parse(z.object({ flowId: zId }), req.body);
  const a = await q1(`SELECT archive_id, file_id, title, stored_name FROM ExportArchive WHERE archive_id = @i AND is_deleted = 0`, { i: T.uuid(archiveId) });
  if (!a) throw notFound('ไม่พบเอกสารที่บันทึกไว้');
  await requireFile(req.user!, a.file_id, LV.write);
  const flow = await q1(`SELECT flow_name, steps_json FROM ApprovalFlows WHERE flow_id = @i AND file_id = @f AND is_deleted = 0`, { i: T.uuid(body.flowId), f: T.uuid(a.file_id) });
  if (!flow) throw notFound('ไม่พบสายอนุมัติ');
  const src = diskPath(a.stored_name);
  if (!fs.existsSync(src)) throw notFound('ไฟล์เอกสารหายจากที่เก็บ');
  const steps = await stepsFromFlow(safeJson(flow.steps_json, []));
  const stored = `${crypto.randomUUID()}.pdf`;
  await fs.promises.copyFile(src, diskPath(stored));
  const row = await q1(
    `INSERT INTO ApprovalRequests (file_id, archive_id, title, steps_json, current_step, stored_name, created_by, current_user_id)
     OUTPUT inserted.request_id VALUES (@f, @a, @t, @s, 0, @sn, @u, @cu)`,
    { f: T.uuid(a.file_id), a: T.uuid(archiveId), t: a.title, s: T.text(JSON.stringify(steps)), sn: stored, u: T.uuid(req.user!.id), cu: T.uuid(steps[0].userId) },
  );
  await notify([steps[0].userId], { type: 'approval', title: 'มีเอกสารรออนุมัติ', message: a.title, link: `/approvals?open=${row!.request_id}` });
  await audit({ userId: req.user!.id, action: 'approval_start', entityType: 'file', entityId: row!.request_id, fileId: a.file_id, newValue: { title: a.title, flow: flow.flow_name } }, req);
  ok(res, { id: row!.request_id }, 201);
}));

/** My inbox: waiting for me / sent by me */
router.get('/approvals', ah(async (req, res) => {
  const me = req.user!.id;
  const box = String(req.query.box ?? 'inbox');
  const where = box === 'sent' ? 'r.created_by = @u' : box === 'done' ? `r.steps_json LIKE @like AND r.current_user_id IS NOT NULL AND (r.current_user_id <> @u OR r.status <> 'pending')` : `r.current_user_id = @u AND r.status = 'pending'`;
  const rows = await q(`${SEL} WHERE ${where} ORDER BY r.updated_at DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY`, { u: T.uuid(me), like: `%${me.toLowerCase()}%` });
  ok(res, rows.map((r) => mapReq(r, me)));
}));
router.get('/files/:id/approvals', ah(async (req, res) => {
  const id = pid(req);
  await requireFile(req.user!, id, LV.read);
  const rows = await q(`${SEL} WHERE r.file_id = @f ORDER BY r.created_at DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY`, { f: T.uuid(id) });
  ok(res, rows.map((r) => mapReq(r, req.user!.id)));
}));

async function loadFor(req: any) {
  const r = await q1(`${SEL} WHERE r.request_id = @i`, { i: T.uuid(pid(req)) });
  if (!r) throw notFound('ไม่พบคำขออนุมัติ');
  const me = req.user!.id.toLowerCase();
  const steps = safeJson<Step[]>(r.steps_json, []);
  const involved = r.created_by.toLowerCase() === me || steps.some((s) => s.userId.toLowerCase() === me);
  if (!involved) await requireFile(req.user!, r.file_id, LV.read);
  return { r, steps };
}
router.get('/approvals/:id', ah(async (req, res) => { const { r } = await loadFor(req); ok(res, mapReq(r, req.user!.id)); }));
router.get('/approvals/:id/pdf', ah(async (req, res) => {
  const { r } = await loadFor(req);
  const f = diskPath(r.stored_name);
  if (!fs.existsSync(f)) throw notFound('ไฟล์เอกสารหายจากที่เก็บ');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, no-store');
  res.attachment(`${r.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120)}.pdf`);
  fs.createReadStream(f).pipe(res);
}));

async function stamp(file: string, image: Buffer, a: Area) {
  const doc = await PDFDocument.load(await fs.promises.readFile(file));
  const pages = doc.getPages();
  if (a.page > pages.length) throw badRequest(`เอกสารมี ${pages.length} หน้า แต่พื้นที่ลายเซ็นอยู่หน้า ${a.page}`);
  const page = pages[a.page - 1];
  const png = await doc.embedPng(image);
  const boxW = a.w * MM, boxH = a.h * MM;
  const k = Math.min(boxW / png.width, boxH / png.height);
  const w = png.width * k, h = png.height * k;
  const x = a.x * MM + (boxW - w) / 2;
  const yTop = a.y * MM + (boxH - h) / 2;
  page.drawImage(png, { x, y: page.getHeight() - yTop - h, width: w, height: h });
  return Buffer.from(await doc.save());
}

router.post('/approvals/:id/approve', ah(async (req, res) => {
  const body = parse(z.object({ forwardTo: z.object({ userId: zId, label: z.string().trim().max(200).default(''), allowForward: z.boolean().default(false), area: areaSchema }).optional() }), req.body ?? {});
  const { r, steps } = await loadFor(req);
  const me = req.user!.id.toLowerCase();
  const cur = steps[r.current_step];
  if (r.status !== 'pending' || !cur || cur.status !== 'pending') throw conflict('คำขอนี้ไม่อยู่ในขั้นตอนที่รออนุมัติ');
  if (cur.userId.toLowerCase() !== me) throw forbidden('ยังไม่ถึงคิวของคุณ หรือคุณไม่ใช่ผู้อนุมัติขั้นนี้');
  const sig = await q1(`SELECT image_png FROM UserSignatures WHERE user_id = @u`, { u: T.uuid(me) });
  if (!sig) throw badRequest('ยังไม่มีลายเซ็นของคุณ กรุณาตั้งค่าลายเซ็นก่อนอนุมัติ', { code: 'NO_SIGNATURE' });
  if (body.forwardTo && !cur.allowForward) throw forbidden('ขั้นตอนนี้ไม่อนุญาตให้ส่งต่อ');

  const file = diskPath(r.stored_name);
  const out = await stamp(file, Buffer.from(sig.image_png), cur.area);
  cur.status = 'approved'; cur.at = new Date().toISOString();
  let next = r.current_step + 1;
  if (body.forwardTo) {
    if (!(await userName(body.forwardTo.userId))) throw badRequest('ไม่พบผู้อนุมัติที่เลือก');
    steps.splice(next, 0, { id: crypto.randomUUID(), userId: body.forwardTo.userId, userName: await userName(body.forwardTo.userId), label: body.forwardTo.label, allowForward: body.forwardTo.allowForward, area: body.forwardTo.area, status: 'waiting' });
  }
  const nxt = steps[next];
  if (nxt) nxt.status = 'pending';
  const status = nxt ? 'pending' : 'approved';
  const newStored = `${crypto.randomUUID()}.pdf`;
  await fs.promises.writeFile(diskPath(newStored), out);
  // optimistic guard: only the first of two simultaneous clicks wins
  const upd = await q(
    `UPDATE ApprovalRequests SET steps_json = @s, current_step = @c, status = @st, stored_name = @sn, current_user_id = @cu, updated_at = SYSUTCDATETIME()
     OUTPUT inserted.request_id WHERE request_id = @i AND current_step = @old AND status = 'pending'`,
    { s: T.text(JSON.stringify(steps)), c: nxt ? next : r.current_step, st: status, sn: newStored, cu: T.uuid(nxt?.userId ?? null), i: T.uuid(r.request_id), old: r.current_step },
  );
  if (!upd.length) { fs.promises.unlink(diskPath(newStored)).catch(() => undefined); throw conflict('มีผู้ดำเนินการไปแล้ว กรุณาโหลดใหม่'); }
  fs.promises.unlink(file).catch(() => undefined);
  if (nxt) await notify([nxt.userId], { type: 'approval', title: 'มีเอกสารรออนุมัติ', message: r.title, link: `/approvals?open=${r.request_id}` });
  else await notify([r.created_by], { type: 'approval', title: 'เอกสารอนุมัติครบแล้ว', message: r.title, link: `/approvals?open=${r.request_id}` });
  await audit({ userId: req.user!.id, action: 'approval_approve', entityType: 'file', entityId: r.request_id, fileId: r.file_id, newValue: { title: r.title, step: cur.label, forwardedTo: body.forwardTo?.userId ?? null } }, req);
  ok(res, { status });
}));

router.post('/approvals/:id/reject', ah(async (req, res) => {
  const { comment } = parse(z.object({ comment: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(1000) }), req.body ?? {});
  const { r, steps } = await loadFor(req);
  const cur = steps[r.current_step];
  if (r.status !== 'pending' || !cur || cur.userId.toLowerCase() !== req.user!.id.toLowerCase()) throw forbidden('คุณไม่ใช่ผู้อนุมัติขั้นนี้');
  cur.status = 'rejected'; cur.at = new Date().toISOString(); cur.comment = comment;
  const upd = await q(`UPDATE ApprovalRequests SET steps_json = @s, status = 'rejected', current_user_id = NULL, updated_at = SYSUTCDATETIME() OUTPUT inserted.request_id WHERE request_id = @i AND status = 'pending'`, { s: T.text(JSON.stringify(steps)), i: T.uuid(r.request_id) });
  if (!upd.length) throw conflict('มีผู้ดำเนินการไปแล้ว กรุณาโหลดใหม่');
  await notify([r.created_by], { type: 'approval', title: 'เอกสารถูกปฏิเสธ', message: `${r.title}: ${comment}`, link: `/approvals?open=${r.request_id}` });
  await audit({ userId: req.user!.id, action: 'approval_reject', entityType: 'file', entityId: r.request_id, fileId: r.file_id, newValue: { title: r.title, comment } }, req);
  ok(res, { status: 'rejected' });
}));

export default router;
