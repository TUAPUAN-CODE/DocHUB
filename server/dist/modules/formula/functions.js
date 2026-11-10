"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDateV = exports.listFunctions = exports.getFunction = void 0;
exports.registerFunction = registerFunction;
exports.parseHM = parseHM;
const convert_1 = require("./convert");
const types_1 = require("./types");
Object.defineProperty(exports, "isDateV", { enumerable: true, get: function () { return types_1.isDateV; } });
const registry = new Map();
/** Add (or replace) a function of the formula language — the engine itself never needs to change */
function registerFunction(def) { registry.set(def.name.toUpperCase(), { ...def, name: def.name.toUpperCase() }); }
const getFunction = (name) => registry.get(name.toUpperCase());
exports.getFunction = getFunction;
const listFunctions = () => [...registry.values()].map((f) => ({ name: f.name, ...f.doc, minArgs: f.minArgs, maxArgs: Number.isFinite(f.maxArgs) ? f.maxArgs : null }));
exports.listFunctions = listFunctions;
const num = (v, what = 'ตัวเลข') => {
    const n = (0, convert_1.toNumber)(v);
    if (n === null)
        throw new types_1.FormulaEvalError(`ต้องเป็น${what}`);
    return n;
};
const numbers = (args) => args.map(convert_1.toNumber).filter((n) => n !== null);
const date = (v) => {
    const d = (0, convert_1.toDate)(v);
    if (!d)
        throw new types_1.FormulaEvalError('ต้องเป็นวันที่');
    return d;
};
const round = (x, n = 0) => { const f = 10 ** n; return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f; };
const def = (d) => registerFunction(d);
const G = { logic: 'ตรรกะ', math: 'คำนวณ', text: 'ข้อความ', date: 'วันที่และเวลา' };
// ---- logic
def({ name: 'IF', minArgs: 2, maxArgs: 3, lazy: true, doc: { group: G.logic, signature: 'IF(เงื่อนไข, ถ้าจริง, ถ้าเท็จ)', description: 'เลือกค่าตามเงื่อนไข', example: 'IF([น้ำหนัก] > 100, "หนัก", "ปกติ")' },
    fn: (a) => ((0, convert_1.toBool)(a[0]()) ? a[1]() : a[2] ? a[2]() : null) });
def({ name: 'AND', minArgs: 1, maxArgs: Infinity, doc: { group: G.logic, signature: 'AND(a, b, …)', description: 'จริงเมื่อทุกค่าเป็นจริง' }, fn: (a) => a.every((x) => (0, convert_1.toBool)(x)) });
def({ name: 'OR', minArgs: 1, maxArgs: Infinity, doc: { group: G.logic, signature: 'OR(a, b, …)', description: 'จริงเมื่อมีค่าใดค่าหนึ่งเป็นจริง' }, fn: (a) => a.some((x) => (0, convert_1.toBool)(x)) });
def({ name: 'NOT', minArgs: 1, maxArgs: 1, doc: { group: G.logic, signature: 'NOT(a)', description: 'กลับค่าจริง/เท็จ' }, fn: (a) => !(0, convert_1.toBool)(a[0]) });
def({ name: 'ISBLANK', minArgs: 1, maxArgs: 1, doc: { group: G.logic, signature: 'ISBLANK(ค่า)', description: 'จริงเมื่อเซลล์ว่าง' }, fn: (a) => a[0] === null || (typeof a[0] === 'string' && a[0].trim() === '') });
def({ name: 'IFERROR', minArgs: 2, maxArgs: 2, lazy: true, doc: { group: G.logic, signature: 'IFERROR(ค่า, ค่าสำรอง)', description: 'ใช้ค่าสำรองเมื่อคำนวณค่าแรกไม่ได้ (เช่น แปลงตัวเลข/วันที่ไม่ได้)', example: 'IFERROR(DATEVALUE([วันที่]), "")' },
    fn: (a) => { try {
        return a[0]();
    }
    catch (e) {
        if (e instanceof types_1.FormulaEvalError)
            return a[1]();
        throw e;
    } } });
