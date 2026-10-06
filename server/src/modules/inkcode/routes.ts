import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { badRequest, ah, ok, parse, safeJson } from '../../shared/http';
import { LV, requireSheet } from '../../shared/permissions';
import { annotate, context, dbPairs, insertItems, NAMES, norm } from './core';
import { parsePlan } from './plan';
import { dropPlan, importAuto, previewAuto } from './auto';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

router.post('/inkcode/plan/preview', upload.single('file'), ah(async (req, res) => {
  const { sheetId } = parse(z.object({ sheetId: z.string().min(30).max(40) }), req.body);
  if (!req.file) throw badRequest('ไม่พบไฟล์ที่อัปโหลด');
  const ctx = await context(req.user!, sheetId.toLowerCase());
  let plan;
  try { plan = parsePlan(req.file.buffer, ctx.knownLines); } catch (e) { throw badRequest((e as Error).message); }
  const { pairs, known } = await dbPairs(plan.items.map((i) => i.doc), ctx.docLookup, ctx.mktLookup);
  ok(res, { date: plan.date, sheetName: plan.sheetName, warnings: plan.warnings, knownLines: ctx.knownLines, items: annotate(plan.items, pairs, known, ctx.plants, ctx.plant), plant: ctx.plant, sheetDate: ctx.sheetDate, fillsTime: ctx.byName.has(NAMES.time), fillsQty: ctx.byName.has(NAMES.qty) });
}));

router.post('/inkcode/plan/import', upload.single('file'), ah(async (req, res) => {
  const body = parse(z.object({
    sheetId: z.string().min(30).max(40),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    onlyMatched: z.enum(['0', '1']).default('1'),
    onlyPlant: z.enum(['0', '1']).default('1'),       // sheets under a PF1 / PF2 folder: skip lines of the other plant
    allowOtherDate: z.enum(['0', '1']).default('0'),  // day sheets ("2026-10 …" / "03"): the plan must be for that day
    lineMap: z.string().max(20000).optional(),       // JSON { "<line text from the plan>": "<line of the reference table>" }
  }), req.body);
  if (!req.file) throw badRequest('ไม่พบไฟล์ที่อัปโหลด');
  const sheetId = body.sheetId.toLowerCase();
  const user = req.user!;
  const { sheet } = await requireSheet(user, sheetId, LV.write);
  const ctx = await context(user, sheetId);
  let plan;
  try { plan = parsePlan(req.file.buffer, ctx.knownLines); } catch (e) { throw badRequest((e as Error).message); }
  const date = body.date ?? plan.date;
  if (!date) throw badRequest('ไม่พบวันที่ในแผน กรุณาระบุวันที่ผลิต');
  if (ctx.sheetDate && date !== ctx.sheetDate && body.allowOtherDate !== '1') throw badRequest(`ชีตนี้คือวันที่ ${ctx.sheetDate} แต่แผนเป็นวันที่ ${date} — เปิดชีตของวันที่ ${date} แล้วนำเข้า (หรือยืนยันนำเข้าลงชีตนี้)`);
  const lineMap = safeJson<Record<string, string>>(body.lineMap, {});
  const { pairs, known } = await dbPairs(plan.items.map((i) => i.doc), ctx.docLookup, ctx.mktLookup);
  const items = annotate(plan.items, pairs, known, ctx.plants, ctx.plant).map((i) => { const line = lineMap[i.line] ?? i.line; const plant = ctx.plants.get(norm(line)) ?? i.plant; return { ...i, line, plant, otherPlant: !!(ctx.plant && plant && plant !== ctx.plant) }; });

  const result = await insertItems(user, sheet, sheetId, ctx, items, date, { onlyMatched: body.onlyMatched === '1', onlyPlant: body.onlyPlant === '1' }, req);
  ok(res, { date, total: items.length, ...result });
}));

const autoBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  onlyMatched: z.enum(['0', '1']).default('1'),
  lineMap: z.string().max(20000).optional(),     // { "<line text of the plan>": "<line of the reference table>" }
  plantMap: z.string().max(20000).optional(),    // { "<line text of the plan>": "PF1" | "PF2" } for lines the reference table does not know
});

/** Plan file → preview of where every row goes (plant › day file › area sheet) */
router.post('/inkcode/plan/auto/preview', upload.single('file'), ah(async (req, res) => {
  const b = parse(autoBody, req.body);
  if (!req.file) throw badRequest('ไม่พบไฟล์ที่อัปโหลด');
  ok(res, await previewAuto(req.user!, req.file.buffer, { date: b.date, lineMap: safeJson(b.lineMap, {}), plantMap: safeJson(b.plantMap, {}) }));
}));

/** Plan file → rows added to the day files of PF1 / PF2 (day file created from the template when it is the first plan of that day) */
router.post('/inkcode/plan/auto/import', upload.single('file'), ah(async (req, res) => {
  const b = parse(autoBody, req.body);
  if (!req.file) throw badRequest('ไม่พบไฟล์ที่อัปโหลด');
  ok(res, await importAuto(req.user!, req.file.buffer, { date: b.date, onlyMatched: b.onlyMatched === '1', lineMap: safeJson(b.lineMap, {}), plantMap: safeJson(b.plantMap, {}) }, req));
}));

/** A plan file dropped into a plan folder (… / แผนผลิต / ปี / เดือน) in the file browser */
router.post('/inkcode/plan/drop', upload.single('file'), ah(async (req, res) => {
  const b = parse(z.object({ folderId: z.string().min(30).max(40) }), req.body);
  if (!req.file) throw badRequest('ไม่พบไฟล์ที่อัปโหลด');
  const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  ok(res, await dropPlan(req.user!, req.file.buffer, name, b.folderId.toLowerCase(), req));
}));

export default router;
