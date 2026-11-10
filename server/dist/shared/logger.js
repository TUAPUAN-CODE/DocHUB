"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const env_1 = require("../config/env");
exports.logger = winston_1.default.createLogger({
    level: env_1.env.isProd ? 'info' : 'debug',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), env_1.env.isProd
        ? winston_1.default.format.json()
        : winston_1.default.format.printf(({ timestamp, level, message, ...rest }) => {
            const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
            return `${timestamp} ${level.toUpperCase()} ${message}${extra}`;
        })),
    transports: [new winston_1.default.transports.Console()],
});
//# sourceMappingURL=logger.js.map