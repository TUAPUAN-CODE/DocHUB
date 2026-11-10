"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const hooks_1 = require("../../services/hooks");
const sheetSettings_1 = require("../../services/sheetSettings");
const routes_1 = __importDefault(require("./routes"));
/** QR / barcode / RFID text → columns, by formats the manager defines per sheet. Pure parsing lives in parse.ts. */
(0, hooks_1.registerAfterSheetCopied)(async ({ tx, newSheetId, columnMap }) => {
    const s = await (0, sheetSettings_1.readSettings)(newSheetId, tx); // inside the copy's transaction (outside it, it would wait for itself)
    if (!s.scanProfiles)
        return;
    await (0, sheetSettings_1.writeSettingsKey)(newSheetId, 'scanProfiles', (0, sheetSettings_1.remapIds)(s.scanProfiles, new Map(columnMap.map((m) => [m.old_id.toLowerCase(), m.new_id.toLowerCase()]))), tx);
});
exports.default = { router: routes_1.default };
//# sourceMappingURL=module.js.map