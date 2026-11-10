"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const pdf_lib_1 = require("pdf-lib");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const notify_1 = require("../../shared/notify");
const permissions_1 = require("../../shared/permissions");
const config_1 = require("../exportArchive/config");
const router = (0, express_1.Router)();
const diskPath = (stored) => path_1.default.join(config_1.archiveConfig.dir, path_1.default.basename(stored));
const areaSchema = zod_1.z.object({
    page: zod_1.z.number().int().min(1).max(5000),
    /** millimetres from the top-left corner of the page */
    x: zod_1.z.number().min(0).max(5000), y: zod_1.z.number().min(0).max(5000), w: zod_1.z.number().min(5).max(500), h: zod_1.z.number().min(5).max(500),
});
const stepSchema = zod_1.z.object({
    userId: http_1.zId,
    label: zod_1.z.string().trim().max(200).default(''),
    allowForward: zod_1.z.boolean().default(false),
    area: areaSchema,
});
const MM = 72 / 25.4;
const userName = async (id) => String((await (0, db_1.q1)(`SELECT display_name FROM Users WHERE user_id = @i AND is_active = 1`, { i: db_1.T.uuid(id) }))?.display_name ?? '');
/* ---------- my signature ---------- */
const PNG_MAGIC = '89504e47';
router.get('/users/me/signature', (0, http_1.ah)(async (req, res) => {
    const r = await (0, db_1.q1)(`SELECT image_png FROM UserSignatures WHERE user_id = @u`, { u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { image: r ? `data:image/png;base64,${Buffer.from(r.image_png).toString('base64')}` : null });
}));
router.put('/users/me/signature', (0, http_1.ah)(async (req, res) => {
    const { image } = (0, http_1.parse)(zod_1.z.object({ image: zod_1.z.string().max(2_000_000) }), req.body);
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!m)
        throw (0, http_1.badRequest)('ลายเซ็นต้องเป็นรูป PNG');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.subarray(0, 4).toString('hex') !== PNG_MAGIC)
        throw (0, http_1.badRequest)('ไฟล์ลายเซ็นไม่ถูกต้อง');
    await (0, db_1.q)(`MERGE UserSignatures AS t USING (SELECT @u AS user_id) s ON t.user_id = s.user_id
     WHEN MATCHED THEN UPDATE SET image_png = @img, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (user_id, image_png) VALUES (@u, @img);`, { u: db_1.T.uuid(req.user.id), img: buf });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'signature_save', entityType: 'user', entityId: req.user.id }, req);
    (0, http_1.ok)(res, { saved: true });
}));
router.delete('/users/me/signature', (0, http_1.ah)(async (req, res) => {
    await (0, db_1.q)(`DELETE FROM UserSignatures WHERE user_id = @u`, { u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { removed: true });
}));
/* ---------- flows (defined per file) ---------- */
const mapFlow = (r) => ({ id: r.flow_id, fileId: r.file_id, name: r.flow_name, steps: (0, http_1.safeJson)(r.steps_json, []), createdAt: r.created_at });
router.get('/files/:id/approval-flows', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const { level } = await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.read);
    const rows = await (0, db_1.q)(`SELECT flow_id, file_id, flow_name, steps_json, created_at FROM ApprovalFlows WHERE file_id = @f AND is_deleted = 0 ORDER BY flow_name`, { f: db_1.T.uuid(id) });
    const flows = rows.map(mapFlow);
    const ids = [...new Set(flows.flatMap((f) => f.steps.map((s) => s.userId)))];
    const names = new Map();
    for (const u of ids)
        names.set(u, await userName(u));
    for (const f of flows)
        for (const s of f.steps)
            s.userName = names.get(s.userId) ?? '';
    (0, http_1.ok)(res, { flows, canEdit: level >= permissions_1.LV.manage });
}));
router.put('/files/:id/approval-flows', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ flows: zod_1.z.array(zod_1.z.object({ id: http_1.zId.optional(), name: zod_1.z.string().trim().min(1).max(200), steps: zod_1.z.array(stepSchema).min(1).max(20) })).max(30) }), req.body);
    const keep = [];
    for (const f of body.flows) {
        for (const s of f.steps)
            if (!(await userName(s.userId)))
                throw (0, http_1.badRequest)('ไม่พบผู้อนุมัติที่เลือก (หรือถูกปิดการใช้งาน)');
        if (f.id) {
            await (0, db_1.q)(`UPDATE ApprovalFlows SET flow_name = @n, steps_json = @s WHERE flow_id = @i AND file_id = @f`, { n: f.name, s: db_1.T.text(JSON.stringify(f.steps)), i: db_1.T.uuid(f.id), f: db_1.T.uuid(id) });
            keep.push(f.id);
        }
        else {
            const r = await (0, db_1.q1)(`INSERT INTO ApprovalFlows (file_id, flow_name, steps_json, created_by) OUTPUT inserted.flow_id VALUES (@f, @n, @s, @u)`, { f: db_1.T.uuid(id), n: f.name, s: db_1.T.text(JSON.stringify(f.steps)), u: db_1.T.uuid(req.user.id) });
            keep.push(r.flow_id);
        }
    }
    await (0, db_1.q)(`UPDATE ApprovalFlows SET is_deleted = 1 WHERE file_id = @f AND is_deleted = 0 AND flow_id NOT IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@k))`, { f: db_1.T.uuid(id), k: db_1.T.text(JSON.stringify(keep.map((k) => k.toLowerCase()))) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'approval_flow_save', entityType: 'file', entityId: id, fileId: id, newValue: { flows: body.flows.map((f) => f.name) } }, req);
    (0, http_1.ok)(res, { saved: true });
}));
/* ---------- requests ---------- */
const mapReq = (r, userId) => {
    const steps = (0, http_1.safeJson)(r.steps_json, []);
    return {
        id: r.request_id, fileId: r.file_id, archiveId: r.archive_id, title: r.title, status: r.status, steps, currentStep: r.current_step,
        createdBy: r.created_by, createdByName: r.created_by_name ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
        myTurn: r.status === 'pending' && String(r.current_user_id ?? '').toLowerCase() === userId.toLowerCase(),
    };
};
const SEL = `SELECT r.*, u.display_name AS created_by_name FROM ApprovalRequests r JOIN Users u ON u.user_id = r.created_by`;
async function stepsFromFlow(flowSteps) {
    const out = [];
    for (const [i, s] of flowSteps.entries())
        out.push({ id: crypto_1.default.randomUUID(), userId: s.userId, userName: await userName(s.userId), label: s.label, allowForward: s.allowForward, area: s.area, status: i === 0 ? 'pending' : 'waiting' });
    return out;
}
/** Start an approval for an archived (exported) PDF using one of the file's flows */
router.post('/exports/:id/approval', (0, http_1.ah)(async (req, res) => {
    const archiveId = (0, http_1.pid)(req);
    const body = (0, http_1.parse)(zod_1.z.object({ flowId: http_1.zId }), req.body);
    const a = await (0, db_1.q1)(`SELECT archive_id, file_id, title, stored_name FROM ExportArchive WHERE archive_id = @i AND is_deleted = 0`, { i: db_1.T.uuid(archiveId) });
    if (!a)
        throw (0, http_1.notFound)('ไม่พบเอกสารที่บันทึกไว้');
    await (0, permissions_1.requireFile)(req.user, a.file_id, permissions_1.LV.write);
    const flow = await (0, db_1.q1)(`SELECT flow_name, steps_json FROM ApprovalFlows WHERE flow_id = @i AND file_id = @f AND is_deleted = 0`, { i: db_1.T.uuid(body.flowId), f: db_1.T.uuid(a.file_id) });
    if (!flow)
        throw (0, http_1.notFound)('ไม่พบสายอนุมัติ');
    const src = diskPath(a.stored_name);
    if (!fs_1.default.existsSync(src))
        throw (0, http_1.notFound)('ไฟล์เอกสารหายจากที่เก็บ');
    const steps = await stepsFromFlow((0, http_1.safeJson)(flow.steps_json, []));
    const stored = `${crypto_1.default.randomUUID()}.pdf`;
    await fs_1.default.promises.copyFile(src, diskPath(stored));
    const row = await (0, db_1.q1)(`INSERT INTO ApprovalRequests (file_id, archive_id, title, steps_json, current_step, stored_name, created_by, current_user_id)
     OUTPUT inserted.request_id VALUES (@f, @a, @t, @s, 0, @sn, @u, @cu)`, { f: db_1.T.uuid(a.file_id), a: db_1.T.uuid(archiveId), t: a.title, s: db_1.T.text(JSON.stringify(steps)), sn: stored, u: db_1.T.uuid(req.user.id), cu: db_1.T.uuid(steps[0].userId) });
    await (0, notify_1.notify)([steps[0].userId], { type: 'approval', title: 'มีเอกสารรออนุมัติ', message: a.title, link: `/approvals?open=${row.request_id}` });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'approval_start', entityType: 'file', entityId: row.request_id, fileId: a.file_id, newValue: { title: a.title, flow: flow.flow_name } }, req);
    (0, http_1.ok)(res, { id: row.request_id }, 201);
}));
/** My inbox: waiting for me / sent by me */
router.get('/approvals', (0, http_1.ah)(async (req, res) => {
    const me = req.user.id;
    const box = String(req.query.box ?? 'inbox');
    const where = box === 'sent' ? 'r.created_by = @u' : box === 'done' ? `r.steps_json LIKE @like AND r.current_user_id IS NOT NULL AND (r.current_user_id <> @u OR r.status <> 'pending')` : `r.current_user_id = @u AND r.status = 'pending'`;
    const rows = await (0, db_1.q)(`${SEL} WHERE ${where} ORDER BY r.updated_at DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY`, { u: db_1.T.uuid(me), like: `%${me.toLowerCase()}%` });
    (0, http_1.ok)(res, rows.map((r) => mapReq(r, me)));
}));
router.get('/files/:id/approvals', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    await (0, permissions_1.requireFile)(req.user, id, permissions_1.LV.read);
    const rows = await (0, db_1.q)(`${SEL} WHERE r.file_id = @f ORDER BY r.created_at DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY`, { f: db_1.T.uuid(id) });
    (0, http_1.ok)(res, rows.map((r) => mapReq(r, req.user.id)));
}));
async function loadFor(req) {
    const r = await (0, db_1.q1)(`${SEL} WHERE r.request_id = @i`, { i: db_1.T.uuid((0, http_1.pid)(req)) });
    if (!r)
        throw (0, http_1.notFound)('ไม่พบคำขออนุมัติ');
    const me = req.user.id.toLowerCase();
    const steps = (0, http_1.safeJson)(r.steps_json, []);
    const involved = r.created_by.toLowerCase() === me || steps.some((s) => s.userId.toLowerCase() === me);
    if (!involved)
        await (0, permissions_1.requireFile)(req.user, r.file_id, permissions_1.LV.read);
    return { r, steps };
}
router.get('/approvals/:id', (0, http_1.ah)(async (req, res) => { const { r } = await loadFor(req); (0, http_1.ok)(res, mapReq(r, req.user.id)); }));
router.get('/approvals/:id/pdf', (0, http_1.ah)(async (req, res) => {
    const { r } = await loadFor(req);
    const f = diskPath(r.stored_name);
    if (!fs_1.default.existsSync(f))
        throw (0, http_1.notFound)('ไฟล์เอกสารหายจากที่เก็บ');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.attachment(`${r.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120)}.pdf`);
    fs_1.default.createReadStream(f).pipe(res);
}));
async function stamp(file, image, a) {
    const doc = await pdf_lib_1.PDFDocument.load(await fs_1.default.promises.readFile(file));
    const pages = doc.getPages();
    if (a.page > pages.length)
        throw (0, http_1.badRequest)(`เอกสารมี ${pages.length} หน้า แต่พื้นที่ลายเซ็นอยู่หน้า ${a.page}`);
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
router.post('/approvals/:id/approve', (0, http_1.ah)(async (req, res) => {
    const body = (0, http_1.parse)(zod_1.z.object({ forwardTo: zod_1.z.object({ userId: http_1.zId, label: zod_1.z.string().trim().max(200).default(''), allowForward: zod_1.z.boolean().default(false), area: areaSchema }).optional() }), req.body ?? {});
    const { r, steps } = await loadFor(req);
    const me = req.user.id.toLowerCase();
    const cur = steps[r.current_step];
    if (r.status !== 'pending' || !cur || cur.status !== 'pending')
        throw (0, http_1.conflict)('คำขอนี้ไม่อยู่ในขั้นตอนที่รออนุมัติ');
    if (cur.userId.toLowerCase() !== me)
        throw (0, http_1.forbidden)('ยังไม่ถึงคิวของคุณ หรือคุณไม่ใช่ผู้อนุมัติขั้นนี้');
    const sig = await (0, db_1.q1)(`SELECT image_png FROM UserSignatures WHERE user_id = @u`, { u: db_1.T.uuid(me) });
    if (!sig)
        throw (0, http_1.badRequest)('ยังไม่มีลายเซ็นของคุณ กรุณาตั้งค่าลายเซ็นก่อนอนุมัติ', { code: 'NO_SIGNATURE' });
    if (body.forwardTo && !cur.allowForward)
        throw (0, http_1.forbidden)('ขั้นตอนนี้ไม่อนุญาตให้ส่งต่อ');
    const file = diskPath(r.stored_name);
    const out = await stamp(file, Buffer.from(sig.image_png), cur.area);
    cur.status = 'approved';
    cur.at = new Date().toISOString();
    let next = r.current_step + 1;
    if (body.forwardTo) {
        if (!(await userName(body.forwardTo.userId)))
            throw (0, http_1.badRequest)('ไม่พบผู้อนุมัติที่เลือก');
        steps.splice(next, 0, { id: crypto_1.default.randomUUID(), userId: body.forwardTo.userId, userName: await userName(body.forwardTo.userId), label: body.forwardTo.label, allowForward: body.forwardTo.allowForward, area: body.forwardTo.area, status: 'waiting' });
    }
    const nxt = steps[next];
    if (nxt)
        nxt.status = 'pending';
    const status = nxt ? 'pending' : 'approved';
    const newStored = `${crypto_1.default.randomUUID()}.pdf`;
    await fs_1.default.promises.writeFile(diskPath(newStored), out);
    // optimistic guard: only the first of two simultaneous clicks wins
    const upd = await (0, db_1.q)(`UPDATE ApprovalRequests SET steps_json = @s, current_step = @c, status = @st, stored_name = @sn, current_user_id = @cu, updated_at = SYSUTCDATETIME()
     OUTPUT inserted.request_id WHERE request_id = @i AND current_step = @old AND status = 'pending'`, { s: db_1.T.text(JSON.stringify(steps)), c: nxt ? next : r.current_step, st: status, sn: newStored, cu: db_1.T.uuid(nxt?.userId ?? null), i: db_1.T.uuid(r.request_id), old: r.current_step });
    if (!upd.length) {
        fs_1.default.promises.unlink(diskPath(newStored)).catch(() => undefined);
        throw (0, http_1.conflict)('มีผู้ดำเนินการไปแล้ว กรุณาโหลดใหม่');
    }
    fs_1.default.promises.unlink(file).catch(() => undefined);
    if (nxt)
        await (0, notify_1.notify)([nxt.userId], { type: 'approval', title: 'มีเอกสารรออนุมัติ', message: r.title, link: `/approvals?open=${r.request_id}` });
    else
        await (0, notify_1.notify)([r.created_by], { type: 'approval', title: 'เอกสารอนุมัติครบแล้ว', message: r.title, link: `/approvals?open=${r.request_id}` });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'approval_approve', entityType: 'file', entityId: r.request_id, fileId: r.file_id, newValue: { title: r.title, step: cur.label, forwardedTo: body.forwardTo?.userId ?? null } }, req);
    (0, http_1.ok)(res, { status });
}));
router.post('/approvals/:id/reject', (0, http_1.ah)(async (req, res) => {
    const { comment } = (0, http_1.parse)(zod_1.z.object({ comment: zod_1.z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(1000) }), req.body ?? {});
    const { r, steps } = await loadFor(req);
    const cur = steps[r.current_step];
    if (r.status !== 'pending' || !cur || cur.userId.toLowerCase() !== req.user.id.toLowerCase())
        throw (0, http_1.forbidden)('คุณไม่ใช่ผู้อนุมัติขั้นนี้');
    cur.status = 'rejected';
    cur.at = new Date().toISOString();
    cur.comment = comment;
    const upd = await (0, db_1.q)(`UPDATE ApprovalRequests SET steps_json = @s, status = 'rejected', current_user_id = NULL, updated_at = SYSUTCDATETIME() OUTPUT inserted.request_id WHERE request_id = @i AND status = 'pending'`, { s: db_1.T.text(JSON.stringify(steps)), i: db_1.T.uuid(r.request_id) });
    if (!upd.length)
        throw (0, http_1.conflict)('มีผู้ดำเนินการไปแล้ว กรุณาโหลดใหม่');
    await (0, notify_1.notify)([r.created_by], { type: 'approval', title: 'เอกสารถูกปฏิเสธ', message: `${r.title}: ${comment}`, link: `/approvals?open=${r.request_id}` });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'approval_reject', entityType: 'file', entityId: r.request_id, fileId: r.file_id, newValue: { title: r.title, comment } }, req);
    (0, http_1.ok)(res, { status: 'rejected' });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map