"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.archiveConfig = void 0;
const path_1 = __importDefault(require("path"));
/** Own settings (read from the environment) so the module does not touch the shared config */
exports.archiveConfig = {
    dir: path_1.default.resolve(process.env.ARCHIVE_DIR ?? 'archive'),
    maxMb: Number(process.env.ARCHIVE_MAX_MB) > 0 ? Number(process.env.ARCHIVE_MAX_MB) : 50,
};
//# sourceMappingURL=config.js.map