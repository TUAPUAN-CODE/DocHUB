"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const requests_1 = __importDefault(require("./requests"));
const routes_1 = __importDefault(require("./routes"));
/** User tags (many per user, system tag All = everyone), sharing by tag, and tag requests ("ขอ Tag"). */
const router = (0, express_1.Router)();
router.use(requests_1.default);
router.use(routes_1.default);
exports.default = { router };
//# sourceMappingURL=module.js.map