def({ name: 'COALESCE', minArgs: 1, maxArgs: Infinity, lazy: true, doc: { group: G.logic, signature: 'COALESCE(a, b, …)', description: 'ค่าแรกที่ไม่ว่าง' },
    fn: (a) => { for (const t of a) {
        const v = t();
        if (v !== null && !(typeof v === 'string' && v.trim() === ''))
            return v;
    } return null; } });
// ---- math
def({ name: 'ROUND', minArgs: 1, maxArgs: 2, doc: { group: G.math, signature: 'ROUND(x, ทศนิยม)', description: 'ปัดเศษ', example: 'ROUND([ก] / [ข], 2)' }, fn: (a) => round(num(a[0]), a[1] === undefined ? 0 : num(a[1])) });
def({ name: 'FLOOR', minArgs: 1, maxArgs: 1, doc: { group: G.math, signature: 'FLOOR(x)', description: 'ปัดลงเป็นจำนวนเต็ม' }, fn: (a) => Math.floor(num(a[0])) });
def({ name: 'CEIL', minArgs: 1, maxArgs: 1, doc: { group: G.math, signature: 'CEIL(x)', description: 'ปัดขึ้นเป็นจำนวนเต็ม' }, fn: (a) => Math.ceil(num(a[0])) });
def({ name: 'ABS', minArgs: 1, maxArgs: 1, doc: { group: G.math, signature: 'ABS(x)', description: 'ค่าสัมบูรณ์' }, fn: (a) => Math.abs(num(a[0])) });
def({ name: 'MIN', minArgs: 1, maxArgs: Infinity, doc: { group: G.math, signature: 'MIN(a, b, …)', description: 'ค่าต่ำสุด (ข้ามค่าว่าง)' }, fn: (a) => { const n = numbers(a); return n.length ? Math.min(...n) : null; } });
def({ name: 'MAX', minArgs: 1, maxArgs: Infinity, doc: { group: G.math, signature: 'MAX(a, b, …)', description: 'ค่าสูงสุด (ข้ามค่าว่าง)' }, fn: (a) => { const n = numbers(a); return n.length ? Math.max(...n) : null; } });
def({ name: 'SUM', minArgs: 1, maxArgs: Infinity, doc: { group: G.math, signature: 'SUM(a, b, …)', description: 'ผลรวม (ข้ามค่าว่าง)' }, fn: (a) => numbers(a).reduce((s, x) => s + x, 0) });
def({ name: 'AVG', minArgs: 1, maxArgs: Infinity, doc: { group: G.math, signature: 'AVG(a, b, …)', description: 'ค่าเฉลี่ย (ข้ามค่าว่าง)' }, fn: (a) => { const n = numbers(a); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null; } });
def({ name: 'VALUE', minArgs: 1, maxArgs: 1, doc: { group: G.math, signature: 'VALUE(ข้อความ)', description: 'แปลงข้อความเป็นตัวเลข' }, fn: (a) => (0, convert_1.toNumber)(a[0]) });
// ---- text
def({ name: 'CONCAT', minArgs: 1, maxArgs: Infinity, doc: { group: G.text, signature: 'CONCAT(a, b, …)', description: 'ต่อข้อความ (หรือใช้ &)' }, fn: (a) => a.map(convert_1.toText).join('') });
def({ name: 'TEXT', minArgs: 1, maxArgs: 1, doc: { group: G.text, signature: 'TEXT(ค่า)', description: 'แปลงเป็นข้อความ' }, fn: (a) => (0, convert_1.toText)(a[0]) });
def({ name: 'UPPER', minArgs: 1, maxArgs: 1, doc: { group: G.text, signature: 'UPPER(ข้อความ)', description: 'ตัวพิมพ์ใหญ่' }, fn: (a) => (0, convert_1.toText)(a[0]).toUpperCase() });
def({ name: 'LOWER', minArgs: 1, maxArgs: 1, doc: { group: G.text, signature: 'LOWER(ข้อความ)', description: 'ตัวพิมพ์เล็ก' }, fn: (a) => (0, convert_1.toText)(a[0]).toLowerCase() });
def({ name: 'TRIM', minArgs: 1, maxArgs: 1, doc: { group: G.text, signature: 'TRIM(ข้อความ)', description: 'ตัดช่องว่างหน้า-หลัง' }, fn: (a) => (0, convert_1.toText)(a[0]).trim() });
def({ name: 'LEN', minArgs: 1, maxArgs: 1, doc: { group: G.text, signature: 'LEN(ข้อความ)', description: 'จำนวนตัวอักษร' }, fn: (a) => [...(0, convert_1.toText)(a[0])].length });
def({ name: 'LEFT', minArgs: 2, maxArgs: 2, doc: { group: G.text, signature: 'LEFT(ข้อความ, n)', description: 'n ตัวแรก' }, fn: (a) => [...(0, convert_1.toText)(a[0])].slice(0, Math.max(0, num(a[1]))).join('') });
def({ name: 'RIGHT', minArgs: 2, maxArgs: 2, doc: { group: G.text, signature: 'RIGHT(ข้อความ, n)', description: 'n ตัวท้าย' }, fn: (a) => { const c = [...(0, convert_1.toText)(a[0])]; const n = Math.max(0, num(a[1])); return n === 0 ? '' : c.slice(-n).join(''); } });
def({ name: 'MID', minArgs: 3, maxArgs: 3, doc: { group: G.text, signature: 'MID(ข้อความ, เริ่ม, n)', description: 'n ตัวอักษรเริ่มจากตำแหน่งที่กำหนด (ตำแหน่งแรก = 1 เหมือน Excel)', example: 'MID([โค้ด], 3, 9)' },
    fn: (a) => [...(0, convert_1.toText)(a[0])].slice(Math.max(0, num(a[1]) - 1), Math.max(0, num(a[1]) - 1) + Math.max(0, num(a[2]))).join('') });
