"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.docDate = exports.seqCount = exports.hasPrefixToken = exports.getDocCfg = void 0;
exports.dateParts = dateParts;
exports.render = render;
exports.looksLikeTemplate = looksLikeTemplate;
exports.docPrefixes = docPrefixes;
exports.nextDocNumbers = nextDocNumbers;
exports.interpretDocRaw = interpretDocRaw;
exports.assertDocNumberConfig = assertDocNumberConfig;
const db_1 = require("../config/db");
const env_1 = require("../config/env");
const http_1 = require("../shared/http");
const cellWriter_1 = require("./cellWriter");
const lookup_1 = require("./lookup");
const getDocCfg = (col) => {
    const d = col.validation?.docNumber;
    return col.data_type === 'doc_number' && d?.template ? d : null;
};
exports.getDocCfg = getDocCfg;
const TOKEN = /\{(PREFIX|YYYYMMDD|YYMMDD|YYYY|YYMM|YY|MM|DD|BBBB|BB|SEQ(?::(\d{1,2}))?)\}/g;
const hasPrefixToken = (t) => /\{PREFIX\}/.test(t);
exports.hasPrefixToken = hasPrefixToken;
const seqCount = (t) => (t.match(/\{SEQ(?::\d{1,2})?\}/g) ?? []).length;
exports.seqCount = seqCount;
const pad = (n, w = 2) => String(n).padStart(w, '0');
/** The wall-clock date used for numbering: a date string (yyyy-mm-dd) or "today" in the configured time zone */
function dateParts(dateStr) {
    let y, m, d;
    const hit = dateStr && /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (hit) {
        y = +hit[1];
        m = +hit[2];
        d = +hit[3];
    }
    else {
        const t = new Date(Date.now() + env_1.env.tzOffsetMinutes * 60_000);
        y = t.getUTCFullYear();
        m = t.getUTCMonth() + 1;
        d = t.getUTCDate();
    }
    return { y, m, d };
}
/** Renders the template; `seq` null leaves the SEQ token as a placeholder (returns the parts around it) */
function render(template, prefix, date, seq) {
    const be = date.y + 543;
    return template.replace(TOKEN, (_m, tok, width) => {
        if (tok.startsWith('SEQ'))
            return seq === null ? '\u0000' : pad(seq, width ? Number(width) : 1);
        switch (tok) {
            case 'PREFIX': return prefix ?? '';
            case 'YYYY': return String(date.y);
            case 'YY': return pad(date.y % 100);
            case 'MM': return pad(date.m);
            case 'DD': return pad(date.d);
            case 'YYMMDD': return `${pad(date.y % 100)}${pad(date.m)}${pad(date.d)}`;
            case 'YYYYMMDD': return `${date.y}${pad(date.m)}${pad(date.d)}`;
            case 'YYMM': return `${pad(date.y % 100)}${pad(date.m)}`;
            case 'BBBB': return String(be);
            case 'BB': return pad(be % 100);
            default: return '';
        }
    });
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const likeEsc = (s) => s.replace(/[%_[]/g, (m) => `[${m}]`);
/** Loose check that a typed / imported full number has the shape of the template */
function looksLikeTemplate(template, value) {
    let re = '';
    let last = 0;
    for (const m of template.matchAll(TOKEN)) {
        re += esc(template.slice(last, m.index));
        re += m[1].startsWith('SEQ') ? '\\d+' : m[1] === 'PREFIX' ? '.+?' : '.+?';
        last = (m.index ?? 0) + m[0].length;
    }
    re += esc(template.slice(last));
    try {
        return new RegExp(`^${re}$`).test(value);
    }
    catch {
        return false;
    }
}
async function docPrefixes(cfg) {
    if (cfg.prefixLookup?.sheetId && cfg.prefixLookup.columnId)
        return (0, lookup_1.lookupValues)({ ...cfg.prefixLookup, parent: null }, null);
    return (cfg.prefixes ?? []).filter(Boolean);
}
/**
 * Next numbers for a batch of requests (one lock per sheet+column, so concurrent users never get the same number).
 * Must run inside a transaction.
 */
async function nextDocNumbers(tx, sheetId, def, cfg, reqs) {
    await (0, db_1.q)(`DECLARE @r INT; EXEC @r = sp_getapplock @Resource = @res, @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 15000; SELECT @r AS r`, { res: `docno:${sheetId}:${def.column_id}` }, tx);
    const counters = new Map(); // text-with-placeholder -> highest sequence handed out / found
    const out = [];
    const hasSeq = (0, exports.seqCount)(cfg.template) > 0;
    for (const r of reqs) {
        const skeleton = render(cfg.template, r.prefix, r.date, null);
        if (!hasSeq) {
            out.push(skeleton);
            continue;
        }
        if (!counters.has(skeleton)) {
            const [pre, ...rest] = skeleton.split('\u0000');
            const post = rest.join('');
            // rows that start/end like this skeleton – deleted rows included so a number is never reused
            const rows = await (0, db_1.q)(`SELECT c.value_text FROM Cells c JOIN Rows r ON r.row_id = c.row_id
         WHERE r.sheet_id = @s AND c.column_id = @c AND c.value_text LIKE @pat`, { s: db_1.T.uuid(sheetId), c: db_1.T.uuid(def.column_id), pat: db_1.T.text(`${likeEsc(pre)}%${likeEsc(post)}`) }, tx);
            const re = new RegExp(`^${esc(pre)}(\\d+)${esc(post)}$`);
            let max = 0;
            for (const row of rows) {
                const m = re.exec(String(row.value_text));
                if (m)
                    max = Math.max(max, Number(m[1]));
            }
            counters.set(skeleton, max);
        }
        const next = counters.get(skeleton) + 1;
        counters.set(skeleton, next);
        const w = Number(/\{SEQ:(\d{1,2})\}/.exec(cfg.template)?.[1] ?? 1);
        out.push(skeleton.replace('\u0000', pad(next, w)));
    }
    return out;
}
/**
 * Decides what a submitted value means:
 *  - a bare prefix (CSM)        -> generate a new number
 *  - a full number of this shape -> keep as typed (imports from another system, manual corrections)
 *  - empty on create without a {PREFIX} token -> generate
 */
function interpretDocRaw(def, cfg, raw, prefixes, mode) {
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    const name = def.column_name;
    if (!text) {
        if (!(0, exports.hasPrefixToken)(cfg.template))
            return mode === 'create' ? { ok: true, kind: 'generate', prefix: null } : def.is_required ? { ok: false, error: `"${name}" จำเป็นต้องกรอก` } : { ok: true, kind: 'value', value: null };
        if (mode === 'create' && def.is_required)
            return { ok: false, error: `กรุณาเลือกหัวเลขของ "${name}"` };
        return { ok: true, kind: 'value', value: null };
    }
    const hit = prefixes.find((p) => p.toLowerCase() === text.toLowerCase());
    if (hit && (0, exports.hasPrefixToken)(cfg.template))
        return { ok: true, kind: 'generate', prefix: hit };
    if (looksLikeTemplate(cfg.template, text))
        return { ok: true, kind: 'value', value: text };
    const example = render(cfg.template, prefixes[0] ?? 'ABC', dateParts(null), 1).replace('\u0000', '1');
    return { ok: false, error: `"${name}" ต้องเลือกหัวเลขจากรายการ หรือกรอกเลขที่ในรูปแบบ เช่น ${example}` };
}
/** Date for the date tokens of a new row: the configured date column of the same row, else today */
const docDate = (cfg, rowRaw) => {
    const v = cfg.dateColumnId ? rowRaw[cfg.dateColumnId] : null;
    return dateParts(typeof v === 'string' ? v : null);
};
exports.docDate = docDate;
/** Validates a doc-number definition when the column is saved */
async function assertDocNumberConfig(user, ownSheetId, cfg) {
    if ((0, exports.seqCount)(cfg.template) > 1)
        throw (0, http_1.badRequest)('รูปแบบเลขที่ใส่ {SEQ} ได้เพียงจุดเดียว');
    if ((0, exports.hasPrefixToken)(cfg.template) && !(cfg.prefixes?.length) && !cfg.prefixLookup?.columnId)
        throw (0, http_1.badRequest)('รูปแบบมี {PREFIX} กรุณากำหนดรายการหัวเลข หรือเลือกดึงจากตารางอื่น');
    if (cfg.prefixLookup?.columnId)
        await (0, lookup_1.assertLookupConfig)(user, ownSheetId, null, { ...cfg.prefixLookup, parent: null });
    if (cfg.dateColumnId) {
        const own = await (0, cellWriter_1.loadColumns)(ownSheetId);
        if (!own.some((c) => c.column_id === cfg.dateColumnId && (c.data_type === 'date' || c.data_type === 'datetime')))
            throw (0, http_1.badRequest)('ไม่พบคอลัมน์วันที่ที่ใช้อ้างอิงในตารางนี้');
    }
}
//# sourceMappingURL=docNumber.js.map