"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY_SHEETS = exports.sheetFor = exports.SHIFTS = exports.lineSetupRows = exports.LINE_SPEC = exports.plantInText = exports.monthFolderName = exports.THAI_MONTHS = exports.AREAS = exports.TREE = exports.HELP_ROWS = exports.HELP_COLUMNS = exports.WS_INPUTS = exports.SAMPLE_ROW = exports.remarkFormula = exports.DB_FORMULAS = exports.DB_KEY_MAP = exports.DB_PLAIN = exports.isInkRemark = exports.REMARK_COL = exports.REF_SHEETS = exports.SHEETS = void 0;
exports.splitRemarks = splitRemarks;
exports.dateTokens = dateTokens;
exports.codeTokens = codeTokens;
exports.productToken = productToken;
exports.worksheetFormulas = worksheetFormulas;
exports.dbPreviewFormulas = dbPreviewFormulas;
exports.printTemplate = printTemplate;
exports.printTemplateByCustomer = printTemplateByCustomer;
exports.dayPath = dayPath;
exports.areaOf = areaOf;
exports.normalizePlant = normalizePlant;
const v = (name, width = 140) => ({ name, type: 'varchar', width });
const t = (name, width = 320) => ({ name, type: 'text', width });
exports.SHEETS = { year: 'ปี', month: 'เดือน', day: 'วัน', line: 'ไลน์', shift: 'กะ', calendar: 'ปฏิทิน', sample: 'ตัวอย่าง', lineSetup: 'ตั้งค่าไลน์', db: 'ฐานข้อมูล', help: 'คู่มือตัวแปร', ws: 'Worksheet' };
exports.REF_SHEETS = [
    { name: exports.SHEETS.year, columns: [v('ปี'), v('ปี_พศ'), v('รหัสปี'), v('รหัสปี2')] },
    { name: exports.SHEETS.month, columns: [v('เดือน'), v('ตัวอักษร'), v('ชื่อย่อ'), v('เลข2หลัก'), v('อักษร2')] },
    { name: exports.SHEETS.day, columns: [v('วัน'), v('รหัสวัน')] },
    { name: exports.SHEETS.line, columns: [v('ไลน์'), v('รหัสไลน์'), v('รหัสไลน์2'), v('Plant'), v('อื่นๆ')] },
    // which plant / area each line belongs to — read by the plan import (edit here, or run scripts/fixInkCodeLines.ts)
    { name: exports.SHEETS.lineSetup, columns: [{ ...v('ไลน์', 200), required: true }, { name: 'โรงงาน', type: 'select', width: 110, options: ['PF1', 'PF2'] }, { name: 'พื้นที่', type: 'select', width: 120, options: ['Pouch', 'Can', 'Cup', 'อื่นๆ'] }] },
    { name: exports.SHEETS.shift, columns: [v('กะ'), v('SC2'), v('SC3'), v('SC4')] },
    { name: exports.SHEETS.sample, columns: [v('ชื่อ', 100), { name: 'วันที่ผลิต', type: 'date', width: 130 }, v('ไลน์'), v('กะ', 70)] },
    { name: exports.SHEETS.calendar, columns: [{ name: 'วันที่ผลิต', type: 'date', width: 130 }, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => v(`K${i}`, 120))] },
];
/** Notes written in a code line ("New Code 1/9/25 ตรวจ 100%", "Check ราคาจาก Mail PN") are not inked: they live in this column */
exports.REMARK_COL = 'Remark (ไม่ Ink)';
/**
 * A code line that is a note, not something to ink: starts with "New Code" (any case) or has a Thai letter. Real ink codes have
 * no Thai letters (all 5,144 code lines of the master data: English, digits, symbols, Chinese). Whole lines only — never a part.
 * Same rule as isInkRemark in client/src/lib/pdf/blocks/codeSheet.ts (the PDF also leaves such lines out of the grid / QR).
 */