def({ name: 'FILL', minArgs: 2, maxArgs: 2, doc: { group: G.text, signature: 'FILL(แบบ, ตัวแปร)', description: 'แทน {ชื่อ} ในแบบข้อความด้วยค่าจาก "ชื่อ=ค่า|ชื่อ=ค่า" (ชื่อที่ไม่พบจะคง {ชื่อ} ไว้ให้เห็น) ใช้ทำแบบโค้ดที่พิมพ์บนบรรจุภัณฑ์', example: 'FILL("{P} S{YC}{MC}{DC}", "P=B23AA|YC=5|MC=A|DC=3")' },
    fn: (a) => {
        const vars = new Map();
        for (const part of (0, convert_1.toText)(a[1]).split('|')) {
            const i = part.indexOf('=');
            if (i > 0)
                vars.set(part.slice(0, i).trim(), part.slice(i + 1));
        }
        return (0, convert_1.toText)(a[0]).replace(/\{([^{}]+)\}/g, (m, k) => (vars.has(k.trim()) ? vars.get(k.trim()) : m));
    } });
def({ name: 'CONTAINS', minArgs: 2, maxArgs: 2, doc: { group: G.text, signature: 'CONTAINS(ข้อความ, คำค้น)', description: 'จริงเมื่อมีคำค้น (ไม่สนตัวพิมพ์)' }, fn: (a) => (0, convert_1.toText)(a[0]).toLowerCase().includes((0, convert_1.toText)(a[1]).toLowerCase()) });
def({ name: 'FORMATNUM', minArgs: 2, maxArgs: 2, doc: { group: G.text, signature: 'FORMATNUM(x, ทศนิยม)', description: 'ข้อความตัวเลขพร้อมจุลภาค', example: 'FORMATNUM([น้ำหนัก], 1)' },
    fn: (a) => num(a[0]).toLocaleString('en-US', { minimumFractionDigits: Math.max(0, num(a[1])), maximumFractionDigits: Math.max(0, num(a[1])) }) });
