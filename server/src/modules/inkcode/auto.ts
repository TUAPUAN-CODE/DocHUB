import type { Request } from 'express';
import { q, q1, T } from '../../config/db';
import { badRequest } from '../../shared/http';
import { AuthUser, isBasicRole } from '../../middleware/auth';
import { getFileRow, invalidateFolders } from '../../shared/permissions';
import { duplicateFile } from '../../routes/files';
import { annotate, context, dbPairs, insertItems, InsertResult, linePlants, norm } from './core';
import { areaOf, AREAS, dayPath, plantInText, TREE } from './model';
import { parsePlan } from './plan';

/**
 * A plan file → the right place by itself: the production date picks the day file (created from the template when it is the first plan
 * of that day), the plant of each line picks PF1 / PF2, the area of the line (Pouch / Can / Cup) picks the sheet of that file.
 * The code lines are formulas of the sheet, so they fill in as soon as the rows are added.
 */
export interface AutoOptions { date?: string; onlyMatched?: boolean; lineMap?: Record<string, string>; plantMap?: Record<string, string> }

const folderChild = async (parentId: string | null, name: string): Promise<string | null> =>
  (await q1(`SELECT folder_id FROM Folders WHERE is_deleted = 0 AND folder_name = @n AND ((@p IS NULL AND parent_id IS NULL) OR parent_id = @p)`, { n: name, p: T.uuid(parentId) }))?.folder_id ?? null;
const fileIn = async (folderId: string, name: string): Promise<string | null> =>
  (await q1(`SELECT file_id FROM Files WHERE is_deleted = 0 AND folder_id = @f AND file_name = @n`, { f: T.uuid(folderId), n: name }))?.file_id ?? null;

async function ensureFolder(user: AuthUser, parentId: string, name: string): Promise<string> {
  const have = await folderChild(parentId, name);
  if (have) return have;
  const row = await q1(`INSERT INTO Folders (folder_name, parent_id, color, icon, created_by) OUTPUT inserted.folder_id VALUES (@n, @p, N'#1552F0', N'folder', @u)`, { n: name, p: T.uuid(parentId), u: T.uuid(user.id) });
  invalidateFolders();
  return row!.folder_id as string;
}

/** The folder tree made by seedInkCodeTree.ts — nothing is invented when it is missing */
async function roots() {
  const root = await folderChild(null, TREE.root);
  const tree = root ? await folderChild(root, TREE.tree) : null;
  const tplFolder = tree ? await folderChild(tree, TREE.templateFolder) : null;
  const tpl = tplFolder ? await fileIn(tplFolder, TREE.dayTemplate) : null;
  if (!tree || !tpl) throw badRequest(`ยังไม่มีโครงโฟลเดอร์ "${TREE.tree}" / แม่แบบรายวัน — รัน seedInkCodeTree.ts ก่อน`);
  return { tree, templateFileId: tpl };
}

