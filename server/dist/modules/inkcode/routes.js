"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const core_1 = require("./core");
const plan_1 = require("./plan");
const auto_1 = require("./auto");
const planLink_1 = require("./planLink");
const trace_1 = require("./trace");
const service_1 = require("../pageAccess/service");
const router = (0, express_1.Router)();
/** Search › ย้อนรอยโค้ด Ink: printed code → day-sheet rows + what the plan said + raw materials */
router.get('/inkcode/trace', (0, service_1.requirePage)('search'), (0, http_1.ah)(async (req, res) => (0, http_1.ok)(res, await (0, trace_1.traceCode)(req.user, String(req.query.q ?? '')))));
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
router.post('/inkcode/plan/preview', upload.single('file'), (0, http_1.ah)(async (req, res) => {
    const { sheetId } = (0, http_1.parse)(zod_1.z.object({ sheetId: zod_1.z.string().min(30).max(40) }), req.body);
    if (!req.file)
        throw (0, http_1.badRequest)('ไม่พบไฟล์ที่อัปโหลด');
    const ctx = await (0, core_1.context)(req.user, sheetId.toLowerCase());
    let plan;
    try {
        plan = (0, plan_1.parsePlan)(req.file.buffer, ctx.knownLines);
    }
    catch (e) {
        throw (0, http_1.badRequest)(e.message);
    }
    const { pairs, known } = await (0, core_1.dbPairs)(plan.items.map((i) => i.doc), ctx.docLookup, ctx.mktLookup);
    (0, http_1.ok)(res, { date: plan.date, sheetName: plan.sheetName, warnings: plan.warnings, knownLines: ctx.knownLines, items: (0, core_1.annotate)(plan.items, pairs, known, ctx.plants, ctx.plant), plant: ctx.plant, sheetDate: ctx.sheetDate, fillsTime: ctx.byName.has(core_1.NAMES.time), fillsQty: ctx.byName.has(core_1.NAMES.qty) });
}));
router.post('/inkcode/plan/import', upload.single('file'), (0, http_1.ah)(async (req, res) => {
    const body = (0, http_1.parse)(zod_1.z.object({
        sheetId: zod_1.z.string().min(30).max(40),
        date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        onlyMatched: zod_1.z.enum(['0', '1']).default('1'),
        onlyPlant: zod_1.z.enum(['0', '1']).default('1'), // sheets under a PF1 / PF2 folder: skip lines of the other plant
        allowOtherDate: zod_1.z.enum(['0', '1']).default('0'), // day sheets ("2026-10 …" / "03"): the plan must be for that day
        lineMap: zod_1.z.string().max(20000).optional(), // JSON { "<line text from the plan>": "<line of the reference table>" }
    }), req.body);
    if (!req.file)
        throw (0, http_1.badRequest)('ไม่พบไฟล์ที่อัปโหลด');
    const sheetId = body.sheetId.toLowerCase();
    const user = req.user;
    const { sheet } = await (0, permissions_1.requireSheet)(user, sheetId, permissions_1.LV.write);
    const ctx = await (0, core_1.context)(user, sheetId);
    let plan;
    try {
        plan = (0, plan_1.parsePlan)(req.file.buffer, ctx.knownLines);
    }
    catch (e) {
        throw (0, http_1.badRequest)(e.message);
    }
    const date = body.date ?? plan.date;
    if (!date)
        throw (0, http_1.badRequest)('ไม่พบวันที่ในแผน กรุณาระบุวันที่ผลิต');
    if (ctx.sheetDate && date !== ctx.sheetDate && body.allowOtherDate !== '1')
        throw (0, http_1.badRequest)(`ชีตนี้คือวันที่ ${ctx.sheetDate} แต่แผนเป็นวันที่ ${date} — เปิดชีตของวันที่ ${date} แล้วนำเข้า (หรือยืนยันนำเข้าลงชีตนี้)`);
    const lineMap = (0, http_1.safeJson)(body.lineMap, {});
    const { pairs, known } = await (0, core_1.dbPairs)(plan.items.map((i) => i.doc), ctx.docLookup, ctx.mktLookup);
    const items = (0, core_1.annotate)(plan.items, pairs, known, ctx.plants, ctx.plant).map((i) => { const line = lineMap[i.line] ?? i.line; const plant = ctx.plants.get((0, core_1.norm)(line)) ?? i.plant; return { ...i, line, plant, otherPlant: !!(ctx.plant && plant && plant !== ctx.plant) }; });
    const result = await (0, core_1.insertItems)(user, sheet, sheetId, ctx, items, date, { onlyMatched: body.onlyMatched === '1', onlyPlant: body.onlyPlant === '1' }, req);
    (0, http_1.ok)(res, { date, total: items.length, ...result });
}));
const autoBody = zod_1.z.object({
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    onlyMatched: zod_1.z.enum(['0', '1']).default('1'),
    lineMap: zod_1.z.string().max(20000).optional(), // { "<line text of the plan>": "<line of the reference table>" }
    plantMap: zod_1.z.string().max(20000).optional(), // { "<line text of the plan>": "PF1" | "PF2" } for lines the reference table does not know
});
/** Plan file → preview of where every row goes (plant › day file › area sheet) */
router.post('/inkcode/plan/auto/preview', upload.single('file'), (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(autoBody, req.body);
    if (!req.file)
        throw (0, http_1.badRequest)('ไม่พบไฟล์ที่อัปโหลด');
    (0, http_1.ok)(res, await (0, auto_1.previewAuto)(req.user, req.file.buffer, { date: b.date, lineMap: (0, http_1.safeJson)(b.lineMap, {}), plantMap: (0, http_1.safeJson)(b.plantMap, {}) }));
}));
/** Plan file → rows added to the day files of PF1 / PF2 (day file created from the template when it is the first plan of that day) */
router.post('/inkcode/plan/auto/import', upload.single('file'), (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(autoBody, req.body);
    if (!req.file)
        throw (0, http_1.badRequest)('ไม่พบไฟล์ที่อัปโหลด');
    (0, http_1.ok)(res, await (0, auto_1.importAuto)(req.user, req.file.buffer, { date: b.date, onlyMatched: b.onlyMatched === '1', lineMap: (0, http_1.safeJson)(b.lineMap, {}), plantMap: (0, http_1.safeJson)(b.plantMap, {}) }, req));
}));
/** A plan file dropped into a plan folder (… / แผนผลิต / ปี / เดือน) in the file browser */
router.post('/inkcode/plan/drop', upload.single('file'), (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(zod_1.z.object({ folderId: zod_1.z.string().min(30).max(40) }), req.body);
    if (!req.file)
        throw (0, http_1.badRequest)('ไม่พบไฟล์ที่อัปโหลด');
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    (0, http_1.ok)(res, await (0, auto_1.dropPlan)(req.user, req.file.buffer, name, b.folderId.toLowerCase(), req));
}));
/** The same, from a link (OneDrive / SharePoint / Google Drive / Dropbox / direct) — for computers that only have Excel on the web */
router.post('/inkcode/plan/drop-url', (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(zod_1.z.object({ folderId: zod_1.z.string().min(30).max(40), url: zod_1.z.string().trim().min(8).max(2000) }), req.body);
    const got = await (0, planLink_1.fetchPlanFromLink)(req.user, b.url);
    if ('needsMicrosoft' in got)
        return void (0, http_1.ok)(res, { needsMicrosoft: got.needsMicrosoft });
    (0, http_1.ok)(res, await (0, auto_1.dropPlan)(req.user, got.file.buf, got.file.name, b.folderId.toLowerCase(), req));
}));
router.post('/inkcode/plan/ms-connector', (0, http_1.ah)(async (req, res) => {
    if ((0, auth_1.isBasicRole)(req.user.role))
        throw (0, http_1.badRequest)('เฉพาะ Master หรือ Admin');
    (0, http_1.ok)(res, await (0, planLink_1.ensureMsConnector)(req.user));
}));
exports.default = router;
//# sourceMappingURL=routes.js.map