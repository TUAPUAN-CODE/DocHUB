"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const hooks_1 = require("../../services/hooks");
const routes_1 = __importDefault(require("./routes"));
const service_1 = require("./service");
const cellWriter_1 = require("../../services/cellWriter");
/**
 * Formula columns: a normal typed column whose cells are computed from the other cells of the row.
 * The result is stored in Cells like any value, so sorting, filtering, dashboards and exports work unchanged.
 * Everything the module needs from the core goes through services/hooks.ts.
 */
(0, hooks_1.registerColumnGuard)((col) => ((0, service_1.formulaExprOf)(col) ? 'คอลัมน์นี้คำนวณจากสูตรอัตโนมัติ แก้ไขเองไม่ได้' : null));
(0, hooks_1.registerAfterCellsWritten)(async (ctx) => {
    (0, service_1.scheduleReaders)(ctx.user, ctx.sheetId); // sheets that read this one through LOOKUP are recalculated shortly after
    return ctx.source === 'formula' ? [] : (0, service_1.recomputeRows)(ctx.tx, ctx.sheetId, ctx.rowIds, ctx.user.id);
});
// managers get the readable formula and the names of the files/sheets it reads
(0, hooks_1.registerColumnDecorator)(async ({ columns, sheetId }) => {
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    for (const out of columns) {
        const src = cols.find((c) => c.column_id === out.id || c.column_id === out.columnId);
        if (!src || !(0, service_1.formulaExprOf)({ data_type: src.data_type, validation: out.validation }))
            continue;
        const d = await (0, service_1.describeFormula)({ ...src, validation: out.validation }, cols);
        if (d)
            out.formula = d;
    }
});
(0, hooks_1.registerAfterSheetCopied)(({ tx, newSheetId, columnMap }) => (0, service_1.remapAfterCopy)(tx, newSheetId, columnMap));
exports.default = { router: routes_1.default };
//# sourceMappingURL=module.js.map