"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDelayConnector = void 0;
const routes_1 = __importDefault(require("./routes"));
var bootstrap_1 = require("./bootstrap");
Object.defineProperty(exports, "ensureDelayConnector", { enumerable: true, get: function () { return bootstrap_1.ensureDelayConnector; } });
/** DelayHUB's Delay report F3PFPF67 in DocHUB: connector set up from .env, Excel template proxy (PDF / Excel export: client/src/modules/delayReport). */
exports.default = { router: routes_1.default };
//# sourceMappingURL=module.js.map