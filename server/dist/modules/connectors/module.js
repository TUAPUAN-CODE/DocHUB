"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startConnectorScheduler = void 0;
const routes_1 = __importDefault(require("./routes"));
var runner_1 = require("./runner");
Object.defineProperty(exports, "startConnectorScheduler", { enumerable: true, get: function () { return runner_1.startConnectorScheduler; } });
/** Data connectors: pull data from another link / API (JSON, CSV, Excel, SharePoint / OneDrive) into a sheet, on demand or on a schedule. */
exports.default = { router: routes_1.default };
//# sourceMappingURL=module.js.map