"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitScan = exports.firstEmptyStamp = void 0;
exports.matchScore = matchScore;
exports.detectProfile = detectProfile;
exports.parseScan = parseScan;
exports.mergeFill = mergeFill;
/** index of the first empty stamp column, or -1 when all are filled */
const firstEmptyStamp = (filled) => filled.findIndex((f) => !f);
exports.firstEmptyStamp = firstEmptyStamp;
const splitScan = (text, delimiter) => {
    const d = delimiter === '\\t' ? '\t' : delimiter;
    const t = text.replace(/[\r\n]+$/g, '');
    return (d ? t.split(d) : [t]).map((s) => s.trim());
};
exports.splitScan = splitScan;
/** How well a profile fits the text: -1 = does not fit; otherwise the number of criteria it satisfied (0 = no criteria, last resort) */
function matchScore(text, p) {
    const m = p.match ?? {};
    const parts = (0, exports.splitScan)(text, p.delimiter);
    let score = 0;
    if (m.prefix) {
        if (!text.trim().toLowerCase().startsWith(m.prefix.toLowerCase()))
            return -1;
        score++;
    }
    if (m.fieldCount) {
        if (parts.length !== m.fieldCount)
            return -1;
        score++;
    }
    if (m.regex) {
        try {
            if (m.regex.length > 300 || !new RegExp(m.regex, 'i').test(text))
                return -1;
        }
        catch {
            return -1;
        }
        score++;
    }
    const need = Math.max(0, ...p.fields.map((f) => f.index));
    if (parts.length < need)
        return -1; // a piece the profile needs is missing
    return score;
}
function detectProfile(text, profiles) {
    let best = null;
    let bestScore = -1;
    for (const p of profiles) {
        const s = matchScore(text, p);
        if (s > bestScore) {
            best = p;
            bestScore = s;
        }
    }
    return best;
}
/** column id → text of the piece (empty pieces are skipped) */
function parseScan(text, p) {
    const pieces = (0, exports.splitScan)(text, p.delimiter);
    const values = {};
    for (const f of p.fields) {
        const v = pieces[f.index - 1];
        if (v !== undefined && v !== '')
            values[f.columnId] = v;
    }
    return { pieces, values };
}
/** Values copied from the row found in the other sheet; what the scan itself carried wins when it is not empty */
function mergeFill(scanned, fill, ref) {
    const out = { ...scanned };
    for (const f of fill) {
        const v = ref[f.fromColumnId];
        const have = out[f.toColumnId];
        if (v !== null && v !== undefined && (have === undefined || have === null || have === ''))
            out[f.toColumnId] = v;
    }
    return out;
}
//# sourceMappingURL=parse.js.map