// ---- durations (report-style)
def({ name: 'MINUTES', minArgs: 2, maxArgs: 2, doc: { group: G.date, signature: 'MINUTES(เริ่ม, จบ)', description: 'จำนวนนาทีระหว่างสองเวลา — ว่างถ้าขาดค่าใดค่าหนึ่งหรือจบก่อนเริ่ม', example: 'MINUTES([เข้าห้องเย็น], [ออกห้องเย็น])' },
    fn: (a) => { const s = (0, convert_1.toDate)(a[0]); const e = (0, convert_1.toDate)(a[1]); if (!s || !e)
        return null; const m = (e.ms - s.ms) / 60_000; return m >= 0 ? m : null; } });
def({ name: 'DURATION', minArgs: 1, maxArgs: 1, doc: { group: G.date, signature: 'DURATION(นาที)', description: 'แปลงนาทีเป็นข้อความ เช่น "2 h 30 m" (0 นาที = "-")', example: 'DURATION(MINUTES([เริ่ม], [จบ]))' },
    fn: (a) => {
        const m = (0, convert_1.toNumber)(a[0]);
        if (m === null)
            return null;
        const h = Math.floor(m / 60);
        const mm = Math.floor(m % 60);
        return [h > 0 ? `${h} h` : '', mm > 0 ? `${mm} m` : ''].filter(Boolean).join(' ') || '-';
    } });
def({ name: 'COUNT', minArgs: 1, maxArgs: Infinity, doc: { group: G.math, signature: 'COUNT(a, b, …)', description: 'จำนวนค่าที่เป็นตัวเลข (ไม่นับค่าว่าง)' }, fn: (a) => numbers(a).length });
// ---- other sheets + time text
/**
 * Hours and minutes written the way people write them: "5:30" (h:mm), "4.23" (h.mm = 4 h 23 m), "5" (hours).
 * A number such as 5.3 is read as "5.3" = 5 h 30 m, so a typed 5.30 is never mistaken for 5.3 hours.
 * Returns minutes, or null when the text is not a time (minutes must be below 60).
 */
function parseHM(v) {
    if (v === null)
        return null;
    const text = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
    if (!text)
        return null;
    const m = /^(\d+)(?:[:.](\d{1,2}))?$/.exec(text);
    if (!m)
        return null;
    const h = Number(m[1]);
    let mins = 0;
    if (m[2] !== undefined) {
        const frac = m[2];
        mins = frac.length === 1 && text.includes('.') ? Number(frac) * 10 : Number(frac); // "4.5" = 4 h 50 m, like "4.50"
    }
    return mins >= 60 ? null : h * 60 + mins;
}
def({ name: 'HM', minArgs: 1, maxArgs: 1, doc: { group: G.date, signature: 'HM(เวลา)', description: 'แปลงเวลาที่เขียนเป็น 5:30 / 4.23 (= 4 ชม. 23 นาที) / 5 (= 5 ชม.) ให้เป็นจำนวนนาที', example: 'HM(@คุมDelay[เตรียมเสร็จ-เข้าห้องเย็น])' }, fn: (a) => parseHM(a[0]) });
def({ name: 'LOOKUP', minArgs: 3, maxArgs: 3, raw: true,
    doc: { group: G.logic, signature: 'LOOKUP(@แหล่ง[ผลลัพธ์], @แหล่ง[ค้นหา], ค่าที่ใช้ค้น)', description: 'ดึงค่าจากแถวแรกของชีตอื่นที่คอลัมน์ค้นหาตรงกับค่าที่ใช้ค้น (ไม่สนตัวพิมพ์/ช่องว่าง) — ว่างถ้าไม่พบ', example: 'HM(LOOKUP(@คุมDelay[เตรียมเสร็จ-เข้าห้องเย็น], @คุมDelay[ประเภทวัตถุดิบ], [ประเภทวัตถุดิบ]))' },
    fn: (nodes, ctx, ev) => {
        const [a, b, k] = nodes;
        if (a.t !== 'xref' || b.t !== 'xref' || !a.sheetId || !a.columnId || !b.columnId || !ctx.lookup || !ev)
            return null;
        return ctx.lookup(a.sheetId, a.columnId, b.columnId, ev(k));
    } });
