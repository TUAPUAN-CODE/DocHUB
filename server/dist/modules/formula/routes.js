"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const cellWriter_1 = require("../../services/cellWriter");
const index_1 = require("./index");
const types_1 = require("./types");
const service_1 = require("./service");
const logger_1 = require("../../shared/logger");
const router = (0, express_1.Router)();
/** Functions the formula language offers (for the editor's helper list) */
router.get('/formula/functions', (0, http_1.ah)(async (_req, res) => (0, http_1.ok)(res, { functions: (0, index_1.listFunctions)() })));
/** Live check while the manager types a formula */
router.post('/sheets/:id/formula/validate', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ expr: zod_1.z.string().max(2000), dataType: zod_1.z.string().max(30), columnId: zod_1.z.string().max(60).nullish(), sources: zod_1.z.array(zod_1.z.object({ alias: zod_1.z.string().max(40), sheetId: zod_1.z.string().max(60) })).max(10).optional() }), req.body);
    if (!service_1.FORMULA_TYPES.has(body.dataType))
        throw (0, http_1.badRequest)('ชนิดข้อมูลนี้ใช้สูตรไม่ได้');
    const cols = await (0, cellWriter_1.loadColumns)(sheetId);
    const sources = [];
    const sourceColumns = new Map();
    for (const s of body.sources ?? []) {
        await (0, permissions_1.requireSheet)(req.user, s.sheetId, permissions_1.LV.read);
        sources.push({ alias: s.alias, sheetId: s.sheetId.toLowerCase() });
        sourceColumns.set(s.sheetId.toLowerCase(), (await (0, cellWriter_1.loadColumns)(s.sheetId)).map((x) => ({ id: x.column_id, name: x.column_name, dataType: x.data_type })));
    }
    try {
        const c = (0, index_1.compileFormula)(body.expr, cols.filter((x) => x.column_id !== body.columnId).map((x) => ({ id: x.column_id, name: x.column_name, dataType: x.data_type })), { selfId: body.columnId ?? undefined, sources, sourceColumns });
        (0, http_1.ok)(res, { valid: true, display: c.display, dependsOn: c.deps });
    }
    catch (e) {
        if (e instanceof types_1.FormulaSyntaxError)
            return (0, http_1.ok)(res, { valid: false, message: e.message, pos: e.pos });
        throw e;
    }
}));
/** Recalculate every formula column of the sheet (e.g. after importing data by another route) */
router.post('/sheets/:id/formula/recompute', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    if ((await (0, service_1.countRows)(sheetId)) > service_1.SYNC_LIMIT_ROWS) {
        void (0, service_1.recomputeSheet)(req.user, sheetId).catch((e) => logger_1.logger.error(`formula recompute failed: ${e?.message}`));
        return (0, http_1.ok)(res, { queued: true });
    }
    (0, http_1.ok)(res, { queued: false, ...(await (0, service_1.recomputeSheet)(req.user, sheetId)) });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map