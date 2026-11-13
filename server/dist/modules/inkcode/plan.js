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
Object.defineProperty(exports, "__esModule", { value: true });
exports.shiftOf = void 0;
exports.isoDate = isoDate;
exports.timeText = timeText;
exports.resolveLine = resolveLine;
exports.parsePlan = parsePlan;
const XLSX = __importStar(require("xlsx"));
/** Excel error values (#DIV/0!, #N/A, #VALUE! …) are formula errors of the plan, not data */
const isErr = (v) => typeof v === 'string' && /^#(DIV\/0!|N\/A|VALUE!|REF!|NAME\?|NUM!|NULL!)$/.test(v.trim());
const cellOut = (v) => {
    if (v === null || v === undefined || isErr(v))
        return null;
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (v instanceof Date)
        return isoDate(v);
    const t = String(v).replace(/\s+/g, ' ').trim();
    return t || null;
};
const txt = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v).trim());
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
/**
 * SheetJS builds Date cells a few seconds BEFORE the exact instant (e.g. 2026-10-03 00:00 arrives as 23:59:56 of the 2nd in a
 * server running in Asia/Bangkok), so reading the local day gave the previous day. Rounding to the nearest minute removes it.
 */
const settle = (d) => new Date(Math.round(d.getTime() / 60000) * 60000);
function isoDate(v) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
        const d = settle(v);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const s = txt(v);
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m)
        return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
    if (m)
        return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
}
/** "07:00", a time cell (Excel stores it as a fraction of a day → Date 1899/1900) or a Date → "HH:MM" */
function timeText(v) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
        const d = settle(v);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (typeof v === 'number' && v >= 0 && v < 1) {
        const mins = Math.round(v * 1440);
        return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    }
    const m = /^(\d{1,2})[:.](\d{2})/.exec(txt(v));
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
/** Day shift when the run starts between 06:00 and 18:59 (the plan has no shift column) */
const shiftOf = (time) => { const h = time ? Number(time.slice(0, 2)) : 7; return h >= 6 && h < 19 ? 'DS' : 'NS'; };
exports.shiftOf = shiftOf;
/**
 * product + line cell of the plan → a line name of the reference table: "Cup" + 1 → "Cup 1", "Can" + "U" → "Can U",
 * "Spout 2" → "Spout", "Auto B+C" → "Auto B" (first of several lines; `guessed` is set so the preview can warn)
 */
