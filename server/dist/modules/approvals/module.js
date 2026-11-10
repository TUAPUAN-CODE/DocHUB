"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const routes_1 = __importDefault(require("./routes"));
/** Approval flows: a PDF goes through approvers one by one; each approval stamps that person's signature onto the PDF. */
exports.default = { router: routes_1.default };
//# sourceMappingURL=module.js.map