// ---- date / time
def({ name: 'DATEVALUE', minArgs: 1, maxArgs: 1, doc: { group: G.date, signature: 'DATEVALUE("2026-01-31")', description: 'แปลงข้อความเป็นวันที่' }, fn: (a) => date(a[0]) });
def({ name: 'DATEDIFF', minArgs: 3, maxArgs: 3, doc: { group: G.date, signature: 'DATEDIFF(หน่วย, เริ่ม, จบ)', description: 'ระยะห่างเป็นทศนิยม หน่วย: second / minute / hour / day / week (ค่าติดลบถ้าจบก่อนเริ่ม)', example: 'DATEDIFF("hour", [เข้าห้องเย็น], [ออกห้องเย็น])' },
    fn: (a) => { const s = (0, convert_1.toDate)(a[1]); const e = (0, convert_1.toDate)(a[2]); return s && e ? (e.ms - s.ms) / (0, convert_1.unitMs)(a[0]) : null; } });
def({ name: 'DATEADD', minArgs: 3, maxArgs: 3, doc: { group: G.date, signature: 'DATEADD(หน่วย, วันที่, จำนวน)', description: 'บวกเวลา', example: 'DATEADD("hour", [เริ่มอบ], 4)' },
    fn: (a) => { const d = (0, convert_1.toDate)(a[1]); if (!d)
        return null; return { kind: d.kind === 'date' && (0, convert_1.unitMs)(a[0]) < convert_1.DAY_MS ? 'datetime' : d.kind, ms: d.ms + (0, convert_1.unitMs)(a[0]) * num(a[2]) }; } });
def({ name: 'DATE', minArgs: 1, maxArgs: 1, doc: { group: G.date, signature: 'DATE(วันที่เวลา)', description: 'ตัดเวลาออก เหลือวันที่ (ตามเขตเวลาของระบบ)' },
    fn: (a, ctx) => { const d = (0, convert_1.toDate)(a[0]); if (!d)
        return null; const p = (0, convert_1.parts)(d, ctx); return { kind: 'date', ms: Date.UTC(p.y, p.m - 1, p.d) }; } });
for (const [name, key, th] of [['HOUR', 'h', 'ชั่วโมง (0-23)'], ['MINUTE', 'mi', 'นาที'], ['DAY', 'd', 'วันที่ในเดือน'], ['MONTH', 'm', 'เดือน'], ['YEAR', 'y', 'ปี ค.ศ.'], ['WEEKDAY', 'dow', 'วันในสัปดาห์ (0 = อาทิตย์)']])
    def({ name, minArgs: 1, maxArgs: 1, doc: { group: G.date, signature: `${name}(วันที่เวลา)`, description: th, example: name === 'HOUR' ? 'IF(AND(HOUR([เวลา]) >= 6, HOUR([เวลา]) < 18), "DS", "NS")' : undefined },
        fn: (a, ctx) => { const d = (0, convert_1.toDate)(a[0]); return d ? (0, convert_1.parts)(d, ctx)[key] : null; } });
def({ name: 'FORMATDATE', minArgs: 2, maxArgs: 2, doc: { group: G.date, signature: 'FORMATDATE(วันที่, "dd/MM/yyyy HH:mm")', description: 'แปลงเป็นข้อความตามรูปแบบ (yyyy ค.ศ., BBBB พ.ศ., MM, dd, HH, mm, ss)' },
    fn: (a, ctx) => { const d = (0, convert_1.toDate)(a[0]); return d ? (0, convert_1.formatDate)(d, (0, convert_1.toText)(a[1]), ctx) : null; } });
//# sourceMappingURL=functions.js.map