function resolveLine(product, line, known) {
    const k = new Map(known.map((x) => [norm(x), x]));
    const exact = [`${product} ${line}`, line, `${product}${line}`, line.replace(/\s*\d+$/, ''), line.split(/[\s/(]+/)[0]];
    for (const c of exact) {
        const hit = k.get(norm(c));
        if (hit)
            return { line: hit, known: true };
    }
    const toks = line.split(/[/+,\\]+/).map((x) => x.trim()).filter(Boolean);
    for (const t of toks)
        for (const c of [`${product} ${t}`, t]) {
            const hit = k.get(norm(c));
            if (hit)
                return { line: hit, known: true, guessed: toks.length > 1 };
        }
    return { line: exact[0].trim(), known: false };
}
function parsePlan(body, knownLines = []) {
    const wb = XLSX.read(body, { type: 'buffer', cellDates: true });
    const warnings = [];
    for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
        // header row: the row that has "Doc.No"
        const hi = rows.slice(0, 30).findIndex((r) => r.some((c) => norm(txt(c)) === 'doc.no'));
        if (hi < 0)
            continue;
        const head = rows[hi].map((c) => norm(txt(c)));
        const col = (...names) => head.findIndex((h) => names.includes(h));
        const cDoc = col('doc.no'), cCountry = col('country'), cLine = col('line'), cProduct = col('product'), cTime = col('time'), cSize = col('size'), cCust = col('customer'), cRev = col('rev.'), cQty = col('ยอดผลิต'), cCode = col('code'), cComp = col('complementary'), cNote = col('หมายเหตุ');
        // detail columns: everything right of ยอดผลิต that has a header (Rawmat, Special, Material, Spec, kg …, Packaging, หมายเหตุ)
        const rawHead = rows[hi].map((c) => txt(c).replace(/\s+/g, ' ').trim());
        const detailCols = [];
        const seenNames = new Set();
        for (let c = (cQty >= 0 ? cQty : cDoc) + 1; c < rawHead.length; c++) {
            if (!rawHead[c])
                continue;
            let name = rawHead[c];
            for (let k = 2; seenNames.has(name); k++)
                name = `${rawHead[c]} (${k})`;
            seenNames.add(name);
            detailCols.push({ i: c, name });
        }
        const headerNotes = rows.slice(0, hi).flatMap((r) => r.map((c) => (c instanceof Date ? '' : txt(c)))).filter((x) => x && !x.includes('ประจำวันที่'));
        if (cCountry < 0 || cLine < 0 || cTime < 0)
            continue; // the daily plan has a Time column; other sheets with Doc.No (weekly plans) are not it
        // date: "…ประจำวันที่" followed by a date in the first rows
        let date = null;
        for (const r of rows.slice(0, hi)) {
            const at = r.findIndex((c) => txt(c).includes('ประจำวันที่'));
            if (at >= 0) {
                date = r.slice(at + 1).map(isoDate).find(Boolean) ?? null;
                if (date)
                    break;
            }
        }
        if (!date)
            warnings.push('ไม่พบวันที่ในหัวแผน (ข้อความ "ประจำวันที่ …") — ต้องระบุวันที่เอง');
        const groups = new Map();
        let block = null;
        for (let i = hi + 1; i < rows.length; i++) {
            const r = rows[i];
            const doc = txt(r[cDoc]);
            const country = txt(r[cCountry]);
            // a block title ("Cup 1 (วาง cap 10500)", "ปรับ size ถ้วยส้ม"): a row with text in Product but no time / document
            if (!doc && !timeText(r[cTime]) && cProduct >= 0 && txt(r[cProduct])) {
                block = txt(r[cProduct]).replace(/\s+/g, ' ');
                continue;
            }
            if (!doc || !country || !/^[A-Za-z0-9][A-Za-z0-9/.\-]{0,24}$/.test(doc))
                continue; // notes and the signature lines have no Doc.No
            const time = timeText(r[cTime]);
            const product = txt(r[cProduct]);
            const lineRaw = txt(r[cLine]);
            const code = cCode >= 0 ? txt(r[cCode]) : '';
            const key = [time, product, lineRaw, country, code].join('|');
            let g = groups.get(key);
            if (!g) {
                g = { time, product, lineRaw, country, code, size: cSize >= 0 ? txt(r[cSize]) || null : null, customer: cCust >= 0 ? txt(r[cCust]) || null : null, docs: new Map(), first: i + 1, block, qtyNotes: [], notes: [], rows: [], details: [], nums: [], comp: cComp >= 0 ? txt(r[cComp]) || null : null };
                groups.set(key, g);
            }
            g.rows.push(i + 1);
            if (cQty >= 0 && typeof r[cQty] === 'number')
                g.nums.push(r[cQty]);
            if (cQty >= 0 && typeof r[cQty] === 'string' && txt(r[cQty]) && !isErr(r[cQty]))
                g.qtyNotes.push(txt(r[cQty]).replace(/\s+/g, ' '));
            if (cNote >= 0 && txt(r[cNote]))
                g.notes.push(txt(r[cNote]).replace(/\s+/g, ' '));
            const values = {};
            for (const dc of detailCols)
                values[dc.name] = cellOut(r[dc.i]);
            g.details.push({ row: i + 1, doc, rev: cRev >= 0 ? txt(r[cRev]) || null : null, values });
            const d = g.docs.get(doc) ?? { n: 0, rev: cRev >= 0 ? txt(r[cRev]) || null : null, qty: null };
            d.n++;
            if (d.qty === null && cQty >= 0 && typeof r[cQty] === 'number')
                d.qty = r[cQty];
            g.docs.set(doc, d);
        }
        const items = [];
        for (const g of groups.values()) {
            const best = [...g.docs.entries()].reduce((a, b) => (b[1].n > a[1].n ? b : a));
            const rl = resolveLine(g.product, g.lineRaw, knownLines);
            if (!rl.known && knownLines.length)
                warnings.push(`แถว ${g.first}: ไม่พบไลน์ "${rl.line}" ในตารางรหัสอ้างอิง (${g.product} / ${g.lineRaw})`);
            else if (rl.guessed)
                warnings.push(`แถว ${g.first}: "${g.lineRaw}" มีหลายไลน์ — เลือก "${rl.line}" (ตรวจ/แก้ภายหลังได้)`);
            // other Doc.No on fewer rows are raw-material formulas (MRDPF…/26) — kept in extra.otherDocs; only a tie is worth a look
            const tie = [...g.docs.entries()].filter(([d, v]) => d !== best[0] && v.n === best[1].n).map(([d]) => d);
            if (tie.length)
                warnings.push(`แถว ${g.first}: ${g.product} ${g.lineRaw} มี Doc.No จำนวนแถวเท่ากัน (${[best[0], ...tie].join(', ')}) — ใช้ "${best[0]}" ตรวจว่าถูกไหม`);
            items.push({ time: g.time, product: g.product, lineRaw: g.lineRaw, line: rl.line, size: g.size, customer: g.customer, country: g.country, doc: best[0], rev: best[1].rev, qty: best[1].qty ?? g.nums[0] ?? null, shift: (0, exports.shiftOf)(g.time), extra: {
                    complementary: g.comp, code: g.code || null, qtyNotes: [...new Set(g.qtyNotes)], block: g.block, notes: [...new Set(g.notes)], rows: g.rows, details: g.details,
                    otherDocs: [...g.docs.entries()].filter(([d]) => d !== best[0]).map(([d, v]) => ({ doc: d, rev: v.rev })),
                }, sourceRow: g.first });
        }
        return { date, sheetName: name, items, warnings: [...new Set(warnings)], detailHeaders: detailCols.map((d) => d.name), headerNotes: [...new Set(headerNotes)] };
    }
    throw new Error('ไม่พบตารางแผนผลิตในไฟล์ (ต้องมีหัวคอลัมน์ Doc.No, Line, Country)');
}
//# sourceMappingURL=plan.js.map