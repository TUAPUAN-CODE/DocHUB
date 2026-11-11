"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureTypedBaselines = void 0;
const express_1 = require("express");
const docTypes_1 = require("./docTypes");
Object.defineProperty(exports, "ensureTypedBaselines", { enumerable: true, get: function () { return docTypes_1.ensureTypedBaselines; } });
const routes_1 = __importDefault(require("./routes"));
/**
 * Sheet revisions ("ออก Rev"): a user freezes the sheet as Rev.N; each revision keeps what changed since the previous one —
 * the data (Master Data / ทั่วไป) and the format (columns, options, form layout, PDF layouts). Document types of files.
 */
const router = (0, express_1.Router)();
router.use(routes_1.default);
router.use(docTypes_1.router);
exports.default = { router };
//# sourceMappingURL=module.js.map