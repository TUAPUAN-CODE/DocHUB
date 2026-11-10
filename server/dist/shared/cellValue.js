"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.valuesEqual = exports.isEmptyValue = exports.DATA_TYPES = void 0;
exports.toColumnDef = toColumnDef;
exports.parseNumber = parseNumber;
exports.parseDateOnly = parseDateOnly;
exports.parseDateTime = parseDateTime;
exports.parseBool = parseBool;
exports.normalizeValue = normalizeValue;
exports.toStorage = toStorage;
exports.fromStorage = fromStorage;
exports.anyStoredValue = anyStoredValue;
const env_1 = require("../config/env");
const http_1 = require("./http");
exports.DATA_TYPES = [
    'varchar',
    'text',
    'int',
    'float',
    'date',
    'datetime',
    'boolean',
    'select',
    'multi_select',
    'url',
    'email',
    'image',
    'doc_number',
];
function toColumnDef(row) {
    return {
        column_id: row.column_id,
        column_name: row.column_name,
        data_type: row.data_type,
        is_required: !!row.is_required,
        validation: (0, http_1.safeJson)(row.validation_rule, {}) ?? {},
        options: (0, http_1.safeJson)(row.select_options, []) ?? [],
    };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const fail = (error) => ({ ok: false, error });
const okv = (value) => ({ ok: true, value });
const isEmptyValue = (v) => v === null ||
    v === undefined ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0);
exports.isEmptyValue = isEmptyValue;
function parseNumber(v) {
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    if (typeof v === 'string') {
        const s = v.replace(/[,\s฿$€]/g, '').trim();
        if (s === '' || s === '-')
            return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function ymd(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1753 || y > 9999)
        return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1)
        return null;
    return dt.toISOString().slice(0, 10);
}
const fixYear = (y) => {
    if (y < 100)
        return y + 2000;
    if (y > 2400)
        return y - 543; // Buddhist era → Gregorian
    return y;
};
/** Accepts YYYY-MM-DD, DD/MM/YYYY (also พ.ศ.), Date objects and ISO strings. Returns YYYY-MM-DD. */
function parseDateOnly(v) {
    if (v instanceof Date)
        return Number.isNaN(+v) ? null : v.toISOString().slice(0, 10);
    if (typeof v !== 'string')
        return null;
    const s = v.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
    if (m)
        return ymd(fixYear(+m[1]), +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (m)
        return ymd(fixYear(+m[3]), +m[2], +m[1]);
    return null;
}
/** Accepts ISO strings with zone, or local "YYYY-MM-DD HH:mm" / "DD/MM/YYYY HH:mm" (APP_TZ_OFFSET). Returns ISO. */
function parseDateTime(v) {
    if (v instanceof Date)
        return Number.isNaN(+v) ? null : v.toISOString();
    if (typeof v !== 'string')
        return null;
    const s = v.trim();
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
        const d = new Date(s);
        return Number.isNaN(+d) ? null : d.toISOString();
    }
    let y, mo, d, h = 0, mi = 0, se = 0;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
        [y, mo, d] = [fixYear(+m[1]), +m[2], +m[3]];
        h = +(m[4] ?? 0);
        mi = +(m[5] ?? 0);
        se = +(m[6] ?? 0);
    }
    else {
        m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!m)
            return null;
        [d, mo, y] = [+m[1], +m[2], fixYear(+m[3])];
        h = +(m[4] ?? 0);
        mi = +(m[5] ?? 0);
        se = +(m[6] ?? 0);
    }
    if (!ymd(y, mo, d) || h > 23 || mi > 59 || se > 59)
        return null;
    const utc = Date.UTC(y, mo - 1, d, h, mi, se) - env_1.env.tzOffsetMinutes * 60_000;
    return new Date(utc).toISOString();
}
function parseBool(v) {
    if (typeof v === 'boolean')
        return v;
    if (typeof v === 'number')
        return v !== 0;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'ใช่', '✓', '✔', 'x', 'on'].includes(s))
            return true;
        if (['false', '0', 'no', 'n', 'ไม่', 'ไม่ใช่', 'off', '-'].includes(s))
            return false;
    }
    return null;
}
function findOption(options, raw) {
    const s = raw.trim();
    const lower = s.toLowerCase();
    return (options.find((o) => o.value === s) ??
        options.find((o) => o.value.toLowerCase() === lower || o.label.toLowerCase() === lower));
}
const roundTo = (n, d) => {
    const f = 10 ** d;
    return Math.round((n + Number.EPSILON) * f) / f;
};
/**
 * Validates and normalizes any incoming value (typed, pasted text, form input)
 * into the canonical value for the column type.
 */
