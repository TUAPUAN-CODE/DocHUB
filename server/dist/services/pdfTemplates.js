"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTemplates = parseTemplates;
exports.remapTemplates = remapTemplates;
exports.sheetsOfFile = sheetsOfFile;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
const uid = () => crypto_1.default.randomUUID();
function parseTemplates(raw) {
    const v = (0, http_1.safeJson)(raw ?? null, []);
    return Array.isArray(v) ? v.filter((t) => t && typeof t === 'object' && typeof t.id === 'string') : [];
}
function remapTemplates(templates, from, to, fresh = true) {
    const pick = (id, name) => {
        const byId = from.findIndex((s) => s.sheet_id === id);
        const nm = typeof name === 'string' && name ? name : byId >= 0 ? from[byId].sheet_name : null;
        const byName = nm ? to.find((s) => s.sheet_name.trim().toLowerCase() === nm.trim().toLowerCase()) : undefined;
        return (byName ?? (byId >= 0 ? to[byId] : undefined) ?? to[0])?.sheet_id ?? null;
    };
    const walk = (node) => {
        if (Array.isArray(node))
            return node.map(walk);
        if (node && typeof node === 'object') {
            const o = { ...node };
            for (const k of Object.keys(o))
                o[k] = walk(o[k]);
            if ('sheetId' in o) {
                const nid = pick(o.sheetId, o.sheetName);
                o.sheetId = nid;
                const t = to.find((s) => s.sheet_id === nid);
                if (t)
                    o.sheetName = t.sheet_name;
                // column ids differ in the copy: the client re-maps them by column name (see `columnName` in each table column)
            }
            return o;
        }
        return node;
    };
    return templates.map((t) => ({ ...walk(t), ...(fresh ? { id: uid() } : {}) }));
}
async function sheetsOfFile(fileId, tx) {
    return (await (0, db_1.q)(`SELECT sheet_id, sheet_name FROM Sheets WHERE file_id = @f AND is_deleted = 0 ORDER BY sort_order`, { f: fileId }, tx));
}
//# sourceMappingURL=pdfTemplates.js.map