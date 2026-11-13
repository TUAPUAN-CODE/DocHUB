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
const permissions_2 = require("../../shared/permissions");
const plan_1 = require("./plan");
const record_1 = require("./record");
const news_1 = require("./news");
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
/**
 * The folders under "InkCode" (any depth). The tree made by seedInkCodeTree.ts may be moved / renamed by the users: the parts are
 * found by their own names wherever they are under InkCode — the file "แม่แบบรายวัน", the plant folders PF1 / PF2, and the
 * folder "แผนผลิต" — not by a fixed path.
 */
async function inkFolders() {
    const root = await folderChild(null, model_1.TREE.root);
    if (!root)
        return null;
    const all = (await (0, db_1.q)(`SELECT folder_id, folder_name, parent_id FROM Folders WHERE is_deleted = 0`));
    const kids = new Map();
    for (const f of all)
        if (f.parent_id) {
            const k = String(f.parent_id).toLowerCase();
            kids.set(k, [...(kids.get(k) ?? []), f]);
        }
    const list = [{ id: root, name: model_1.TREE.root, parent: null, depth: 0 }];
    for (let i = 0; i < list.length && list.length < 20_000; i++)
        for (const c of kids.get(list[i].id.toLowerCase()) ?? [])
            list.push({ id: c.folder_id, name: String(c.folder_name).trim(), parent: list[i].id, depth: list[i].depth + 1 });
    return { root, list };
}
/** A file of that name in any folder under InkCode (the shallowest one) */
async function fileUnder(name) {
    const t = await inkFolders();
    if (!t)
        return null;
    const depth = new Map(t.list.map((f) => [f.id.toLowerCase(), f.depth]));
    const hits = (await (0, db_1.q)(`SELECT file_id, folder_id FROM Files WHERE is_deleted = 0 AND file_name = @n`, { n: name }))
        .filter((h) => h.folder_id && depth.has(String(h.folder_id).toLowerCase()))
        .sort((a, b) => depth.get(String(a.folder_id).toLowerCase()) - depth.get(String(b.folder_id).toLowerCase()));
    return hits[0]?.file_id ?? null;
}
/** Day template + plant folders — nothing is invented when they are missing */
async function roots() {
    const t = await inkFolders();
    const tpl = await fileUnder(model_1.TREE.dayTemplate);
    if (!t || !tpl)
        throw (0, http_1.badRequest)(`ไม่พบไฟล์ "${model_1.TREE.dayTemplate}" ในโฟลเดอร์ ${model_1.TREE.root} (ย้ายได้ แต่ห้ามลบหรือเปลี่ยนชื่อไฟล์นี้) — รัน seedInkCodeTree.ts ถ้ายังไม่เคยสร้าง`);
    // the plant folder PF1 / PF2 (the shallowest of that name; outside the plan-drop folders)
    const plantFolder = (plant) => t.list.find((f) => f.name.toUpperCase() === plant.toUpperCase() && !pathNames(t.list, f).includes(model_1.TREE.plans))?.id ?? null;
    return { templateFileId: tpl, plantFolder };
}
const pathNames = (list, f) => {
    const out = [];
    for (let p = f.parent; p;) {
        const x = list.find((y) => y.id === p);
        if (!x)
            break;
        out.push(x.name);
        p = x.parent;
    }
    return out;
};
const sheetsOf = async (fileId) => (await (0, db_1.q)(`SELECT sheet_id, sheet_name FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: db_1.T.uuid(fileId) }));
exports.sheetsOf = sheetsOf;
/** Day file of a plant (…/PF1/2026/10 ตุลาคม/2026-10-03). `create` = false only looks. */
async function dayFile(user, plant, date, create, req) {
    const { templateFileId, plantFolder } = await roots();
    const plantId = plantFolder(plant);
    if (!plantId)
        throw (0, http_1.badRequest)(`ไม่มีโฟลเดอร์โรงงาน "${plant}" ในโฟลเดอร์ ${model_1.TREE.root} (มีเฉพาะ ${model_1.TREE.plants.join(', ')}) — ตรวจคอลัมน์ Plant ของไลน์ในตาราง ไลน์ หรือเลือกโรงงานเองในเมนู นำเข้าแผนผลิต`);
    const p = (0, model_1.dayPath)(date);
    const path = `${plant} / ${p.year} / ${p.month} / ${p.day}`;
    let yearId = await folderChild(plantId, p.year);
    let monthId = yearId ? await folderChild(yearId, p.month) : null;
    let dayId = monthId ? await folderChild(monthId, p.day) : null;
    // the day folder; a day file made before day folders existed sits in the month folder itself — used where it is
    let id = (dayId ? await fileIn(dayId, p.file) : null) ?? (monthId ? await fileIn(monthId, p.file) : null);
    if (id || !create)
        return { id, folderPath: path, created: false };
    yearId = yearId ?? await ensureFolder(user, plantId, p.year);
    monthId = monthId ?? await ensureFolder(user, yearId, p.month);
    dayId = dayId ?? await ensureFolder(user, monthId, p.day);
    id = await fileIn(dayId, p.file); // another import may have just made it
    if (id)
        return { id, folderPath: path, created: false };
    const tpl = await (0, permissions_1.getFileRow)(templateFileId);
    id = await (0, files_1.duplicateFile)(user, tpl, dayId, p.file, false, req);
    return { id, folderPath: path, created: true };
}
/** The file whose PDF layouts every day file uses (the Worksheet file) — bound again here in case the template lost it */
async function pdfMasterId(templateFileId) {
    const t = await (0, db_1.q1)(`SELECT pdf_master_id FROM Files WHERE file_id = @f`, { f: db_1.T.uuid(templateFileId) });
    if (t?.pdf_master_id)
        return t.pdf_master_id;
    return fileUnder('InkCode - ใบออกโค้ดนอกแผน');
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
    const r = await importPrepared(user, p, o, req);
    // the page "นำเข้าแผนผลิต" and the disk folder make no record file, but QC is still told about New Code products
    const items = p.items.map((i, k) => ({ ...i, status: r.items?.[k]?.status ?? '' }));
    const alerts = (0, record_1.findAlerts)(items, await (0, record_1.masterRemarks)(p.ctx.docLookup?.sheetId ?? null, items.map((i) => i.doc)), new Map(), []);
    const first = r.targets.find((t) => t.fileId);
    const newsPostId = await (0, news_1.postNewCodeNews)(user, p.date, alerts, first ? `/files/${first.fileId}` : null).catch((e) => { console.error('[inkcode] news post failed', e); return null; });
    return { ...r, newsPostId };
}
async function importPrepared(user, p, o, req) {
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
/** Is `folderId` inside a folder "แผนผลิต" somewhere under "InkCode" (the folders where plan files are dropped)? */
async function inPlanFolder(folderId) {
    let cur = folderId;
    const names = [];
    for (let i = 0; cur && i < 12; i++) {
        const f = await (0, db_1.q1)(`SELECT folder_name, parent_id FROM Folders WHERE folder_id = @f AND is_deleted = 0`, { f: db_1.T.uuid(cur) });
        if (!f)
            break;
        names.push(String(f.folder_name).trim());
        cur = f.parent_id;
    }
    const at = names.indexOf(model_1.TREE.plans);
    return at >= 0 && names[names.length - 1] === model_1.TREE.root && !cur;
}
/**
 * A plan file dropped into a plan folder of DocHUB: imported like the "นำเข้าแผนผลิต" page does (nothing to confirm — lines without a
 * plant or not in the database are skipped and listed), and a record file is left in that folder with everything the plan says
 * (runs, raw-material rows, the text above the table) and the alerts found (record.ts).
 */
async function dropPlan(user, buf, originalName, folderId, req) {
    await (0, permissions_2.requireFolder)(user, folderId, permissions_2.LV.write);
    if (!(await inPlanFolder(folderId)))
        throw (0, http_1.badRequest)(`วางแผนผลิตได้เฉพาะในโฟลเดอร์ ${model_1.TREE.plans} / ปี / เดือน ภายใต้ ${model_1.TREE.root}`);
    const p = await prepare(user, buf, { onlyMatched: true });
    const r = await importPrepared(user, p, { onlyMatched: true }, req);
    const items = p.items.map((i, k) => ({ ...i, status: r.items?.[k]?.status ?? '' }));
    const docs = items.map((i) => i.doc);
    const alerts = (0, record_1.findAlerts)(items, await (0, record_1.masterRemarks)(p.ctx.docLookup?.sheetId ?? null, docs), await (0, record_1.lastRevs)(p.date, docs), p.plan.warnings);
    const recordFileId = await (0, record_1.writeRecord)(user, folderId, originalName, p.date, p.plan, items, alerts, req);
    const newsPostId = await (0, news_1.postNewCodeNews)(user, p.date, alerts, `/files/${recordFileId}`).catch((e) => { console.error('[inkcode] news post failed', e); return null; });
    return { ...r, recordFileId, alerts, newsPostId };
}
//# sourceMappingURL=auto.js.map