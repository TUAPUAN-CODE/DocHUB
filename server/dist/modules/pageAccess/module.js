"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requirePage = exports.pagesFor = exports.pageLabels = void 0;
const routes_1 = __importDefault(require("./routes"));
var service_1 = require("./service");
Object.defineProperty(exports, "pageLabels", { enumerable: true, get: function () { return service_1.pageLabels; } });
Object.defineProperty(exports, "pagesFor", { enumerable: true, get: function () { return service_1.pagesFor; } });
Object.defineProperty(exports, "requirePage", { enumerable: true, get: function () { return service_1.requirePage; } });
/** Which pages of the left bar (and the AI button) each role sees — set by a root on the "จัดการสิทธิ์" page. */
exports.default = { router: routes_1.default };
//# sourceMappingURL=module.js.map