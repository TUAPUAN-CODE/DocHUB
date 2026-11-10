"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unitMs = exports.UNIT_MS = exports.DAY_MS = void 0;
exports.toNumber = toNumber;
exports.toText = toText;
exports.toBool = toBool;
exports.toDate = toDate;
exports.parts = parts;
exports.formatDate = formatDate;
const types_1 = require("./types");
exports.DAY_MS = 86_400_000;
function toNumber(v) {
    if (v === null)
        return null;
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    if (typeof v === 'string') {
        const t = v.replace(/,/g, '').trim();
        if (t === '')
            return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }
    return v.ms / exports.DAY_MS; // date as days since 1970
}
function toText(v) {
    if (v === null)
        return '';
    if (typeof v === 'string')
        return v;
    if (typeof v === 'boolean')
        return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number')
        return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
    return v.kind === 'date' ? new Date(v.ms).toISOString().slice(0, 10) : new Date(v.ms).toISOString();
}
function toBool(v) {
    if (v === null)
        return false;
    if (typeof v === 'boolean')
        return v;
    if (typeof v === 'number')
        return v !== 0;
    if (typeof v === 'string')
        return ['true', '1', 'yes', 'ใช่'].includes(v.trim().toLowerCase());
    return true;
}
function toDate(v) {
    if (v === null)
        return null;
    if ((0, types_1.isDateV)(v))
        return v;
    if (typeof v === 'string') {
        const t = v.trim();
        const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
        if (d)
            return { kind: 'date', ms: Date.UTC(+d[1], +d[2] - 1, +d[3]) };
        const ms = Date.parse(t);
        return Number.isNaN(ms) ? null : { kind: 'datetime', ms };
    }
    return null;
}
/** wall-clock fields of a date value (a `date` has no time zone; a `datetime` is shown in the app time zone) */
function parts(d, ctx) {
    const t = new Date(d.ms + (d.kind === 'datetime' ? ctx.tzOffsetMinutes * 60_000 : 0));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), dow: t.getUTCDay() };
}
exports.UNIT_MS = {
    second: 1000, seconds: 1000, s: 1000,
    minute: 60_000, minutes: 60_000, n: 60_000,
    hour: 3_600_000, hours: 3_600_000, h: 3_600_000,
    day: exports.DAY_MS, days: exports.DAY_MS, d: exports.DAY_MS,
    week: 7 * exports.DAY_MS, weeks: 7 * exports.DAY_MS, w: 7 * exports.DAY_MS,
};
const unitMs = (u) => {
    const k = toText(u).trim().toLowerCase();
    const ms = exports.UNIT_MS[k];
    if (!ms)
        throw new types_1.FormulaEvalError(`หน่วยเวลา "${k}" ไม่รู้จัก (ใช้ second / minute / hour / day / week)`);
    return ms;
};
exports.unitMs = unitMs;
const pad = (n, w = 2) => String(n).padStart(w, '0');
/** tokens: yyyy yy BBBB (พ.ศ.) MM dd HH mm ss */
function formatDate(d, fmt, ctx) {
    const p = parts(d, ctx);
    return fmt.replace(/yyyy|yy|BBBB|MM|dd|HH|mm|ss/g, (t) => {
        switch (t) {
            case 'yyyy': return String(p.y);
            case 'yy': return pad(p.y % 100);
            case 'BBBB': return String(p.y + 543);
            case 'MM': return pad(p.m);
            case 'dd': return pad(p.d);
            case 'HH': return pad(p.h);
            case 'mm': return pad(p.mi);
            default: return pad(p.s);
        }
    });
}
//# sourceMappingURL=convert.js.map