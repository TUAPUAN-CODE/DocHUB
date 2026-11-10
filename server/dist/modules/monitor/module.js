"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const routes_1 = __importDefault(require("./routes"));
const traffic_1 = require("./traffic");
/** Admin Monitor page: requests through the Cloudflare tunnel / LAN, per minute, hour, day and month */
exports.default = { router: routes_1.default, trafficMeter: traffic_1.trafficMeter, startTrafficFlush: traffic_1.startTrafficFlush };
//# sourceMappingURL=module.js.map