"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const cellWriter_1 = require("../../services/cellWriter");
const hooks_1 = require("../../services/hooks");
const sheetSettings_1 = require("../../services/sheetSettings");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
/**
 * Design of the "add row" form: how many inputs per line, the order of the fields, the width of each field and which are hidden.
 * Stored in the sheet settings (same for everybody who opens the sheet); the form falls back to "all columns, 2 per line".
 */
const router = (0, express_1.Router)();
const layoutSchema = zod_1.z.object({
    perRow: zod_1.z.number().int().min(1).max(4),
    fields: zod_1.z.array(zod_1.z.object({ columnId: http_1.zId, span: zod_1.z.number().int().min(1).max(4).optional(), hidden: zod_1.z.boolean().optional() })).max(300),
});
router.put('/sheets/:id/form-layout', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const { layout } = (0, http_1.parse)(zod_1.z.object({ layout: layoutSchema.nullable() }), req.body);
    if (layout) {
        const cols = new Map((await (0, cellWriter_1.loadColumns)(sheetId)).map((c) => [c.column_id, c]));
        for (const f of layout.fields)
            if (!cols.has(f.columnId))
                throw (0, http_1.badRequest)('ไม่พบคอลัมน์ที่เลือก (อาจถูกลบแล้ว)');
        // a required column left out of the form would make every new row fail
        const hidden = new Set(layout.fields.filter((f) => f.hidden).map((f) => f.columnId));
        for (const c of cols.values())
            if (c.is_required && c.data_type !== 'doc_number' && hidden.has(c.column_id))
                throw (0, http_1.badRequest)(`ซ่อนคอลัมน์ “${c.column_name}” ไม่ได้ เพราะเป็นคอลัมน์ที่บังคับกรอก`);
    }
    await (0, sheetSettings_1.writeSettingsKey)(sheetId, 'formLayout', layout);
    (0, http_1.ok)(res, { saved: true });
}));
(0, hooks_1.registerAfterSheetCopied)(async ({ newSheetId, columnMap }) => {
    const s = await (0, sheetSettings_1.readSettings)(newSheetId);
    if (!s.formLayout)
        return;
    await (0, sheetSettings_1.writeSettingsKey)(newSheetId, 'formLayout', (0, sheetSettings_1.remapIds)(s.formLayout, new Map(columnMap.map((m) => [m.old_id.toLowerCase(), m.new_id.toLowerCase()]))));
});
exports.default = { router };
//# sourceMappingURL=module.js.map