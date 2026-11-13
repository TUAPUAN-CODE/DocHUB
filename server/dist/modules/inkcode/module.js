"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPlanFolderWatcher = void 0;
const routes_1 = __importDefault(require("./routes"));
var watcher_1 = require("./watcher");
Object.defineProperty(exports, "startPlanFolderWatcher", { enumerable: true, get: function () { return watcher_1.startPlanFolderWatcher; } });
/**
 * InkCode: import of the daily production plan (Excel) — into one worksheet, or automatically into the day files of PF1 / PF2 —
 * and the drop folder that does it by itself. The sheets themselves are plain DocHUB sheets (see model.ts).
 */
exports.default = { router: routes_1.default };
//# sourceMappingURL=module.js.map