export const sheetsOf = async (fileId: string) => (await q(`SELECT sheet_id, sheet_name FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: T.uuid(fileId) })) as { sheet_id: string; sheet_name: string }[];

/** Day file of a plant (…/PF1/2026/10 ตุลาคม/2026-10-03). `create` = false only looks. */
export async function dayFile(user: AuthUser, plant: string, date: string, create: boolean, req?: Request): Promise<{ id: string | null; folderPath: string; created: boolean }> {
  const { tree, templateFileId } = await roots();
  const plantId = await folderChild(tree, plant);
  if (!plantId) throw badRequest(`ไม่มีโฟลเดอร์ ${plant} ใน ${TREE.tree}`);
  const p = dayPath(date);
  const path = `${TREE.tree} / ${plant} / ${p.year} / ${p.month}`;
  let yearId = await folderChild(plantId, p.year);
  let monthId = yearId ? await folderChild(yearId, p.month) : null;
  let id = monthId ? await fileIn(monthId, p.file) : null;
  if (id || !create) return { id, folderPath: path, created: false };
  yearId = yearId ?? await ensureFolder(user, plantId, p.year);
  monthId = monthId ?? await ensureFolder(user, yearId, p.month);
  id = await fileIn(monthId, p.file);   // another import may have just made it
  if (id) return { id, folderPath: path, created: false };
  const tpl = await getFileRow(templateFileId);
  id = await duplicateFile(user, tpl, monthId, p.file, false, req);
  return { id, folderPath: path, created: true };
}

async function prepare(user: AuthUser, buf: Buffer, o: AutoOptions) {
  if (isBasicRole(user.role)) throw badRequest('เฉพาะ Master หรือ Admin เท่านั้นที่นำเข้าแผนอัตโนมัติได้');
  const { templateFileId } = await roots();
  const tplSheet = (await sheetsOf(templateFileId))[0];
  if (!tplSheet) throw badRequest('ไฟล์แม่แบบรายวันไม่มีชีต');
  const ctx = await context(user, tplSheet.sheet_id.toLowerCase());
  let plan;
  try { plan = parsePlan(buf, ctx.knownLines); } catch (e) { throw badRequest((e as Error).message); }
  const date = o.date ?? plan.date;
  if (!date) throw badRequest('ไม่พบวันที่ในแผน กรุณาระบุวันที่ผลิต');
  dayPath(date);
  const plants = await linePlants(ctx.lineLookup);
  const { pairs, known } = await dbPairs(plan.items.map((i) => i.doc), ctx.docLookup, ctx.mktLookup);
  const lineMap = o.lineMap ?? {}, plantMap = o.plantMap ?? {};
  const items = annotate(plan.items, pairs, known, plants, null).map((i) => {
    const line = lineMap[i.line] ?? i.line;
    const plant = (plantMap[i.lineRaw] ?? plants.get(norm(line)) ?? plantInText(i.lineRaw) ?? plantInText(line) ?? null)?.toUpperCase() ?? null;
    return { ...i, line, plant, area: areaOf(line, i.product), otherPlant: false };
  });
  return { plan, date, items, ctx, known: ctx.knownLines };
}

export async function previewAuto(user: AuthUser, buf: Buffer, o: AutoOptions) {
  const p = await prepare(user, buf, o);
  const plantsUsed = [...new Set(p.items.map((i) => i.plant).filter(Boolean))] as string[];
  const files: { plant: string; folderPath: string; fileName: string; exists: boolean; fileId: string | null }[] = [];
  for (const plant of plantsUsed) { const d = await dayFile(user, plant, p.date, false); files.push({ plant, folderPath: d.folderPath, fileName: p.date, exists: !!d.id, fileId: d.id }); }
  return { date: p.date, sheetName: p.plan.sheetName, warnings: p.plan.warnings, knownLines: p.known, plants: TREE.plants, areas: AREAS, items: p.items, files };
}

export interface AutoResult { date: string; total: number; skippedNoPlant: number; targets: { plant: string; area: string; fileId: string; fileName: string; folderPath: string; fileCreated: boolean; result: InsertResult }[] }

export async function importAuto(user: AuthUser, buf: Buffer, o: AutoOptions, req?: Request): Promise<AutoResult> {
  const p = await prepare(user, buf, o);
  const out: AutoResult = { date: p.date, total: p.items.length, skippedNoPlant: 0, targets: [] };
  const byPlant = new Map<string, typeof p.items>();
  for (const it of p.items) {
    if (!it.plant) { out.skippedNoPlant++; continue; }
    byPlant.set(it.plant, [...(byPlant.get(it.plant) ?? []), it]);
  }
  for (const [plant, list] of byPlant) {
    const live = list.filter((i) => !(o.onlyMatched !== false && i.inDb === false));
    if (!live.length) { for (const area of new Set(list.map((i) => i.area))) out.targets.push({ plant, area, fileId: '', fileName: p.date, folderPath: '', fileCreated: false, result: { created: 0, duplicate: 0, skippedNotInDb: list.filter((i) => i.area === area).length, skippedOtherPlant: 0, failed: [] } }); continue; }
    const d = await dayFile(user, plant, p.date, true, req);
    const sheets = await sheetsOf(d.id!);
    for (const area of AREAS) {
      const part = list.filter((i) => i.area === area);
      if (!part.length) continue;
      const sh = sheets.find((s) => s.sheet_name === area) ?? sheets.find((s) => s.sheet_name === 'อื่นๆ');
      if (!sh) { out.targets.push({ plant, area, fileId: d.id!, fileName: p.date, folderPath: d.folderPath, fileCreated: d.created, result: { created: 0, duplicate: 0, skippedNotInDb: 0, skippedOtherPlant: 0, failed: part.slice(0, 50).map((i) => ({ doc: i.doc, line: i.line, reason: `ไม่มีชีต ${area} ในไฟล์วัน` })) } }); continue; }
      const sid = sh.sheet_id.toLowerCase();
      const sheet = { ...(await q1(`SELECT s.*, f.folder_id, f.file_name FROM Sheets s JOIN Files f ON f.file_id = s.file_id WHERE s.sheet_id = @s`, { s: T.uuid(sid) })) };
      const ctx = await context(user, sid);
      const result = await insertItems(user, sheet, sid, ctx, part as any, p.date, { onlyMatched: o.onlyMatched !== false, onlyPlant: false }, req);
      out.targets.push({ plant, area: sh.sheet_name, fileId: d.id!, fileName: p.date, folderPath: d.folderPath, fileCreated: d.created, result });
    }
  }
  return out;
}
