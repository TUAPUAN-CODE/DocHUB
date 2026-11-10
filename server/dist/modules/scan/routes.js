"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveScan = resolveScan;
exports.runScan = runScan;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const cellWriter_1 = require("../../services/cellWriter");
const rowCreate_1 = require("../../services/rowCreate");
const rowFind_1 = require("../../services/rowFind");
const rowQuery_1 = require("../../services/rowQuery");
const sheetSettings_1 = require("../../services/sheetSettings");
const socket_1 = require("../../socket");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const parse_1 = require("./parse");
const cellValue_1 = require("../../shared/cellValue");
const router = (0, express_1.Router)();
const profileSchema = zod_1.z.object({
    id: zod_1.z.string().trim().min(1).max(40),
    name: zod_1.z.string().trim().min(1).max(80),
    delimiter: zod_1.z.string().max(5),
    match: zod_1.z.object({ prefix: zod_1.z.string().max(60).nullish(), regex: zod_1.z.string().max(300).nullish(), fieldCount: zod_1.z.number().int().min(1).max(50).nullish() }).nullish(),
    fields: zod_1.z.array(zod_1.z.object({ index: zod_1.z.number().int().min(1).max(50), columnId: http_1.zId })).min(1).max(50),
    action: zod_1.z.enum(['create', 'update']),
    keyColumnId: http_1.zId.nullish(),
    onMiss: zod_1.z.enum(['create', 'reject']).nullish(),
    stamps: zod_1.z.array(http_1.zId).max(6).nullish(),
    onFull: zod_1.z.enum(['ignore', 'reject', 'new_row']).nullish(),
    verify: zod_1.z.object({
        sheetId: http_1.zId, refKeyColumnId: http_1.zId, checkColumnId: http_1.zId.nullish(),
        fill: zod_1.z.array(zod_1.z.object({ fromColumnId: http_1.zId, toColumnId: http_1.zId })).max(20).nullish(),
        onMiss: zod_1.z.enum(['reject', 'allow']),
    }).nullish(),
});
const loadProfiles = async (sheetId) => ((await (0, sheetSettings_1.readSettings)(sheetId)).scanProfiles ?? []);
/** Managers: save the QR formats of this sheet */
router.put('/sheets/:id/scan/profiles', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const { profiles } = (0, http_1.parse)(zod_1.z.object({ profiles: zod_1.z.array(profileSchema).max(20) }), req.body);
    const cols = new Set((await (0, cellWriter_1.loadColumns)(sheetId)).map((c) => c.column_id));
    for (const p of profiles) {
        for (const f of p.fields)
            if (!cols.has(f.columnId))
                throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: ไม่พบคอลัมน์ที่เลือก (อาจถูกลบแล้ว)`);
        if (new Set(p.fields.map((f) => f.index)).size !== p.fields.length)
            throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: ข้อมูลชุดเดียวกันถูกใส่หลายคอลัมน์`);
        if (p.action === 'update' && (!p.keyColumnId || !p.fields.some((f) => f.columnId === p.keyColumnId)))
            throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: โหมดอัปเดตต้องเลือกคอลัมน์ที่ใช้หาแถว และคอลัมน์นั้นต้องมีข้อมูลชุดที่ใส่ให้`);
        if (p.verify) {
            const v = p.verify;
            if (v.sheetId.toLowerCase() === sheetId.toLowerCase())
                throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: ตารางที่ใช้ตรวจต้องเป็นคนละชีตกับชีตนี้`);
            await (0, permissions_1.requireSheet)(req.user, v.sheetId, permissions_1.LV.read);
            const refCols = new Set((await (0, cellWriter_1.loadColumns)(v.sheetId)).map((c) => c.column_id));
            if (!refCols.has(v.refKeyColumnId))
                throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: ไม่พบคอลัมน์ค้นหาในตารางที่ใช้ตรวจ`);
            const check = v.checkColumnId ?? p.keyColumnId;
            if (!check || !p.fields.some((f) => f.columnId === check))
                throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: ต้องเลือกว่าจะนำข้อมูลชุดไหนไปตรวจ (คอลัมน์นั้นต้องมีข้อมูลชุดที่ใส่ให้)`);
            for (const f of v.fill ?? [])
                if (!refCols.has(f.fromColumnId) || !cols.has(f.toColumnId))
                    throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: ไม่พบคอลัมน์ที่เลือกเติมค่า`);
        }
        for (const sc of p.stamps ?? [])
            if (!cols.has(sc))
                throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: ไม่พบคอลัมน์เวลาที่เลือก (อาจถูกลบแล้ว)`);
        if (p.stamps?.length && p.action !== 'update')
            throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: การลงเวลาตามลำดับใช้กับโหมด “อัปเดตแถวที่มีอยู่” เท่านั้น`);
        if (p.match?.regex) {
            try {
                new RegExp(p.match.regex);
            }
            catch {
                throw (0, http_1.badRequest)(`รูปแบบ “${p.name}”: เงื่อนไข regex ไม่ถูกต้อง`);
            }
        }
    }
    await (0, sheetSettings_1.writeSettingsKey)(sheetId, 'scanProfiles', profiles.length ? profiles : null);
    (0, http_1.ok)(res, { saved: true });
}));
/** Shows how a text would be split (editor "try it" box) — nothing is written */
router.post('/sheets/:id/scan/preview', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read);
    const body = (0, http_1.parse)(zod_1.z.object({ text: zod_1.z.string().min(1).max(2000), profile: profileSchema.optional() }), req.body);
    const profile = body.profile ?? (0, parse_1.detectProfile)(body.text, await loadProfiles(sheetId));
    if (!profile)
        return (0, http_1.ok)(res, { profile: null, pieces: [], values: {} });
    (0, http_1.ok)(res, { profile: { id: profile.id, name: profile.name }, ...(0, parse_1.parseScan)(body.text, profile) });
}));
/** Only reads: which format fits the text and which column gets which value (including the values copied from the verify sheet). Nothing is written. */
async function resolveScan(sheetId, text, profileId) {
    const profiles = await loadProfiles(sheetId);
    if (!profiles.length)
        throw (0, http_1.badRequest)('ชีตนี้ยังไม่ได้ตั้งค่ารูปแบบ QR (ผู้จัดการตั้งได้ที่ปุ่ม ตั้งค่าสแกน/ผสม)');
    const profile = profileId ? profiles.find((p) => p.id === profileId) ?? null : (0, parse_1.detectProfile)(text, profiles);
    if (!profile)
        throw (0, http_1.badRequest)('ข้อความที่สแกนไม่ตรงกับรูปแบบ QR ที่ตั้งไว้', { text: text.slice(0, 200) });
    const { values: scanned } = (0, parse_1.parseScan)(text, profile);
    if (!Object.keys(scanned).length)
        throw (0, http_1.badRequest)(`รูปแบบ “${profile.name}”: ไม่พบข้อมูลในตำแหน่งที่กำหนด`);
    const values = { ...scanned };
    if (profile.verify)
        Object.assign(values, await verifyAgainst(profile, scanned, await (0, cellWriter_1.loadColumns)(sheetId)));
    return { profile, values };
}
/** The other sheet: is the scanned value in it? Copies the wanted columns (as text; the normal checks of the column still apply when written) */
async function verifyAgainst(profile, scanned, cols) {
    const v = profile.verify;
    const checkId = v.checkColumnId ?? profile.keyColumnId;
    const value = scanned[checkId];
    const refCols = await (0, cellWriter_1.loadColumns)(v.sheetId);
    const refKey = refCols.find((c) => c.column_id === v.refKeyColumnId);
    const found = value && refKey ? await (0, rowFind_1.findRowByValue)(v.sheetId, refKey, value) : null;
    if (!found) {
        if (v.onMiss === 'reject')
            throw (0, http_1.badRequest)(`ไม่พบ “${value ?? ''}” ในตารางตรวจสอบ (${refKey?.column_name ?? 'คอลัมน์ค้นหา'}) — ไม่บันทึก`, { notFound: true, unknown: value ?? null });
        return {};
    }
    const ids = [...new Set((v.fill ?? []).map((f) => f.fromColumnId))];
    const ref = {};
    if (ids.length) {
        const cells = await (0, db_1.q)(`SELECT column_id, value_text, value_int, value_float, value_date, value_bool, value_json FROM Cells WHERE row_id = @r AND column_id IN ${(0, db_1.idList)('@cc')}`, { r: db_1.T.uuid(found.rowId), cc: (0, db_1.jsonParam)(ids) });
        for (const c of cells) {
            const def = refCols.find((x) => x.column_id === String(c.column_id).toLowerCase());
            if (!def)
                continue;
            const val = (0, cellValue_1.fromStorage)(def.data_type, c);
            ref[String(c.column_id).toLowerCase()] = val === null || val === '' ? null : Array.isArray(val) ? val.join(',') : String(val);
        }
    }
    void cols;
    const merged = (0, parse_1.mergeFill)(scanned, v.fill ?? [], ref);
    return Object.fromEntries(Object.entries(merged).filter(([k]) => !(k in scanned)));
}
/** which of the stamp columns of this row are already filled */
async function filledStamps(rowId, stampIds) {
    const cells = await (0, db_1.q)(`SELECT column_id FROM Cells WHERE row_id = @r AND column_id IN ${(0, db_1.idList)('@cc')}
     AND ((value_text IS NOT NULL AND value_text <> N'') OR value_int IS NOT NULL OR value_float IS NOT NULL OR value_date IS NOT NULL OR value_bool IS NOT NULL)`, { r: db_1.T.uuid(rowId), cc: (0, db_1.jsonParam)(stampIds) });
    const have = new Set(cells.map((c) => String(c.column_id).toLowerCase()));
    return stampIds.map((id) => have.has(id.toLowerCase()));
}
/** Scan core, shared with other modules (line items of a trolley, devices): pick the format, split the text, create / update the row */
async function runScan(u, sheet, sheetId, text, profileId, req) {
    const profiles = await loadProfiles(sheetId);
    if (!profiles.length)
        throw (0, http_1.badRequest)('ชีตนี้ยังไม่ได้ตั้งค่ารูปแบบ QR (ผู้จัดการตั้งได้ที่ปุ่ม ตั้งค่าสแกน/ผสม)');
    const profile = profileId ? profiles.find((p) => p.id === profileId) ?? null : (0, parse_1.detectProfile)(text, profiles);
    if (!profile)
        throw (0, http_1.badRequest)('ข้อความที่สแกนไม่ตรงกับรูปแบบ QR ที่ตั้งไว้', { text: text.slice(0, 200) });
    const { values: scanned } = (0, parse_1.parseScan)(text, profile);
    if (!Object.keys(scanned).length)
        throw (0, http_1.badRequest)(`รูปแบบ “${profile.name}”: ไม่พบข้อมูลในตำแหน่งที่กำหนด`);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const values = { ...scanned };
    if (profile.verify)
        Object.assign(values, await verifyAgainst(profile, scanned, cols));
    const colName = (id) => cols.find((c) => c.column_id === id)?.column_name ?? '';
    const stamps = profile.stamps ?? [];
    const now = new Date().toISOString();
    const found = profile.action === 'update' && profile.keyColumnId && values[profile.keyColumnId]
        ? await (0, rowFind_1.findRowByValue)(sheetId, cols.find((c) => c.column_id === profile.keyColumnId), values[profile.keyColumnId], stamps.length > 0) : null;
    if (profile.action === 'update' && !found && profile.onMiss !== 'create') {
        throw (0, http_1.badRequest)(`ไม่พบแถวที่ ${colName(profile.keyColumnId ?? '') || 'คีย์'} = “${values[profile.keyColumnId] ?? ''}”`, { notFound: true });
    }
    const create = async (extra) => {
        const made = await (0, db_1.withTx)((tx) => (0, rowCreate_1.createRowTx)(tx, u, sheet, sheetId, { ...values, ...extra }, 'scan', req));
        (0, socket_1.emitToSheet)(sheetId, 'rows:changed', { sheetId, action: 'create', rowId: made.rowId, by: u.displayName }, (0, http_1.reqMeta)(req).socketId);
        return made;
    };
    const prof = { id: profile.id, name: profile.name };
    if (found) {
        const updates = Object.entries(values).filter(([c]) => c !== profile.keyColumnId).map(([columnId, value]) => ({ rowId: found.rowId, columnId, value }));
        let stamped;
        let stampedId;
        if (stamps.length) {
            const i = (0, parse_1.firstEmptyStamp)(await filledStamps(found.rowId, stamps));
            if (i >= 0) {
                updates.push({ rowId: found.rowId, columnId: stamps[i], value: now });
                stamped = colName(stamps[i]);
                stampedId = stamps[i];
            }
            else if (profile.onFull === 'reject')
                throw (0, http_1.badRequest)(`แถวนี้ลงเวลาครบทุกช่องแล้ว (${stamps.map(colName).join(' → ')})`);
            else if (profile.onFull === 'new_row') {
                const made = await create({ [stamps[0]]: now });
                return { action: 'created', rowId: made.rowId, rowNo: made.rowNo, profile: prof, stamped: colName(stamps[0]), stampedColumnId: stamps[0] };
            }
            else
                return { action: 'ignored', rowId: found.rowId, rowNo: found.rowNo, profile: prof };
        }
        if (updates.length)
            await (0, cellWriter_1.applyCellUpdates)(u, sheetId, updates, { req, source: 'scan' });
        return { action: 'updated', rowId: found.rowId, rowNo: found.rowNo, profile: prof, stamped, stampedColumnId: stampedId };
    }
    const made = await create(stamps.length ? { [stamps[0]]: now } : {});
    return { action: 'created', rowId: made.rowId, rowNo: made.rowNo, profile: prof, stamped: stamps.length ? colName(stamps[0]) : undefined, stampedColumnId: stamps.length ? stamps[0] : undefined };
}
/** Fills the "add row" form: the same reading as a scan (format + check against the other sheet) but nothing is saved */
router.post('/sheets/:id/scan/resolve', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.write);
    const body = (0, http_1.parse)(zod_1.z.object({ text: zod_1.z.string().min(1).max(2000), profileId: zod_1.z.string().max(40).nullish() }), req.body);
    const r = await resolveScan(sheetId, body.text, body.profileId);
    (0, http_1.ok)(res, { profile: { id: r.profile.id, name: r.profile.name }, values: r.values });
}));
/** A scan from the scan box */
router.post('/sheets/:id/scan', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const u = req.user;
    const { sheet } = await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.write);
    const body = (0, http_1.parse)(zod_1.z.object({ text: zod_1.z.string().min(1).max(2000), profileId: zod_1.z.string().max(40).nullish() }), req.body);
    const r = await runScan(u, sheet, sheetId, body.text, body.profileId, req);
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const rec = await (0, db_1.q)(`SELECT row_id, row_order, created_by, created_at, updated_by, updated_at, deleted_at, deleted_by FROM Rows WHERE row_id = @r`, { r: db_1.T.uuid(r.rowId) });
    const { rows, userIds } = await (0, rowQuery_1.hydrateRows)(rec, cols);
    (0, http_1.ok)(res, { action: r.action, rowNo: r.rowNo, profile: r.profile, stamped: r.stamped ?? null, row: rows[0], users: await (0, rowQuery_1.userNames)(userIds) });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map