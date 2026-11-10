"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const audit_1 = require("../../shared/audit");
const cellValue_1 = require("../../shared/cellValue");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const cellWriter_1 = require("../../services/cellWriter");
const hooks_1 = require("../../services/hooks");
const rowCreate_1 = require("../../services/rowCreate");
const rowFind_1 = require("../../services/rowFind");
const rowQuery_1 = require("../../services/rowQuery");
const sheetSettings_1 = require("../../services/sheetSettings");
const socket_1 = require("../../socket");
const logic_1 = require("./logic");
const router = (0, express_1.Router)();
const cfgSchema = zod_1.z.object({
    deductColumnId: http_1.zId,
    keyColumnId: http_1.zId.nullish(),
    inheritColumnIds: zod_1.z.array(http_1.zId).max(40).nullish(),
    sameColumnIds: zod_1.z.array(http_1.zId).max(10).nullish(),
});
async function mixCfg(sheetId) {
    const c = (await (0, sheetSettings_1.readSettings)(sheetId)).mix;
    if (!c?.deductColumnId)
        throw (0, http_1.badRequest)('ชีตนี้ยังไม่ได้ตั้งค่าการผสม (ผู้จัดการเลือกคอลัมน์ที่จะตัดน้ำหนักได้ที่ปุ่ม ตั้งค่าสแกน/ผสม)');
    return c;
}
router.put('/sheets/:id/mix/settings', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ mix: cfgSchema.nullable() }), req.body);
    if (body.mix) {
        const cols = new Map((await (0, cellWriter_1.loadColumns)(sheetId)).map((c) => [c.column_id, c]));
        const d = cols.get(body.mix.deductColumnId);
        if (!d || !['int', 'float'].includes(d.data_type))
            throw (0, http_1.badRequest)('คอลัมน์ที่ตัดต้องเป็นชนิดตัวเลข (จำนวนเต็ม/ทศนิยม)');
        for (const id of [body.mix.keyColumnId, ...(body.mix.inheritColumnIds ?? []), ...(body.mix.sameColumnIds ?? [])])
            if (id && !cols.has(id))
                throw (0, http_1.badRequest)('ไม่พบคอลัมน์ที่เลือก (อาจถูกลบแล้ว)');
    }
    await (0, sheetSettings_1.writeSettingsKey)(sheetId, 'mix', body.mix);
    (0, http_1.ok)(res, { saved: true });
}));
/** Find the row to mix by scanning / typing its key (e.g. mapping_id) */
router.get('/sheets/:id/mix/find', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.write);
    const cfg = await mixCfg(sheetId);
    const value = String(req.query.value ?? '').trim();
    if (!cfg.keyColumnId)
        throw (0, http_1.badRequest)('ยังไม่ได้เลือกคอลัมน์ที่ใช้ค้นหาแถว (เช่น mapping_id) ในการตั้งค่าการผสม');
    if (!value)
        throw (0, http_1.badRequest)('กรุณาสแกนหรือพิมพ์ค่าที่ใช้ค้นหา');
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const key = cols.find((c) => c.column_id === cfg.keyColumnId);
    const found = key ? await (0, rowFind_1.findRowByValue)(sheetId, key, value) : null;
    if (!found)
        throw (0, http_1.badRequest)(`ไม่พบแถวที่ ${key?.column_name ?? 'คีย์'} = “${value}”`, { notFound: true });
    const rec = await (0, db_1.q)(`SELECT row_id, row_order, created_by, created_at, updated_by, updated_at, deleted_at, deleted_by FROM Rows WHERE row_id = @r`, { r: db_1.T.uuid(found.rowId) });
    const { rows, userIds } = await (0, rowQuery_1.hydrateRows)(rec, cols);
    (0, http_1.ok)(res, { row: rows[0], users: await (0, rowQuery_1.userNames)(userIds) });
}));
/** One level of links of a row: what it was made from, and what was made from it */
router.get('/sheets/:id/rows/:rowId/links', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read);
    const rowId = String(req.params.rowId);
    const link = (otherCol, selfCol) => (0, db_1.q)(`SELECT l.link_id, l.${otherCol} AS other_row_id, l.qty, l.role, l.created_at, r.row_order, r.sheet_id
     FROM RowLinks l JOIN Rows r ON r.row_id = l.${otherCol} WHERE l.${selfCol} = @r ORDER BY l.link_id`, { r: db_1.T.uuid(rowId) });
    const map = (x) => ({ rowId: x.other_row_id, rowNo: x.row_order, sheetId: x.sheet_id, qty: x.qty, role: x.role, at: x.created_at });
    (0, http_1.ok)(res, { madeFrom: (await link('parent_row_id', 'child_row_id')).map(map), usedIn: (await link('child_row_id', 'parent_row_id')).map(map) });
}));
/** Mix: cut the amounts from the chosen rows and make one new lot (new auto number) — all or nothing */
router.post('/sheets/:id/mix', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const u = req.user;
    const { sheet } = await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.write);
    const cfg = await mixCfg(sheetId);
    const body = (0, http_1.parse)(zod_1.z.object({
        inputs: zod_1.z.array(zod_1.z.object({ rowId: http_1.zId, qty: zod_1.z.number().positive().max(1e12) })).min(1).max(100),
        values: zod_1.z.record(zod_1.z.any()).default({}),
        outputQty: zod_1.z.number().positive().max(1e12).nullish(),
    }), req.body);
    if (new Set(body.inputs.map((i) => i.rowId.toLowerCase())).size !== body.inputs.length)
        throw (0, http_1.badRequest)('เลือกแถวเดียวกันซ้ำ รวมจำนวนเป็นรายการเดียว');
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const colMap = new Map(cols.map((c) => [c.column_id, c]));
    const deduct = colMap.get(cfg.deductColumnId);
    if (!deduct)
        throw (0, http_1.badRequest)('คอลัมน์ที่ตัดน้ำหนักถูกลบไปแล้ว ตั้งค่าการผสมใหม่');
    const deductDef = (0, cellValue_1.toColumnDef)(deduct);
    const integer = deduct.data_type === 'int';
    const watched = [...new Set([cfg.deductColumnId, ...(cfg.inheritColumnIds ?? []), ...(cfg.sameColumnIds ?? [])])];
    const result = await (0, db_1.withTx)(async (tx) => {
        const ids = body.inputs.map((i) => i.rowId.toLowerCase());
        const rows = await (0, db_1.q)(`SELECT row_id, row_order FROM Rows WITH (UPDLOCK) WHERE sheet_id = @s AND is_deleted = 0 AND row_id IN ${(0, db_1.idList)('@ids')}`, { s: db_1.T.uuid(sheetId), ids: (0, db_1.jsonParam)(ids) }, tx);
        const rowNo = new Map(rows.map((r) => [String(r.row_id).toLowerCase(), Number(r.row_order)]));
        for (const i of ids)
            if (!rowNo.has(i))
                throw (0, http_1.badRequest)('มีแถวที่เลือกถูกลบไปแล้ว กรุณาโหลดหน้าใหม่');
        const cells = await (0, db_1.q)(`SELECT row_id, column_id, value_text, value_int, value_float, value_date, value_bool, value_json FROM Cells WITH (UPDLOCK, HOLDLOCK)
       WHERE row_id IN ${(0, db_1.idList)('@ids')} AND column_id IN ${(0, db_1.idList)('@cc')}`, { ids: (0, db_1.jsonParam)(ids), cc: (0, db_1.jsonParam)(watched) }, tx);
        const byRow = new Map();
        for (const c of cells) {
            const k = String(c.row_id).toLowerCase();
            if (!byRow.has(k))
                byRow.set(k, {});
            byRow.get(k)[String(c.column_id).toLowerCase()] = (0, cellValue_1.fromStorage)(colMap.get(c.column_id).data_type, c);
        }
        const inputVals = ids.map((i) => byRow.get(i) ?? {});
        if (cfg.sameColumnIds?.length) {
            const bad = (0, logic_1.firstMismatch)(inputVals, cfg.sameColumnIds.map((x) => x.toLowerCase()));
            if (bad)
                throw (0, http_1.badRequest)(`ผสมไม่ได้: “${colMap.get(bad)?.column_name ?? ''}” ของแถวที่เลือกไม่ตรงกัน`);
        }
        // cut
        const remaining = [];
        for (let k = 0; k < body.inputs.length; k++) {
            const id = ids[k];
            let next;
            try {
                next = (0, logic_1.cut)(inputVals[k][cfg.deductColumnId.toLowerCase()] ?? null, body.inputs[k].qty, rowNo.get(id), integer);
            }
            catch (e) {
                throw (0, http_1.badRequest)(e.message);
            }
            await (0, cellWriter_1.writeCell)(tx, { sheetId, rowId: id, col: deductDef, value: next, userId: u.id, source: 'mix' });
            remaining.push({ rowId: id, remaining: next });
        }
        // new lot
        const total = body.outputQty ?? (0, logic_1.sumQty)(body.inputs.map((i) => i.qty));
        const values = {};
        for (const cid of cfg.inheritColumnIds ?? []) {
            const v = inputVals[0][cid.toLowerCase()];
            if (v !== undefined && v !== null)
                values[cid] = v;
        }
        Object.assign(values, body.values);
        values[cfg.deductColumnId] = total;
        const made = await (0, rowCreate_1.createRowTx)(tx, u, sheet, sheetId, values, 'mix', req);
        for (const i of body.inputs) {
            await (0, db_1.q)(`INSERT INTO RowLinks (sheet_id, parent_row_id, child_row_id, qty, role, created_by) VALUES (@s, @p, @c, @q, N'mix_input', @u)`, { s: db_1.T.uuid(sheetId), p: db_1.T.uuid(i.rowId), c: db_1.T.uuid(made.rowId), q: db_1.T.float(i.qty), u: db_1.T.uuid(u.id) }, tx);
        }
        await (0, hooks_1.runAfterCellsWritten)({ tx, user: u, sheetId, rowIds: ids, source: 'mix' });
        await (0, audit_1.audit)({ userId: u.id, action: 'row_mix', entityType: 'row', entityId: made.rowId, fileId: sheet.file_id, sheetId,
            newValue: { rowNo: made.rowNo, inputs: body.inputs.map((i) => ({ rowNo: rowNo.get(i.rowId.toLowerCase()), qty: i.qty })), total } }, req, tx);
        return { ...made, remaining, total };
    });
    (0, socket_1.emitToSheet)(sheetId, 'rows:changed', { sheetId, action: 'mix', rowId: result.rowId, by: u.displayName }, (0, http_1.reqMeta)(req).socketId);
    const rec = await (0, db_1.q)(`SELECT row_id, row_order, created_by, created_at, updated_by, updated_at, deleted_at, deleted_by FROM Rows WHERE row_id = @r`, { r: db_1.T.uuid(result.rowId) });
    const { rows, userIds } = await (0, rowQuery_1.hydrateRows)(rec, cols);
    (0, http_1.ok)(res, { row: rows[0], rowNo: result.rowNo, total: result.total, remaining: result.remaining, users: await (0, rowQuery_1.userNames)(userIds) }, 201);
}));
exports.default = router;
//# sourceMappingURL=routes.js.map