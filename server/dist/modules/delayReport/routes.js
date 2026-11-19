"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const http_1 = require("../../shared/http");
const bootstrap_1 = require("./bootstrap");
const router = (0, express_1.Router)();
/** Blank Excel form F3PFPV04 for the export "Excel F3PFPV04" of the Delay report (the web page fills the cells, like DelayHUB does) */
router.get('/delay-report/template.xlsx', (0, http_1.ah)(async (_req, res) => {
    const buf = await (0, bootstrap_1.delayTemplate)();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
}));
exports.default = router;
//# sourceMappingURL=routes.js.map