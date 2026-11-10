"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sheetNamesOf = void 0;
exports.detectFormat = detectFormat;
exports.parseRecords = parseRecords;
const papaparse_1 = __importDefault(require("papaparse"));
const XLSX = __importStar(require("xlsx"));
const flat = (o, prefix = '', out = {}) => {
    if (o && typeof o === 'object' && !Array.isArray(o) && !(o instanceof Date))
        for (const [k, v] of Object.entries(o))
            flat(v, prefix ? `${prefix}.${k}` : k, out);
    else
        out[prefix] = Array.isArray(o) ? JSON.stringify(o) : o;
    return out;
};
function detectFormat(cfg, contentType, url, head) {
    if (cfg.format !== 'auto')
        return cfg.format;
    if (head[0] === 0x50 && head[1] === 0x4b)
        return 'xlsx';
    if (/json/i.test(contentType) || /\.json(\?|$)/i.test(url) || /^\s*[[{]/.test(head.subarray(0, 20).toString('utf8')))
        return 'json';
    return 'csv';
}
function parseRecords(body, cfg, contentType = '', url = '') {
    const fmt = detectFormat(cfg, contentType, url, body);
    if (fmt === 'json') {
        let j = JSON.parse(body.toString('utf8'));
        for (const p of (cfg.jsonPath ?? '').split('.').filter(Boolean))
            j = j?.[p];
        if (!Array.isArray(j)) {
            if (j && typeof j === 'object')
                j = [j];
            else
                throw new Error('ไม่พบข้อมูลแบบอาร์เรย์ตาม JSON path ที่ระบุ');
        }
        return j.map((x) => flat(x));
    }
    if (fmt === 'csv') {
        const text = body.toString('utf8').replace(/^﻿/, '');
        const lines = text.split(/\r?\n/);
        const h = Math.max(1, cfg.headerRow ?? 1);
        const r = papaparse_1.default.parse(lines.slice(h - 1).join('\n'), { header: true, skipEmptyLines: true, delimiter: cfg.delimiter || '' });
        return r.data;
    }
    const wb = XLSX.read(body, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[cfg.sheetName && wb.SheetNames.includes(cfg.sheetName) ? cfg.sheetName : wb.SheetNames[0]];
    if (!ws)
        throw new Error('ไม่พบชีตในไฟล์ Excel');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    const h = Math.max(1, cfg.headerRow ?? 1) - 1;
    const head = (rows[h] ?? []).map((x, i) => (x === null || x === '' ? `col${i + 1}` : String(x).trim()));
    return rows.slice(h + 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? null])));
}
const sheetNamesOf = (body) => { try {
    return XLSX.read(body, { type: 'buffer', bookSheets: true }).SheetNames;
}
catch {
    return [];
} };
exports.sheetNamesOf = sheetNamesOf;
//# sourceMappingURL=parse.js.map