function normalizeValue(col, raw, opts = {}) {
    const v = col.validation ?? {};
    const name = col.column_name;
    if ((0, exports.isEmptyValue)(raw)) {
        if (col.is_required && !opts.skipRequired)
            return fail(`"${name}" จำเป็นต้องกรอก`);
        return okv(null);
    }
    switch (col.data_type) {
        case 'varchar':
        case 'text':
        case 'doc_number':
        case 'url':
        case 'email': {
            let s = Array.isArray(raw) ? raw.join(', ') : String(raw);
            if (col.data_type !== 'text')
                s = s.trim().replace(/\s*\n\s*/g, ' ');
            const maxLen = v.maxLength ?? (col.data_type === 'text' ? 20000 : 1000);
            if (s.length > maxLen)
                return fail(`"${name}" ยาวได้ไม่เกิน ${maxLen.toLocaleString()} ตัวอักษร`);
            if (col.data_type === 'url') {
                try {
                    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
                    if (!['http:', 'https:'].includes(u.protocol))
                        throw new Error('protocol');
                    s = u.toString();
                }
                catch {
                    return fail(`"${name}" ต้องเป็นลิงก์ที่ถูกต้อง เช่น https://example.com`);
                }
            }
            if (col.data_type === 'email' && !EMAIL_RE.test(s))
                return fail(`"${name}" ต้องเป็นอีเมลที่ถูกต้อง`);
            if (v.pattern) {
                let re = null;
                try {
                    re = new RegExp(v.pattern);
                }
                catch {
                    re = null;
                }
                if (re && !re.test(s))
                    return fail(v.patternMessage || `"${name}" มีรูปแบบไม่ตรงตามที่กำหนด`);
            }
            return okv(s);
        }
        case 'int':
        case 'float': {
            let n = parseNumber(raw);
            if (n === null)
                return fail(`"${name}" ต้องเป็นตัวเลข`);
            if (v.maxDigits) {
                const digits = (typeof raw === 'string' ? raw : String(n)).replace(/[^0-9]/g, '').length;
                if (digits > v.maxDigits)
                    return fail(`"${name}" ต้องไม่เกิน ${v.maxDigits} หลัก`);
            }
            if (col.data_type === 'int') {
                if (!Number.isInteger(n))
                    return fail(`"${name}" ต้องเป็นจำนวนเต็ม`);
                if (!Number.isSafeInteger(n))
                    return fail(`"${name}" มีค่าเกินขอบเขตที่รองรับ`);
            }
            else if (v.decimals !== null && v.decimals !== undefined) {
                n = roundTo(n, v.decimals);
            }
            if (v.min !== null && v.min !== undefined && n < v.min)
                return fail(`"${name}" ต้องไม่น้อยกว่า ${v.min}`);
            if (v.max !== null && v.max !== undefined && n > v.max)
                return fail(`"${name}" ต้องไม่เกิน ${v.max}`);
            return okv(n);
        }
        case 'date': {
            const d = parseDateOnly(raw);
            if (!d)
                return fail(`"${name}" ต้องเป็นวันที่ (วว/ดด/ปปปป)`);
            if (v.minDate && d < v.minDate)
                return fail(`"${name}" ต้องไม่ก่อน ${v.minDate}`);
            if (v.maxDate && d > v.maxDate)
                return fail(`"${name}" ต้องไม่หลัง ${v.maxDate}`);
            return okv(d);
        }
        case 'datetime': {
            const d = parseDateTime(raw);
            if (!d)
                return fail(`"${name}" ต้องเป็นวันที่และเวลาที่ถูกต้อง`);
            if (v.minDate && d.slice(0, 10) < v.minDate)
                return fail(`"${name}" ต้องไม่ก่อน ${v.minDate}`);
            if (v.maxDate && d.slice(0, 10) > v.maxDate)
                return fail(`"${name}" ต้องไม่หลัง ${v.maxDate}`);
            return okv(d);
        }
        case 'boolean': {
            const b = parseBool(raw);
            if (b === null)
                return fail(`"${name}" ต้องเป็นค่า ใช่/ไม่ใช่`);
            return okv(b);
        }
        case 'select': {
            const s = String(Array.isArray(raw) ? raw[0] : raw);
            const opt = findOption(col.options, s);
            if (!opt)
                return fail(`"${s}" ไม่อยู่ในตัวเลือกของ "${name}"`);
            return okv(opt.value);
        }
        case 'multi_select': {
            const parts = (Array.isArray(raw) ? raw.map(String) : String(raw).split(/[,;\n]/))
                .map((p) => p.trim())
                .filter(Boolean);
            const out = [];
            for (const p of parts) {
                const opt = findOption(col.options, p);
                if (!opt)
                    return fail(`"${p}" ไม่อยู่ในตัวเลือกของ "${name}"`);
                if (!out.includes(opt.value))
                    out.push(opt.value);
            }
            if (!out.length) {
                if (col.is_required && !opts.skipRequired)
                    return fail(`"${name}" จำเป็นต้องเลือกอย่างน้อย 1 รายการ`);
                return okv(null);
            }
            if (v.maxSelections && out.length > v.maxSelections)
                return fail(`"${name}" เลือกได้ไม่เกิน ${v.maxSelections} รายการ`);
            return okv(out);
        }
        case 'image': {
            // Uploaded pictures are stored as a list of URLs (/uploads/<file>); the files themselves live in UPLOAD_DIR
            const parts = (Array.isArray(raw) ? raw.map(String) : String(raw).split(/[\n;,]/)).map((p) => p.trim()).filter(Boolean);
            const out = [];
            for (const p of parts) {
                if (!/^(\/uploads\/[\w.-]+|https?:\/\/\S+)$/i.test(p) || p.length > 500)
                    return fail(`"${name}" มีรูปภาพที่ไม่ถูกต้อง`);
                if (!out.includes(p))
                    out.push(p);
            }
            if (!out.length) {
                if (col.is_required && !opts.skipRequired)
                    return fail(`"${name}" จำเป็นต้องมีรูปภาพอย่างน้อย 1 รูป`);
                return okv(null);
            }
            const max = v.maxSelections ?? 200;
            if (out.length > max)
                return fail(`"${name}" ใส่รูปได้ไม่เกิน ${max} รูป`);
            return okv(out);
        }
    }
    return fail(`ไม่รู้จักชนิดข้อมูล ${col.data_type}`);
}
function toStorage(type, value) {
    const s = {
        value_text: null,
        value_int: null,
        value_float: null,
        value_date: null,
        value_bool: null,
        value_json: null,
    };
    if (value === null || value === undefined)
        return s;
    switch (type) {
        case 'int':
            s.value_int = Number(value);
            break;
        case 'float':
            s.value_float = Number(value);
            break;
        case 'date':
            s.value_date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
            break;
        case 'datetime':
            s.value_date = new Date(String(value));
            break;
        case 'boolean':
            s.value_bool = !!value;
            break;
        case 'multi_select':
        case 'image':
            s.value_json = JSON.stringify(value);
            break;
        default:
            s.value_text = String(value);
    }
    return s;
}
const asDate = (v) => (v instanceof Date ? v : new Date(String(v)));
function fromStorage(type, row) {
    if (!row)
        return null;
    switch (type) {
        case 'int':
            return row.value_int === null || row.value_int === undefined ? null : Number(row.value_int);
        case 'float':
            return row.value_float === null || row.value_float === undefined ? null : Number(row.value_float);
        case 'date':
            return row.value_date ? asDate(row.value_date).toISOString().slice(0, 10) : null;
        case 'datetime':
            return row.value_date ? asDate(row.value_date).toISOString() : null;
        case 'boolean':
            return row.value_bool === null || row.value_bool === undefined ? null : !!row.value_bool;
        case 'multi_select':
        case 'image':
            return row.value_json ? (0, http_1.safeJson)(row.value_json, null) : null;
        default:
            return row.value_text ?? null;
    }
}
/** Best-effort value regardless of declared type (used when converting a column type) */
function anyStoredValue(row) {
    if (!row)
        return null;
    if (row.value_text !== null && row.value_text !== undefined)
        return row.value_text;
    if (row.value_int !== null && row.value_int !== undefined)
        return Number(row.value_int);
    if (row.value_float !== null && row.value_float !== undefined)
        return Number(row.value_float);
    if (row.value_date)
        return asDate(row.value_date).toISOString();
    if (row.value_bool !== null && row.value_bool !== undefined)
        return !!row.value_bool;
    if (row.value_json)
        return (0, http_1.safeJson)(row.value_json, null);
    return null;
}
const valuesEqual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
exports.valuesEqual = valuesEqual;
//# sourceMappingURL=cellValue.js.map