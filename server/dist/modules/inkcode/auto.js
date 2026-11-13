"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sheetsOf = void 0;
exports.dayFile = dayFile;
exports.previewAuto = previewAuto;
exports.importAuto = importAuto;
exports.dropPlan = dropPlan;
const db_1 = require("../../config/db");
const http_1 = require("../../shared/http");
const auth_1 = require("../../middleware/auth");
const permissions_1 = require("../../shared/permissions");
const files_1 = require("../../routes/files");
const core_1 = require("./core");
const model_1 = require("./model");
const files_2 = require("../../routes/files");
const db_2 = require("../../config/db");
const structure_1 = require("../../services/structure");
const rowCreate_1 = require("../../services/rowCreate");
const permissions_2 = require("../../shared/permissions");
const plan_1 = require("./plan");
const folderChild = async (parentId, name) => (await (0, db_1.q1)(`SELECT folder_id FROM Folders WHERE is_deleted = 0 AND folder_name = @n AND ((@p IS NULL AND parent_id IS NULL) OR parent_id = @p)`, { n: name, p: db_1.T.uuid(parentId) }))?.folder_id ?? null;
const fileIn = async (folderId, name) => (await (0, db_1.q1)(`SELECT file_id FROM Files WHERE is_deleted = 0 AND folder_id = @f AND file_name = @n`, { f: db_1.T.uuid(folderId), n: name }))?.file_id ?? null;
async function ensureFolder(user, parentId, name) {
    const have = await folderChild(parentId, name);
    if (have)
        return have;
    const row = await (0, db_1.q1)(`INSERT INTO Folders (folder_name, parent_id, color, icon, created_by) OUTPUT inserted.folder_id VALUES (@n, @p, N'#1552F0', N'folder', @u)`, { n: name, p: db_1.T.uuid(parentId), u: db_1.T.uuid(user.id) });
    (0, permissions_1.invalidateFolders)();
    return row.folder_id;
}
/** The folder tree made by seedInkCodeTree.ts — nothing is invented when it is missing */
async function roots() {
    const root = await folderChild(null, model_1.TREE.root);
    const tree = root ? await folderChild(root, model_1.TREE.tree) : null;
    const tplFolder = tree ? await folderChild(tree, model_1.TREE.templateFolder) : null;
    const tpl = tplFolder ? await fileIn(tplFolder, model_1.TREE.dayTemplate) : null;
    if (!tree || !tpl)
        throw (0, http_1.badRequest)(`ยังไม่มีโครงโฟลเดอร์ "${model_1.TREE.tree}" / แม่แบบรายวัน — รัน seedInkCodeTree.ts ก่อน`);
    return { tree, templateFileId: tpl };
}
const sheetsOf = async (fileId) => (await (0, db_1.q)(`SELECT sheet_id, sheet_name FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: db_1.T.uuid(fileId) }));
exports.sheetsOf = sheetsOf;
/** Day file of a plant (…/PF1/2026/10 ตุลาคม/2026-10-03). `create` = false only looks. */
async function dayFile(user, plant, date, create, req) {
    const { tree, templateFileId } = await roots();
    const plantId = await folderChild(tree, plant);
    if (!plantId)
        throw (0, http_1.badRequest)(`ไม่มีโฟลเดอร์โรงงาน "${plant}" ใน ${model_1.TREE.tree} (มีเฉพาะ ${model_1.TREE.plants.join(', ')}) — ตรวจคอลัมน์ Plant ของไลน์ในตาราง ไลน์ หรือเลือกโรงงานเองในเมนู นำเข้าแผนผลิต`);
    const p = (0, model_1.dayPath)(date);
    const path = `${model_1.TREE.tree} / ${plant} / ${p.year} / ${p.month}`;
    let yearId = await folderChild(plantId, p.year);
    let monthId = yearId ? await folderChild(yearId, p.month) : null;
    let id = monthId ? await fileIn(monthId, p.file) : null;
    if (id || !create)
        return { id, folderPath: path, created: false };
    yearId = yearId ?? await ensureFolder(user, plantId, p.year);
    monthId = monthId ?? await ensureFolder(user, yearId, p.month);
    id = await fileIn(monthId, p.file); // another import may have just made it
    if (id)
        return { id, folderPath: path, created: false };
    const tpl = await (0, permissions_1.getFileRow)(templateFileId);
    id = await (0, files_1.duplicateFile)(user, tpl, monthId, p.file, false, req);
    return { id, folderPath: path, created: true };
}
/** The file whose PDF layouts every day file uses (the Worksheet file) — bound again here in case the template lost it */
async function pdfMasterId(templateFileId) {
    const t = await (0, db_1.q1)(`SELECT pdf_master_id FROM Files WHERE file_id = @f`, { f: db_1.T.uuid(templateFileId) });
    if (t?.pdf_master_id)
        return t.pdf_master_id;
    const root = await folderChild(null, model_1.TREE.root);
    return root ? ((await (0, db_1.q1)(`SELECT file_id FROM Files WHERE is_deleted = 0 AND folder_id = @r AND file_name = N'InkCode - ใบออกโค้ดนอกแผน'`, { r: db_1.T.uuid(root) }))?.file_id ?? null) : null;
}
async function prepare(user, buf, o) {
    if ((0, auth_1.isBasicRole)(user.role))
        throw (0, http_1.badRequest)('เฉพาะ Master หรือ Admin เท่านั้นที่นำเข้าแผนอัตโนมัติได้');
    const { templateFileId } = await roots();
    const tplSheet = (await (0, exports.sheetsOf)(templateFileId))[0];
    if (!tplSheet)
        throw (0, http_1.badRequest)('ไฟล์แม่แบบรายวันไม่มีชีต');
    const ctx = await (0, core_1.context)(user, tplSheet.sheet_id.toLowerCase());
    let plan;
    try {
        plan = (0, plan_1.parsePlan)(buf, ctx.knownLines);
    }
    catch (e) {
        throw (0, http_1.badRequest)(e.message);
    }
    const date = o.date ?? plan.date;
    if (!date)
        throw (0, http_1.badRequest)('ไม่พบวันที่ในแผน กรุณาระบุวันที่ผลิต');
    (0, model_1.dayPath)(date);
    const info = await (0, core_1.lineInfo)(ctx.lineLookup);
    const plants = new Map([...info].filter(([, v]) => v.plant).map(([k, v]) => [k, v.plant]));
    const { pairs, known } = await (0, core_1.dbPairs)(plan.items.map((i) => i.doc), ctx.docLookup, ctx.mktLookup);
    const lineMap = o.lineMap ?? {}, plantMap = o.plantMap ?? {};
    const items = (0, core_1.annotate)(plan.items, pairs, known, plants, null).map((i) => {
        const line = lineMap[i.line] ?? i.line;
        const found = plantMap[i.lineRaw] ?? plants.get((0, core_1.norm)(line)) ?? (0, model_1.plantInText)(i.lineRaw) ?? (0, model_1.plantInText)(line) ?? null;
        const np = found ? (0, model_1.normalizePlant)(found) : null;
        const plant = np && model_1.TREE.plants.includes(np) ? np : null; // a plant without a folder is listed as "unknown" instead of stopping the import
        const tableArea = info.get((0, core_1.norm)(line))?.area; // the line table's own "พื้นที่" first, the name of the line only when it is empty
        const area = tableArea && model_1.AREAS.includes(tableArea) ? tableArea : (0, model_1.areaOf)(line, i.product);
        return { ...i, line, plant, area, sheet: (0, model_1.sheetFor)(area, i.shift), otherPlant: false };
    });
    return { plan, date, items, ctx, known: ctx.knownLines };
}
async function previewAuto(user, buf, o) {
    const p = await prepare(user, buf, o);
    const plantsUsed = [...new Set(p.items.map((i) => i.plant).filter(Boolean))];
    const files = [];
    for (const plant of plantsUsed) {
        const d = await dayFile(user, plant, p.date, false);
        files.push({ plant, folderPath: d.folderPath, fileName: p.date, exists: !!d.id, fileId: d.id });
    }
    return { date: p.date, sheetName: p.plan.sheetName, warnings: p.plan.warnings, knownLines: p.known, plants: model_1.TREE.plants, areas: model_1.AREAS, items: p.items, files };
}
/** Sheet `name` of a day file; a file made before the DS / NS split (or from an older template) gets it as a structure copy of its first sheet */
async function ensureSheet(user, fileId, name, sheets) {
    const have = sheets.find((s) => s.sheet_name === name);
    if (have)
        return have.sheet_id.toLowerCase();
    if (!sheets.length)
        return null;
    const id = await (0, db_2.withTx)(async (tx) => (0, files_2.copySheet)(tx, sheets[0].sheet_id, fileId, sheets.length, user.id, false, name));
    sheets.push({ sheet_id: id, sheet_name: name });
    return id.toLowerCase();
}
async function importAuto(user, buf, o, req) {
    const p = await prepare(user, buf, o);
    const out = {
        date: p.date, total: p.items.length, skippedNoPlant: 0, targets: [],
        items: p.items.map((i) => ({ time: i.time, line: i.line, plant: i.plant, area: i.area, sheet: i.sheet, doc: i.doc, country: i.country, qty: i.qty,
            status: !i.plant ? 'ข้าม: ไม่ทราบโรงงาน' : o.onlyMatched !== false && i.inDb === false ? 'ข้าม: ไม่พบในฐานข้อมูล' : 'นำเข้า (แถวที่มีอยู่แล้วไม่ซ้ำ)' })),
    };
    const byPlant = new Map();
    for (const it of p.items) {
        if (!it.plant) {
            out.skippedNoPlant++;
            continue;
        }
        byPlant.set(it.plant, [...(byPlant.get(it.plant) ?? []), it]);
    }
    for (const [plant, list] of byPlant) {
        const live = list.filter((i) => !(o.onlyMatched !== false && i.inDb === false));
        if (!live.length) {
            for (const area of new Set(list.map((i) => i.sheet)))
                out.targets.push({ plant, area, fileId: '', fileName: p.date, folderPath: '', fileCreated: false, result: { created: 0, duplicate: 0, skippedNotInDb: list.filter((i) => i.sheet === area).length, skippedOtherPlant: 0, failed: [] } });
            continue;
        }
        const d = await dayFile(user, plant, p.date, true, req);
        const master = await pdfMasterId((await roots()).templateFileId);
        if (master && master.toLowerCase() !== String(d.id).toLowerCase())
            await (0, db_1.q)(`UPDATE Files SET pdf_master_id = @m WHERE file_id = @f AND pdf_master_id IS NULL`, { m: db_1.T.uuid(master), f: db_1.T.uuid(d.id) });
        const sheets = await (0, exports.sheetsOf)(d.id);
        for (const area of [...new Set(list.map((i) => i.sheet))].sort()) {
            const part = list.filter((i) => i.sheet === area);
            const sid = await ensureSheet(user, d.id, area, sheets);
            if (!sid) {
                out.targets.push({ plant, area, fileId: d.id, fileName: p.date, folderPath: d.folderPath, fileCreated: d.created, result: { created: 0, duplicate: 0, skippedNotInDb: 0, skippedOtherPlant: 0, failed: part.slice(0, 50).map((i) => ({ doc: i.doc, line: i.line, reason: `ไม่มีชีต ${area} ในไฟล์วัน` })) } });
                continue;
            }
            const sheet = { ...(await (0, db_1.q1)(`SELECT s.*, f.folder_id, f.file_name FROM Sheets s JOIN Files f ON f.file_id = s.file_id WHERE s.sheet_id = @s`, { s: db_1.T.uuid(sid) })) };
            const ctx = await (0, core_1.context)(user, sid);
            const result = await (0, core_1.insertItems)(user, sheet, sid, ctx, part, p.date, { onlyMatched: o.onlyMatched !== false, onlyPlant: false }, req);
            out.targets.push({ plant, area, fileId: d.id, fileName: p.date, folderPath: d.folderPath, fileCreated: d.created, result });
        }
    }
    return out;
}
/** Is `folderId` inside "<TREE.tree> / แผนผลิต" (the folder where plan files are dropped)? */
async function inPlanFolder(folderId) {
    let cur = folderId;
    const names = [];
    for (let i = 0; cur && i < 8; i++) {
        const f = await (0, db_1.q1)(`SELECT folder_name, parent_id FROM Folders WHERE folder_id = @f AND is_deleted = 0`, { f: db_1.T.uuid(cur) });
        if (!f)
            break;
        names.push(f.folder_name);
        cur = f.parent_id;
    }
    const at = names.indexOf(model_1.TREE.plans);
    return at >= 0 && names[at + 1] === model_1.TREE.tree;
}
/**
 * A plan file dropped into a plan folder of DocHUB: imported like the "นำเข้าแผนผลิต" page does (nothing to confirm — lines without a
 * plant or not in the database are skipped and listed), and a record file is left in that folder with every row of the plan and what was done to it.
 */
async function dropPlan(user, buf, originalName, folderId, req) {
    await (0, permissions_2.requireFolder)(user, folderId, permissions_2.LV.write);
    if (!(await inPlanFolder(folderId)))
        throw (0, http_1.badRequest)(`วางแผนผลิตได้เฉพาะในโฟลเดอร์ ${model_1.TREE.tree} / ${model_1.TREE.plans} / ปี / เดือน`);
    const r = await importAuto(user, buf, { onlyMatched: true }, req);
    const base = originalName.replace(/\.xlsx?$/i, '').slice(0, 150);
    const name = `แผน ${r.date} · ${base}`;
    const cols = ['ไฟล์แผน', 'วันที่ผลิต', 'เวลา', 'ไลน์', 'โรงงาน', 'พื้นที่', 'Doc.No', 'ประเทศ', 'ยอด', 'ผลการนำเข้า'];
    const recordFileId = await (0, db_2.withTx)(async (tx) => {
        const f = await (0, db_1.q1)(`INSERT INTO Files (file_name, folder_id, description, color, icon, created_by) OUTPUT inserted.file_id VALUES (@n, @fo, @d, N'#16A34A', N'sheet', @u)`, { n: name, fo: db_1.T.uuid(folderId), d: db_1.T.text(`บันทึกการนำเข้าแผนผลิตวันที่ ${r.date} (ไฟล์ ${originalName}) — ข้อมูลอยู่ในไฟล์รายวันของ PF1/PF2`), u: db_1.T.uuid(user.id) }, tx);
        const sh = await (0, db_1.q1)(`INSERT INTO Sheets (file_id, sheet_name, sort_order, created_by) OUTPUT inserted.sheet_id VALUES (@f, N'ผลนำเข้า', 0, @u)`, { f: db_1.T.uuid(f.file_id), u: db_1.T.uuid(user.id) }, tx);
        const ids = [];
        for (const [i, c] of cols.entries())
            ids.push((await (0, structure_1.insertColumn)(tx, sh.sheet_id, { name: c, dataType: 'varchar', isRequired: false, width: c === 'ผลการนำเข้า' ? 240 : 130 }, i, user.id)).column_id);
        for (const it of (r.items ?? []).slice(0, 500)) {
            const vals = [originalName, r.date, it.time ?? '', it.line, it.plant ?? '', it.area, it.doc, it.country, it.qty === null ? '' : String(it.qty), it.status];
            await (0, rowCreate_1.createRowTx)(tx, user, { file_id: f.file_id }, sh.sheet_id, Object.fromEntries(ids.map((id, k) => [id.toLowerCase(), vals[k]])), 'plan-drop', req);
        }
        return f.file_id;
    });
    return { ...r, recordFileId };
}
//# sourceMappingURL=auto.js.map