"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const routes_1 = __importDefault(require("./routes"));
/**
 * Header / line items (a trolley with several materials): the lines live in their own sheet and are linked with RowLinks
 * (role "contains"). Settings only point to another sheet, so nothing has to be re-mapped when the header sheet is copied.
 */
exports.default = { router: routes_1.default };
//# sourceMappingURL=module.js.map