const isInkRemark = (line) => typeof line === 'string' && (/^\s*new\s+code\b/i.test(line) || /[\u0E00-\u0E7F]/.test(line));
exports.isInkRemark = isInkRemark;
/** Moves the note lines of a master row (แบบโค้ดแถว 1-4) into REMARK_COL (appended, one per line); the row itself is not changed */
function splitRemarks(row) {
    const next = { ...row };
    const moved = [];
    for (const n of [1, 2, 3, 4]) {
        const k = `แบบโค้ดแถว ${n}`;
        if ((0, exports.isInkRemark)(next[k])) {
            moved.push(String(next[k]).trim());
            next[k] = null;
        }
    }
    if (moved.length) {
        const had = String(next[exports.REMARK_COL] ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        next[exports.REMARK_COL] = [...new Set([...had, ...moved])].join('\n');
    }
    return { moved, next };
}
exports.DB_PLAIN = [
    v('รหัสเอกสาร'), v('PKG', 80), v('Market'), v('ลูกค้า'),
    ...[1, 2, 3, 4].map((n) => ({ ...t(`แบบโค้ดแถว ${n}`), description: 'แบบข้อความที่มี {ตัวแปร} เช่น {P} S{YC}{MC}{DC}S{LC} — ความหมายและที่มาของแต่ละตัวแปรดูในชีต "คู่มือตัวแปร" ผลลัพธ์จริงดูที่คอลัมน์ "ตัวอย่างโค้ดแถว" ทางขวา' })),
    { ...t(exports.REMARK_COL, 260), description: 'หมายเหตุของโค้ด เช่น New Code 1/9/25 ตรวจ 100% — ไม่ถูก Ink (ไม่ลงช่องตำแหน่ง/QR) แสดงในกล่องหมายเหตุใต้ตารางใน PDF' },
    v('รหัสเอกสารระบบ Code'), v('Rev.', 70), v('Short Product Code'), v('Product Code SAP', 200),
    v('Material Packaging 1', 200), v('Material Packaging 2', 200), v('Material Packaging 3', 200),
    v('ชนิด'), t('Note', 200), v('SVT', 70), t('บันทึกประวัติ', 240), v('สถานะ'), v('สถานะติดตาม'), v('special'),
    t('สูตรเดิมที่ต้องตรวจ', 360),
];
/** Excel header → DocHUB column (the JSON keys written by scripts/inkcode/extract.py) */
exports.DB_KEY_MAP = {
    'Product Code (SAP)': 'Product Code SAP', 'Material Packaging#1': 'Material Packaging 1', 'Material Packaging#2': 'Material Packaging 2', 'Material Packaging#3': 'Material Packaging 3', 'SVT?': 'SVT',
};
exports.DB_FORMULAS = [
    { name: 'Link', type: 'varchar', width: 150, formula: { expr: '[รหัสเอกสาร] & [Market]', sources: [] } },
    { name: 'Code ฝน', type: 'varchar', width: 200, formula: { expr: 'MID([Product Code SAP], 2, 1) & MID([Product Code SAP], 12, 5) & " " & MID([Product Code SAP], 3, 9)', sources: [] } },
];
/* ---------------- tokens → formulas ---------------- */
const num = (e) => `TEXT(${e})`;
const lk = (alias, result, key, k) => `LOOKUP(@${alias}[${result}], @${alias}[${key}], ${k})`;
const pad2 = (c, fn, arg = c.date) => `IF(${fn}(${arg}) < 10, "0" & ${fn}(${arg}), TEXT(${fn}(${arg})))`;
function dateTokens(c) {
    const D = c.date;
    return {
        Y: num(`YEAR(${D})`), D: num(`DAY(${D})`), DD: pad2(c, 'DAY'), 'DD-1': pad2(c, 'DAY', `DATEADD("day", ${D}, -1)`), Mo: num(`MONTH(${D})`), MM: pad2(c, 'MONTH'), Y1: `RIGHT(${num(`YEAR(${D})`)}, 1)`, YY: `RIGHT(${num(`YEAR(${D})`)}, 2)`,
        ...Object.fromEntries([1, 2, 3, 4, 5].flatMap((n) => [
            [`Y+${n}`, num(`YEAR(${D}) + ${n}`)], [`YY+${n}`, `RIGHT(${num(`YEAR(${D}) + ${n}`)}, 2)`], [`Y1+${n}`, `RIGHT(${num(`YEAR(${D}) + ${n}`)}, 1)`],
        ])),
    };
}
function codeTokens(c) {
    const D = c.date, L = c.line, S = c.shift;
    return {
        YC: lk('ปี', 'รหัสปี', 'ปี', `YEAR(${D})`), YC2: lk('ปี', 'รหัสปี2', 'ปี', `YEAR(${D})`), YB: lk('ปี', 'ปี_พศ', 'ปี', `YEAR(${D})`),
        MC: lk('เดือน', 'ตัวอักษร', 'เดือน', `MONTH(${D})`), MON: lk('เดือน', 'ชื่อย่อ', 'เดือน', `MONTH(${D})`), M2: lk('เดือน', 'อักษร2', 'เดือน', `MONTH(${D})`),
        DC: lk('วัน', 'รหัสวัน', 'วัน', `DAY(${D})`),
        LC: lk('ไลน์', 'รหัสไลน์', 'ไลน์', L), LC2: lk('ไลน์', 'รหัสไลน์2', 'ไลน์', L), PF: lk('ไลน์', 'Plant', 'ไลน์', L), LX: lk('ไลน์', 'อื่นๆ', 'ไลน์', L),
        SC2: lk('กะ', 'SC2', 'กะ', S), SC3: lk('กะ', 'SC3', 'กะ', S), SC4: lk('กะ', 'SC4', 'กะ', S),
    };
}
/** product / calendar tokens: P F and the calendar columns K2…K10 (optionally LEFT/RIGHT n, the day before, or a part of a date column) */
function productToken(tok, c) {
    if (tok === 'P')
        return c.short;
    if (tok === 'F')
        return c.docCode;
    // parts of a date column of the calendar (K4, K5, K8, K10 hold ISO dates "YYYY-MM-DD"): K8Y K8YY K8MM K8DD K8MON K8MC K8M2, "-1" = looked up with the day before
    const dp = /^K(\d+)(YY|Y|MM|DD|MON|MC|M2)(-1)?$/.exec(tok);
    if (dp && +dp[1] >= 2 && +dp[1] <= 10) {
        const base = lk('ปฏิทิน', `K${dp[1]}`, 'วันที่ผลิต', dp[3] ? `DATEADD("day", ${c.date}, -1)` : c.date);
        const mo = `VALUE(MID(${base}, 6, 2))`;
        const byMonth = (col) => lk('เดือน', col, 'เดือน', mo);
        return { Y: `LEFT(${base}, 4)`, YY: `MID(${base}, 3, 2)`, MM: `MID(${base}, 6, 2)`, DD: `MID(${base}, 9, 2)`, MON: byMonth('ชื่อย่อ'), MC: byMonth('ตัวอักษร'), M2: byMonth('อักษร2') }[dp[2]] ?? null;
    }
    const m = /^K(\d+)(?:([LR])(\d+)|(-1))?$/.exec(tok);
    if (!m || +m[1] < 2 || +m[1] > 10)
        return null;
    const key = m[4] ? `DATEADD("day", ${c.date}, -1)` : c.date;
    const base = lk('ปฏิทิน', `K${m[1]}`, 'วันที่ผลิต', key);
    return m[2] ? `${m[2] === 'L' ? 'LEFT' : 'RIGHT'}(${base}, ${m[3]})` : base;
}
const isKnown = (tok) => { const c = WS_CTX; return !!(dateTokens(c)[tok] || codeTokens(c)[tok] || productToken(tok, c)); };
const join = (names, get) => names.map((n) => `"${n}=" & ${get(n)}`).join(' & "|" & ');
const ALIASES = (names) => names.map((a) => ({ alias: a, sheet: a }));
const REF_ALIASES = [exports.SHEETS.year, exports.SHEETS.month, exports.SHEETS.day, exports.SHEETS.line, exports.SHEETS.shift];
const db = (r) => lk('ฐานข้อมูล', r, 'Link', '[Link]');
const WS_CTX = { date: '[วันที่ผลิต]', line: '[ไลน์]', shift: '[กะ]', short: db('Short Product Code'), docCode: '[รหัสเอกสาร]', link: '[Link]', tpl: (n) => db(`แบบโค้ดแถว ${n}`) };
const DB_CTX = { date: '[วันที่ตัวอย่าง]', line: '[ไลน์ตัวอย่าง]', shift: '[กะตัวอย่าง]', short: '[Short Product Code]', docCode: '[รหัสเอกสาร]', link: '[Link]', tpl: (n) => `[แบบโค้ดแถว ${n}]` };
/** The three helper columns (date / code / product variables) + the four rendered code lines for a context */
function renderColumns(c, usedTokens, prefix, codeNames, tplSources) {
    for (const x of usedTokens)
        if (!isKnown(x))
            throw new Error(`ไม่รู้จักตัวแปร {${x}} ในแบบโค้ด`);
    const dT = dateTokens(c), cT = codeTokens(c);
    const prodNames = [...new Set(['P', 'F', ...usedTokens.filter((x) => productToken(x, c))])];
    const guard = (e) => `IF(ISBLANK(${c.date}), "", ${e})`;
    const vN = `${prefix}ตัวแปรวันที่`, vC = `${prefix}ตัวแปรรหัส`, vP = `${prefix}ตัวแปรสินค้า`;
    const vars = `[${vN}] & "|" & [${vC}] & "|" & [${vP}]`;
    const hasLookupP = c.short.startsWith('LOOKUP');
    return [
        { name: vN, type: 'text', width: 140, formula: { expr: guard(join(Object.keys(dT), (n) => dT[n])), sources: [] } },
        { name: vC, type: 'text', width: 140, formula: { expr: guard(join(Object.keys(cT), (n) => cT[n])), sources: ALIASES(REF_ALIASES) } },
        { name: vP, type: 'text', width: 140, formula: { expr: guard(join(prodNames, (n) => productToken(n, c))), sources: ALIASES([...(hasLookupP ? [exports.SHEETS.db] : []), exports.SHEETS.calendar, exports.SHEETS.month]) } },
        ...codeNames.map((name, i) => ({ name, type: 'text', width: 300, formula: { expr: `IF(OR(ISBLANK(${c.date}), ISBLANK(${c.tpl(i + 1)})), "", FILL(${c.tpl(i + 1)}, ${vars}))`, sources: ALIASES(tplSources) } })),
    ];
}
/** Worksheet: what the staff type → everything else is computed */
function worksheetFormulas(usedTokens) {
    const d = ALIASES([exports.SHEETS.db]);
    return [
        { name: 'Link', type: 'varchar', width: 150, formula: { expr: '[รหัสเอกสาร] & [Market]', sources: [] } },
        { name: 'พบในฐานข้อมูล', type: 'varchar', width: 120, description: '1 = พบรหัสเอกสาร+Market ในฐานข้อมูล · X = ไม่พบ (ตรวจการพิมพ์)', formula: { expr: `IF(ISBLANK([รหัสเอกสาร]), "", IF(ISBLANK(${db('Link')}), "X", "1"))`, sources: d } },
        { name: 'ลูกค้า', type: 'varchar', width: 160, formula: { expr: db('ลูกค้า'), sources: d } },
        { name: 'ชนิด', type: 'varchar', width: 130, formula: { expr: db('ชนิด'), sources: d } },
        { name: 'Product Code SAP', type: 'varchar', width: 200, formula: { expr: db('Product Code SAP'), sources: d } },
        { name: 'PKG', type: 'varchar', width: 80, description: 'ชนิดบรรจุภัณฑ์ (Can = QR 23 ตัวอักษร/แถว, อื่นๆ 40)', formula: { expr: db('PKG'), sources: d } },
        ...['Material Packaging 1', 'Material Packaging 2', 'Material Packaging 3', 'รหัสเอกสารระบบ Code', 'Rev.'].map((n) => ({ name: n, type: 'varchar', width: 170, formula: { expr: db(n), sources: d } })),
        ...renderColumns(WS_CTX, usedTokens, '', [1, 2, 3, 4].map((n) => `Code Format แถว ${n}`), [exports.SHEETS.db]),
        { name: 'Code ฝน', type: 'varchar', width: 200, formula: { expr: db('Code ฝน'), sources: d } },
        (0, exports.remarkFormula)(),
    ];
}
/** Worksheet / day sheets: the note of the product (not inked) — shown in the PDF's "หมายเหตุ (ไม่ Ink)" box */
const remarkFormula = () => ({ name: exports.REMARK_COL, type: 'text', width: 220, formula: { expr: db(exports.REMARK_COL), sources: ALIASES([exports.SHEETS.db]) } });
exports.remarkFormula = remarkFormula;
/** Master database: preview of the 4 code lines for a sample date / line (edit the sheet "ตัวอย่าง" in the reference file) */
function dbPreviewFormulas(usedTokens) {
    const smp = ALIASES([exports.SHEETS.sample]);
    const pick = (col) => lk('ตัวอย่าง', col, 'ชื่อ', '"ตัวอย่าง"');
    return [
        { name: 'วันที่ตัวอย่าง', type: 'date', width: 130, description: 'ดึงจากชีต "ตัวอย่าง" ในไฟล์ InkCode - รหัสอ้างอิง (แก้ที่นั่น)', formula: { expr: pick('วันที่ผลิต'), sources: smp } },
        { name: 'ไลน์ตัวอย่าง', type: 'varchar', width: 120, formula: { expr: pick('ไลน์'), sources: smp } },
        { name: 'กะตัวอย่าง', type: 'varchar', width: 90, formula: { expr: pick('กะ'), sources: smp } },
        ...renderColumns(DB_CTX, usedTokens, 'ตัวอย่าง-', [1, 2, 3, 4].map((n) => `ตัวอย่างโค้ดแถว ${n}`), []),
    ];
}
exports.SAMPLE_ROW = { ชื่อ: 'ตัวอย่าง', วันที่ผลิต: '2026-03-17', ไลน์: 'Can R', กะ: 'DS' };
const dropdown = (name, sheet, column, width = 140) => ({ name, type: 'select', width, lookup: { sheet, column } });
exports.WS_INPUTS = [
    { name: 'วันที่ผลิต', type: 'date', width: 130, required: true }, v('เวลาเริ่ม', 90),
    { ...dropdown('ไลน์', exports.SHEETS.line, 'ไลน์'), description: 'เลือกจากรายการในไฟล์ InkCode - รหัสอ้างอิง › ไลน์' },
    { ...dropdown('กะ', exports.SHEETS.shift, 'กะ', 80), description: 'เลือกจากรายการในไฟล์ InkCode - รหัสอ้างอิง › กะ' },
    { ...dropdown('รหัสเอกสาร', exports.SHEETS.db, 'รหัสเอกสาร'), description: 'เลือกจากรายการใน InkCode - Master Database › ฐานข้อมูล' },
    { ...dropdown('Market', exports.SHEETS.db, 'Market'), description: 'เลือกจากรายการใน InkCode - Master Database › ฐานข้อมูล (ต้องเป็นคู่กับรหัสเอกสาร)' },
    { name: 'วันออกจากตู้อบ', type: 'date', width: 140 }, v('PO'), { name: 'ยอด', type: 'float', width: 100 }, t('หมายเหตุ', 240),
];
/** Help sheet of the master database: every variable of a code template and where its value comes from */
exports.HELP_COLUMNS = [v('ตัวแปร', 90), t('ความหมาย', 260), v('ดึงมาจากไฟล์', 200), v('ชีต', 130), v('คอลัมน์', 150), v('ตัวอย่าง', 160)];
const REFF = 'InkCode - รหัสอ้างอิง', DBF = 'InkCode - Master Database';
const hrow = (ตัวแปร, ความหมาย, ไฟล์, ชีต, คอลัมน์, ตัวอย่าง) => ({ ตัวแปร: `{${ตัวแปร}}`, ความหมาย, ดึงมาจากไฟล์: ไฟล์, ชีต, คอลัมน์, ตัวอย่าง });
exports.HELP_ROWS = [
    hrow('P', 'Short Product Code ของสินค้า (แถวนี้)', DBF, exports.SHEETS.db, 'Short Product Code', 'B23AA'),
    hrow('F', 'รหัสเอกสาร ของแถวที่กรอกใน Worksheet', 'ใบออกโค้ดนอกแผน', exports.SHEETS.ws, 'รหัสเอกสาร', 'P519'),
    hrow('YC', 'รหัสปี (ตามปีของวันที่ผลิต)', REFF, exports.SHEETS.year, 'รหัสปี', '9 (ปี 2026)'),
    hrow('YC2', 'รหัสปี แบบที่ 2', REFF, exports.SHEETS.year, 'รหัสปี2', '6'),
    hrow('YB', 'ปี พ.ศ.', REFF, exports.SHEETS.year, 'ปี_พศ', '2569'),
    hrow('MC', 'รหัสเดือน (A–M ไม่มี I)', REFF, exports.SHEETS.month, 'ตัวอักษร', 'C (มีนาคม)'),
    hrow('MON', 'ชื่อเดือนย่อ', REFF, exports.SHEETS.month, 'ชื่อย่อ', 'MAR'),
    hrow('M2', 'ชื่อเดือน 2 ตัวอักษร', REFF, exports.SHEETS.month, 'อักษร2', 'MR'),
    hrow('DC', 'รหัสวัน', REFF, exports.SHEETS.day, 'รหัสวัน', 'H (วันที่ 17)'),
    hrow('LC', 'รหัสไลน์ (ตามไลน์ที่เลือก)', REFF, exports.SHEETS.line, 'รหัสไลน์', 'R (Can R)'),
    hrow('LC2', 'รหัสไลน์ แบบ 2 หลัก', REFF, exports.SHEETS.line, 'รหัสไลน์2', '01'),
    hrow('PF', 'Plant ของไลน์', REFF, exports.SHEETS.line, 'Plant', 'PF2'),
    hrow('SC2', 'รหัสกะ (ตัวที่ 2)', REFF, exports.SHEETS.shift, 'SC2', '1'),
    hrow('SC3', 'รหัสกะ (ตัวที่ 3)', REFF, exports.SHEETS.shift, 'SC3', 'S'),
    hrow('SC4', 'รหัสกะ (ตัวที่ 4)', REFF, exports.SHEETS.shift, 'SC4', '1'),
    hrow('Y', 'ปี ค.ศ. 4 หลัก ของวันที่ผลิต (คำนวณ ไม่ได้ดึงจากตาราง)', 'วันที่ผลิตใน Worksheet', exports.SHEETS.ws, 'วันที่ผลิต', '2026'),
    hrow('Y+3', 'ปี ค.ศ. บวก 3 (ใช้ +1…+5 ได้)', 'วันที่ผลิตใน Worksheet', exports.SHEETS.ws, 'วันที่ผลิต', '2029'),
    hrow('YY', 'ปี 2 หลักท้าย (YY+3 = ปีบวก 3 แล้วเอา 2 หลัก)', 'วันที่ผลิตใน Worksheet', exports.SHEETS.ws, 'วันที่ผลิต', '26'),
    hrow('Y1', 'ปี 1 หลักท้าย', 'วันที่ผลิตใน Worksheet', exports.SHEETS.ws, 'วันที่ผลิต', '6'),
    hrow('D', 'วันที่ (ไม่เติมศูนย์)', 'วันที่ผลิตใน Worksheet', exports.SHEETS.ws, 'วันที่ผลิต', '5'),
    hrow('DD', 'วันที่ 2 หลัก (เติมศูนย์)', 'วันที่ผลิตใน Worksheet', exports.SHEETS.ws, 'วันที่ผลิต', '05'),
    hrow('DD-1', 'วันที่ของ "วันก่อนหน้า" แบบ 2 หลัก', 'วันที่ผลิตใน Worksheet', exports.SHEETS.ws, 'วันที่ผลิต', '04'),
    hrow('Mo', 'เดือนเป็นตัวเลข (ไม่เติมศูนย์)', 'วันที่ผลิตใน Worksheet', exports.SHEETS.ws, 'วันที่ผลิต', '3'),
    hrow('MM', 'เดือนเป็นตัวเลข 2 หลัก', 'วันที่ผลิตใน Worksheet', exports.SHEETS.ws, 'วันที่ผลิต', '03'),
    hrow('K2…K10', 'ค่าจากปฏิทิน Julian ของวันที่ผลิต (K3 = เลขวันที่ในปี เช่น 278)', REFF, exports.SHEETS.calendar, 'K2…K10', '278'),
    hrow('K8DD K8MON K8Y …', 'ส่วนของวันที่ในคอลัมน์วันที่ของปฏิทิน (K4 K5 K8 K10): Y ปี 4 หลัก · YY ปี 2 หลัก · MM เดือน 2 หลัก · DD วัน 2 หลัก · MON ชื่อเดือนย่อ · MC/M2 รหัสเดือน; ต่อท้าย -1 = ค้นด้วยวันก่อนหน้า (เช่น K10DD-1)', REFF, exports.SHEETS.calendar, 'K8', '03 / OCT / 2028'),
    hrow('K6L3 / K6R1', 'ปฏิทิน K6 เอา 3 ตัวแรก / 1 ตัวท้าย (K3-1 = ของวันก่อนหน้า)', REFF, exports.SHEETS.calendar, 'K6', '641 / A'),
];
/** the print form of the Excel ("ใบแจ้งการเปลี่ยนแปลงการผลิต (นอกแผน)"): one table per notice, printed 4 times (A3 landscape) */
function printTemplate(worksheetSheetId) {
    const id = () => crypto.randomUUID();
    const text = (text, style = {}, extra = {}) => ({ id: id(), type: 'text', text, style: { align: 'left', ...style }, marginBottom: 0, ...extra });
    const row3 = (center, right, centerStyle, rightStyle, mb = 0) => ({
        id: id(), type: 'columns', gap: 2, marginBottom: mb,
        cols: [{ widthPct: 22, blocks: [text('')] }, { widthPct: 56, blocks: [text(center, { align: 'center', ...centerStyle })] }, { widthPct: 22, blocks: [text(right, { align: 'right', ...rightStyle })] }],
    });
    const side = (header, widthMm, items) => ({ id: id(), header, widthMm, items: items.map((i) => ({ id: id(), label: i.label ?? '', text: i.text })) });
    return {
        id: id(), name: 'ใบออกโค้ดนอกแผน 4 ส่วน', mode: 'perRow', followSheet: true, perRow: { sheetId: worksheetSheetId, sheetName: exports.SHEETS.ws, onlySelected: true },
        page: { size: 'A3', orientation: 'landscape', margins: { top: 5, right: 8, bottom: 4, left: 8 } },
        base: { font: 'Sarabun', fontSize: 10, color: '#111827' },
        header: { enabled: false, blocks: [] }, footer: { enabled: false, blocks: [] },
        copies: { labels: ['ฉบับที่ 1', 'ฉบับที่ 2', 'ฉบับที่ 3', 'ฉบับที่ 4'], separator: 'line' },
        blocks: [
            row3('บริษัท ไอ-เทล คอร์ปอเรชั่น จำกัด (มหาชน)', 'F3PFPF39-0-04/10/21', { bold: true, fontSize: 12 }, { fontSize: 9 }),
            row3('ใบแจ้งการเปลี่ยนแปลงการผลิต (นอกแผน)', 'วันที่ {{วันที่ผลิต}}      {{กะ}}      ({{copyLabel}})', { bold: true, fontSize: 11 }, { fontSize: 9 }, 1),
            text('แผนก     บรรจุภัณฑ์', { align: 'center', bold: true, fontSize: 10, bg: '#DCEAF7' }, { border: { color: '#374151', width: 0.5, padding: 0.8 }, marginBottom: 0.5 }),
            {
                id: id(), type: 'codeSheet', cells: 40, cellHeightMm: 5, fontSize: 9, headerBg: '#DCEAF7', borderColor: '#374151', showIndex: true, gridHeader: 'ตำแหน่ง', marginBottom: 1,
                autoCells: true, minCells: 12, qrCanChars: 23, qrOtherChars: 40, qrCanText: '{{PKG}}',
                left: [side('ไลน์', 13, [{ text: '{{ไลน์}}' }]), side('ลำดับ', 11, [{ text: '{{#}}' }]), side('ลูกค้า', 30, [{ text: '{{ลูกค้า}}' }]), side('ชนิด', 24, [{ text: '{{ชนิด}}' }])],
                right: [
                    side('Mat. Packaging', 44, [{ text: '{{Material Packaging 1}}' }, { text: '{{Material Packaging 2}}' }, { text: '{{Material Packaging 3}}' }]),
                    side('Code', 54, [{ label: 'PO', text: '{{PO}}' }, { label: 'New code', text: '{{Code ฝน}}' }, { label: 'Code Sap', text: '{{Product Code SAP}}' }]),
                    side('รหัสเอกสารสูตรการผลิต', 27, [{ text: '{{รหัสเอกสาร}}' }]), side('รหัสเอกสารระบบ Code', 28, [{ text: '{{รหัสเอกสารระบบ Code}} / {{Rev.}}' }]), { ...side('QR Code', 26, [{ text: '' }]), qr: true },
                ],
                lines: [1, 2, 3, 4].map((n) => ({ id: id(), text: `{{Code Format แถว ${n}}}` })),
            },
            { id: id(), type: 'signature', perRow: 3, boxHeightMm: 4, rowGapMm: 0, gapMm: 40, lineColor: '#111827', lineWidth: 0.4, marginTop: 0, marginBottom: 0,
                labelStyle: { fontSize: 8.5, align: 'center' }, nameStyle: { fontSize: 9, align: 'center' },
                slots: [
                    { id: id(), label: '( ควบคุมเอกสาร )', sublabel: 'ผู้จัดทำ', askAtExport: false, showDate: false },
                    { id: id(), label: '(หัวหน้าแผนกบรรจุผลิตภัณฑ์ปลาแมว/หัวหน้าแผนกอาวุโส)', sublabel: 'ผู้ตรวจสอบ', askAtExport: false, showDate: false },
                    { id: id(), label: '(หัวหน้าแผนกควบคุมคุณภาพ/หัวหน้าแผนกอาวุโสฝ่ายควบคุมคุณภาพ)', sublabel: 'ผู้ตรวจสอบ', askAtExport: false, showDate: false },
                ] },
        ],
        watermark: { enabled: false, text: '', color: '#9CA3AF', opacity: 0.15, size: 90, angle: -35 }, lockEditing: false,
    };
}
/**
 * Same form, but the rows of a sheet are grouped by customer (Market): every customer starts on its own page with the title once,
 * its notices follow one under the other, and ONE set of signatures closes that customer's part.
 */
function printTemplateByCustomer(worksheetSheetId) {
    const base = printTemplate(worksheetSheetId);
    const [company, title, dept, codeSheet, signature] = base.blocks;
    title.cols[2].blocks[0].text = 'วันที่ {{วันที่ผลิต}}      {{กะ}}      {{group}}';
    return {
        ...base, id: crypto.randomUUID(), name: 'ใบออกโค้ดนอกแผน แยกตามลูกค้า (ลายเซ็นต่อลูกค้า)',
        perRow: { ...base.perRow, groupBy: 'Market', rowsPerPage: 6 },
        copies: undefined,
        blocks: [{ ...company, groupOnce: 'start' }, { ...title, groupOnce: 'start' }, { ...dept, groupOnce: 'start' }, codeSheet, { ...signature, marginTop: 2, groupOnce: 'end' }],
    };
}
/* ---------- working tree: PF1 | PF2 › year › month (folder) › day (file) › area (sheet) ---------- */
exports.TREE = { root: 'InkCode', tree: 'InkCode - ใบออกโค้ด', templateFolder: 'แม่แบบ', plans: 'แผนผลิต', dayTemplate: 'แม่แบบรายวัน', plants: ['PF1', 'PF2'] };
/** production areas — each becomes a pair of sheets (DS / NS) in a day file; "อื่นๆ" catches lines that belong to none of the others */
exports.AREAS = ['Pouch', 'Can', 'Cup', 'อื่นๆ'];
exports.THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const monthFolderName = (m) => `${String(m).padStart(2, '0')} ${exports.THAI_MONTHS[m - 1]}`;
exports.monthFolderName = monthFolderName;
/** "2026-10-03" → { year: "2026", month: "10 ตุลาคม", file: "2026-10-03" } */
function dayPath(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m)
        throw new Error(`วันที่ไม่ถูกต้อง: ${date}`);
    // PF1 / 2026 / 10 ตุลาคม / 03 / 2026-10-03 — one folder per day inside the month
    return { year: m[1], month: (0, exports.monthFolderName)(Number(m[2])), day: m[3], file: date };
}
/** Area (sheet of the day file) of a production line: Cup / Can by the line name, Pouch also for Spout / Auto lines */
function areaOf(line, product = '') {
    for (const text of [line, product]) {
        const t = ` ${text.toLowerCase()} `;
        if (/\bcup\b/.test(t))
            return 'Cup';
        if (/\bcan\b/.test(t))
            return 'Can';
        if (/\b(pouch|spout|auto)\b/.test(t))
            return 'Pouch';
    }
    return 'อื่นๆ';
}
/** Plant written inside a line name of the plan, e.g. "Pouch PF2 ชั้นบน" → PF2 */
const plantInText = (s) => { const m = /\bPF\s*(\d)\b/i.exec(s); return m ? `PF${m[1]}` : null; };
exports.plantInText = plantInText;
/** Plant as written in the line table ("2", "PF2", "pf 2") → the folder name PF2; anything else is kept upper-case */
function normalizePlant(v) {
    const t = String(v ?? '').trim();
    const d = /^(?:pf\s*)?(\d)$/i.exec(t);
    return d ? `PF${d[1]}` : t.toUpperCase();
}
exports.LINE_SPEC = (() => {
    const out = [];
    const add = (names, plant, area) => names.forEach((line) => out.push({ line, plant, area }));
    add([1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13].map((n) => `Cup ${n}`), 'PF1', 'Cup');
    add([6, 7].map((n) => `Cup ${n}`), 'PF2', 'Cup');
    add([...'ABCDEFGHJK'].map((c) => `Can ${c}`).concat(['Can 1', 'Can 2', 'Can 3']), 'PF1', 'Can');
    add([...'RPTUYZ'].map((c) => `Can ${c}`), 'PF2', 'Can');
    add(['Auto B', 'Auto C', 'Auto D', 'Spout', 'Spout 1', 'Spout 2', 'Spout 3', 'Pouch VS', 'Pouch TN', 'Sachet'], 'PF1', 'Pouch');
    add(['Auto A', 'Auto E', 'Auto F', 'Pouch PF3', 'Pouch PF2 ชั้นบน', 'Jerky', 'Extruder', 'Freeze dried'], 'PF2', 'Pouch');
    return out;
})();
/** Rows of the "ตั้งค่าไลน์" sheet */
const lineSetupRows = () => exports.LINE_SPEC.map((s) => ({ ไลน์: s.line, โรงงาน: s.plant, พื้นที่: s.area }));
exports.lineSetupRows = lineSetupRows;
/** Sheets of a day file: every area split by shift (DS / NS, from the start time in the plan); "อื่นๆ" is not split */
exports.SHIFTS = ['DS', 'NS'];
const sheetFor = (area, shift) => (area === 'อื่นๆ' ? 'อื่นๆ' : `${area} ${shift}`);
exports.sheetFor = sheetFor;
exports.DAY_SHEETS = [...exports.AREAS.filter((a) => a !== 'อื่นๆ').flatMap((a) => exports.SHIFTS.map((sh) => (0, exports.sheetFor)(a, sh))), 'อื่นๆ'];
//# sourceMappingURL=model.js.map