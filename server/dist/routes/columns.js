"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const audit_1 = require("../shared/audit");
const cellValue_1 = require("../shared/cellValue");
const http_1 = require("../shared/http");
const mappers_1 = require("../shared/mappers");
const permissions_1 = require("../shared/permissions");
const schemas_1 = require("../shared/schemas");
const cellWriter_1 = require("../services/cellWriter");
const structure_1 = require("../services/structure");
const lookup_1 = require("../services/lookup");
const docNumber_1 = require("../services/docNumber");
const socket_1 = require("../socket");
const service_1 = require("../modules/formula/service");
const router = (0, express_1.Router)();
async function getColumn(id) {
    const col = await (0, db_1.q1)(`SELECT * FROM Columns WHERE column_id = @id`, { id: db_1.T.uuid(id) });
    if (!col)
        throw (0, http_1.notFound)('ไม่พบคอลัมน์');
    return col;
}
async function nameTaken(sheetId, name, exceptId) {
    const r = await (0, db_1.q1)(`SELECT 1 AS x FROM Columns WHERE sheet_id = @s AND is_deleted = 0 AND column_name = @n ${exceptId ? 'AND column_id <> @id' : ''}`, { s: db_1.T.uuid(sheetId), n: name, id: db_1.T.uuid(exceptId ?? null) });
    return !!r;
}
router.post('/sheets/:id/columns', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const body = (0, http_1.parse)(schemas_1.columnInput.extend({ insertAt: zod_1.z.number().int().min(0).optional() }), req.body);
    if ((body.dataType === 'select' || body.dataType === 'multi_select') && body.validation?.lookup)
        await (0, lookup_1.assertLookupConfig)(req.user, sheetId, null, body.validation.lookup);
    if (body.dataType === 'doc_number' && body.validation?.docNumber)
        await (0, docNumber_1.assertDocNumberConfig)(req.user, sheetId, body.validation.docNumber);
    if (await nameTaken(sheetId, body.name))
        throw (0, http_1.conflict)(`มีคอลัมน์ชื่อ "${body.name}" อยู่แล้ว`);
    body.validation = await (0, service_1.prepareFormulaValidation)(req.user, sheetId, null, body.dataType, body.validation);
    const row = await (0, db_1.withTx)(async (tx) => {
        let order;
        if (body.insertAt !== undefined) {
            await (0, db_1.q)(`UPDATE Columns SET display_order = display_order + 1 WHERE sheet_id = @s AND display_order >= @o`, { s: db_1.T.uuid(sheetId), o: db_1.T.int(body.insertAt) }, tx);
            order = body.insertAt;
        }
        else {
            const o = await (0, db_1.q1)(`SELECT ISNULL(MAX(display_order), -1) + 1 AS o FROM Columns WHERE sheet_id = @s`, { s: db_1.T.uuid(sheetId) }, tx);
            order = o.o;
        }
        const c = await (0, structure_1.insertColumn)(tx, sheetId, body, order, req.user.id);
        await (0, audit_1.audit)({ userId: req.user.id, action: 'column_create', entityType: 'column', entityId: c.column_id, fileId: sheet.file_id, sheetId,
            newValue: { name: body.name, dataType: body.dataType, isRequired: body.isRequired } }, req, tx);
        return c;
    });
    if ((0, service_1.formulaExprOf)({ data_type: body.dataType, validation: body.validation }))
        await (0, service_1.backfill)(req.user, sheetId);
    (0, socket_1.emitToSheet)(sheetId, 'columns:changed', { sheetId });
    (0, http_1.ok)(res, (0, mappers_1.mapColumn)(row), 201);
}));
/** Converts a stored value to something the new type's parser understands */
function toRawForConversion(v, fromType) {
    if (v === null || v === undefined)
        return null;
    if (Array.isArray(v))
        return v.join(', ');
    if (fromType === 'boolean')
        return v ? 'true' : 'false';
    return v;
}
router.put('/columns/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const before = await getColumn(id);
    if (before.is_deleted)
        throw (0, http_1.badRequest)('คอลัมน์นี้ถูกลบแล้ว กรุณากู้คืนก่อนแก้ไข');
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, before.sheet_id, permissions_1.LV.manage);
    const body = (0, http_1.parse)(schemas_1.columnInput.partial().extend({ convert: zod_1.z.boolean().optional() }), req.body);
    const merged = {
        name: body.name ?? before.column_name,
        dataType: (body.dataType ?? before.data_type),
        isRequired: body.isRequired ?? !!before.is_required,
        width: body.width ?? before.width,
        defaultValue: body.defaultValue !== undefined ? body.defaultValue : before.default_value ? JSON.parse(before.default_value) : null,
        placeholder: body.placeholder !== undefined ? body.placeholder : before.placeholder,
        description: body.description !== undefined ? body.description : before.description,
        validation: body.validation !== undefined ? body.validation : before.validation_rule ? JSON.parse(before.validation_rule) : null,
        options: body.options !== undefined ? body.options : before.select_options ? JSON.parse(before.select_options) : null,
    };
    if (merged.name !== before.column_name && (await nameTaken(before.sheet_id, merged.name, id)))
        throw (0, http_1.conflict)(`มีคอลัมน์ชื่อ "${merged.name}" อยู่แล้ว`);
    if ((merged.dataType === 'select' || merged.dataType === 'multi_select') && merged.validation?.lookup)
        await (0, lookup_1.assertLookupConfig)(req.user, before.sheet_id, id, merged.validation.lookup);
    if (merged.dataType === 'doc_number' && merged.validation?.docNumber)
        await (0, docNumber_1.assertDocNumberConfig)(req.user, before.sheet_id, merged.validation.docNumber);
    merged.validation = (await (0, service_1.prepareFormulaValidation)(req.user, before.sheet_id, id, merged.dataType, merged.validation)) ?? null;
    const checked = (0, schemas_1.checkColumnInput)(merged);
    const formulaBefore = (0, service_1.formulaExprOf)({ data_type: before.data_type, validation: before.validation_rule ? JSON.parse(before.validation_rule) : null });
    const typeChanged = merged.dataType !== before.data_type;
    let conversion = null;
    if (typeChanged) {
        const count = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM Cells c JOIN Rows r ON r.row_id = c.row_id
        WHERE c.column_id = @c AND r.is_deleted = 0`, { c: db_1.T.uuid(id) });
        if (Number(count?.n) > 0 && !body.convert)
            throw (0, http_1.conflict)(`คอลัมน์นี้มีข้อมูล ${Number(count?.n).toLocaleString()} เซลล์ การเปลี่ยนชนิดข้อมูลจะแปลงค่าที่มีอยู่ ค่าที่แปลงไม่ได้จะถูกล้าง`, 'NEEDS_CONVERSION', { cells: Number(count?.n) });
    }
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.q)(`UPDATE Columns SET column_name = @n, data_type = @t, is_required = @r, width = @w, default_value = @dv, placeholder = @ph,
           description = @d, validation_rule = @vr, select_options = @so, updated_at = SYSUTCDATETIME() WHERE column_id = @id`, {
            n: merged.name, t: merged.dataType, r: db_1.T.bit(merged.isRequired), w: db_1.T.int(merged.width),
            dv: db_1.T.text(checked.defaultValue === null ? null : JSON.stringify(checked.defaultValue)),
            ph: db_1.T.text(merged.placeholder ?? null), d: db_1.T.text(merged.description ?? null),
            vr: db_1.T.text(checked.validation ? JSON.stringify(checked.validation) : null),
            so: db_1.T.text(checked.options ? JSON.stringify(checked.options) : null), id: db_1.T.uuid(id),
        }, tx);
        if (typeChanged) {
            const newDef = {
                column_id: id, column_name: merged.name, data_type: merged.dataType, is_required: false,
                validation: checked.validation ?? {}, options: checked.options ?? [],
            };
            const cells = await (0, db_1.q)(`SELECT c.* FROM Cells c JOIN Rows r ON r.row_id = c.row_id WHERE c.column_id = @c AND r.is_deleted = 0`, { c: db_1.T.uuid(id) }, tx);
            let converted = 0;
            let cleared = 0;
            for (const c of cells) {
                const oldVal = (0, cellValue_1.fromStorage)(before.data_type, c) ?? (0, cellValue_1.anyStoredValue)(c);
                const n = (0, cellValue_1.normalizeValue)(newDef, toRawForConversion(oldVal, before.data_type), { skipRequired: true });
                const value = n.ok ? n.value : null;
                if (value === null && oldVal !== null)
                    cleared++;
                else
                    converted++;
                await (0, cellWriter_1.writeCell)(tx, { sheetId: before.sheet_id, rowId: c.row_id, col: newDef, value, userId: req.user.id, source: 'type_change', readType: before.data_type });
            }
            conversion = { converted, cleared };
        }
        await (0, audit_1.audit)({ userId: req.user.id, action: 'column_update', entityType: 'column', entityId: id, fileId: sheet.file_id, sheetId: before.sheet_id,
            oldValue: (0, mappers_1.mapColumn)(before), newValue: { ...merged, conversion } }, req, tx);
    });
    const formulaAfter = (0, service_1.formulaExprOf)({ data_type: merged.dataType, validation: checked.validation });
    // a changed formula is filled into existing rows; a converted column feeds the formulas that read it
    if (formulaAfter !== formulaBefore || typeChanged)
        await (0, service_1.backfill)(req.user, before.sheet_id);
    (0, socket_1.emitToSheet)(before.sheet_id, 'columns:changed', { sheetId: before.sheet_id });
    (0, http_1.ok)(res, { column: (0, mappers_1.mapColumn)(await getColumn(id)), conversion });
}));
router.post('/sheets/:id/columns/reorder', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const { ids } = (0, http_1.parse)(zod_1.z.object({ ids: zod_1.z.array(http_1.zId).min(1).max(500) }), req.body);
    await (0, db_1.withTx)(async (tx) => {
        for (const [i, cid] of ids.entries())
            await (0, db_1.q)(`UPDATE Columns SET display_order = @o WHERE column_id = @c AND sheet_id = @s`, { o: db_1.T.int(i), c: db_1.T.uuid(cid), s: db_1.T.uuid(sheetId) }, tx);
    });
    (0, socket_1.emitToSheet)(sheetId, 'columns:changed', { sheetId });
    (0, http_1.ok)(res, { reordered: true });
}));
router.delete('/columns/:id', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const col = await getColumn(id);
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, col.sheet_id, permissions_1.LV.manage);
    const remaining = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM Columns WHERE sheet_id = @s AND is_deleted = 0`, { s: db_1.T.uuid(col.sheet_id) });
    if (Number(remaining?.n) <= 1)
        throw (0, http_1.badRequest)('ชีตต้องมีอย่างน้อย 1 คอลัมน์');
    const used = await (0, service_1.formulaDependents)(col.sheet_id, id);
    if (used.length)
        throw (0, http_1.conflict)(`ลบไม่ได้ คอลัมน์นี้ถูกใช้ในสูตรของ: ${used.join(', ')}`, 'USED_BY_FORMULA', { columns: used });
    await (0, db_1.q)(`UPDATE Columns SET is_deleted = 1, deleted_at = SYSUTCDATETIME() WHERE column_id = @id`, { id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'column_delete', entityType: 'column', entityId: id, fileId: sheet.file_id, sheetId: col.sheet_id,
        oldValue: { name: col.column_name, dataType: col.data_type } }, req);
    (0, socket_1.emitToSheet)(col.sheet_id, 'columns:changed', { sheetId: col.sheet_id });
    (0, http_1.ok)(res, { deleted: true });
}));
router.post('/columns/:id/restore', (0, http_1.ah)(async (req, res) => {
    const id = (0, http_1.pid)(req);
    const col = await getColumn(id);
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, col.sheet_id, permissions_1.LV.manage);
    if (await nameTaken(col.sheet_id, col.column_name, id))
        throw (0, http_1.conflict)(`มีคอลัมน์ชื่อ "${col.column_name}" อยู่แล้ว กรุณาเปลี่ยนชื่อคอลัมน์นั้นก่อน`);
    await (0, db_1.q)(`UPDATE Columns SET is_deleted = 0, deleted_at = NULL, updated_at = SYSUTCDATETIME() WHERE column_id = @id`, { id: db_1.T.uuid(id) });
    await (0, audit_1.audit)({ userId: req.user.id, action: 'column_restore', entityType: 'column', entityId: id, fileId: sheet.file_id, sheetId: col.sheet_id,
        newValue: { name: col.column_name } }, req);
    (0, socket_1.emitToSheet)(col.sheet_id, 'columns:changed', { sheetId: col.sheet_id });
    (0, http_1.ok)(res, (0, mappers_1.mapColumn)(await getColumn(id)));
}));
exports.default = router;
//# sourceMappingURL=columns.js.map