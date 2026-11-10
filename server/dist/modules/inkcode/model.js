"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WS_INPUTS = exports.CODE_TOKENS = exports.DATE_TOKENS = exports.DB_FORMULAS = exports.DB_KEY_MAP = exports.DB_PLAIN = exports.REF_SHEETS = exports.SHEETS = void 0;
exports.productToken = productToken;
exports.worksheetFormulas = worksheetFormulas;
exports.printTemplate = printTemplate;
const v = (name, width = 140) => ({ name, type: 'varchar', width });
const t = (name, width = 320) => ({ name, type: 'text', width });
exports.SHEETS = { year: 'ปี', month: 'เดือน', day: 'วัน', line: 'ไลน์', shift: 'กะ', calendar: 'ปฏิทิน', db: 'ฐานข้อมูล', ws: 'Worksheet' };
exports.REF_SHEETS = [
    { name: exports.SHEETS.year, columns: [v('ปี'), v('ปี_พศ'), v('รหัสปี'), v('รหัสปี2')] },
    { name: exports.SHEETS.month, columns: [v('เดือน'), v('ตัวอักษร'), v('ชื่อย่อ'), v('เลข2หลัก'), v('อักษร2')] },
    { name: exports.SHEETS.day, columns: [v('วัน'), v('รหัสวัน')] },
    { name: exports.SHEETS.line, columns: [v('ไลน์'), v('รหัสไลน์'), v('รหัสไลน์2'), v('Plant'), v('อื่นๆ')] },
    { name: exports.SHEETS.shift, columns: [v('กะ'), v('SC2'), v('SC3'), v('SC4')] },
    { name: exports.SHEETS.calendar, columns: [{ name: 'วันที่ผลิต', type: 'date', width: 130 }, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => v(`K${i}`, 120))] },
];
exports.DB_PLAIN = [
    v('รหัสเอกสาร'), v('PKG', 80), v('Market'), v('ลูกค้า'),
    t('แบบโค้ดแถว 1'), t('แบบโค้ดแถว 2'), t('แบบโค้ดแถว 3'), t('แบบโค้ดแถว 4'),
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
/* ---------------- the daily worksheet ---------------- */
const D = '[วันที่ผลิต]';
const num = (e) => `TEXT(${e})`;
const pad2 = (fn, arg = D) => `IF(${fn}(${arg}) < 10, "0" & ${fn}(${arg}), TEXT(${fn}(${arg})))`;
const lk = (alias, result, key, k) => `LOOKUP(@${alias}[${result}], @${alias}[${key}], ${k})`;
/** token → expression that produces its value for the row (D = the production date) */
exports.DATE_TOKENS = {
    Y: num(`YEAR(${D})`), D: num(`DAY(${D})`), DD: pad2('DAY'), 'DD-1': pad2('DAY', `DATEADD("day", ${D}, -1)`), Mo: num(`MONTH(${D})`), MM: pad2('MONTH'), Y1: `RIGHT(${num(`YEAR(${D})`)}, 1)`, YY: `RIGHT(${num(`YEAR(${D})`)}, 2)`,
    ...Object.fromEntries([1, 2, 3, 4, 5].flatMap((n) => [
        [`Y+${n}`, num(`YEAR(${D}) + ${n}`)], [`YY+${n}`, `RIGHT(${num(`YEAR(${D}) + ${n}`)}, 2)`], [`Y1+${n}`, `RIGHT(${num(`YEAR(${D}) + ${n}`)}, 1)`],
    ])),
};
exports.CODE_TOKENS = {
    YC: lk('ปี', 'รหัสปี', 'ปี', `YEAR(${D})`), YC2: lk('ปี', 'รหัสปี2', 'ปี', `YEAR(${D})`), YB: lk('ปี', 'ปี_พศ', 'ปี', `YEAR(${D})`),
    MC: lk('เดือน', 'ตัวอักษร', 'เดือน', `MONTH(${D})`), MON: lk('เดือน', 'ชื่อย่อ', 'เดือน', `MONTH(${D})`), M2: lk('เดือน', 'อักษร2', 'เดือน', `MONTH(${D})`),
    DC: lk('วัน', 'รหัสวัน', 'วัน', `DAY(${D})`),
    LC: lk('ไลน์', 'รหัสไลน์', 'ไลน์', '[ไลน์]'), LC2: lk('ไลน์', 'รหัสไลน์2', 'ไลน์', '[ไลน์]'), PF: lk('ไลน์', 'Plant', 'ไลน์', '[ไลน์]'), LX: lk('ไลน์', 'อื่นๆ', 'ไลน์', '[ไลน์]'),
    SC2: lk('กะ', 'SC2', 'กะ', '[กะ]'), SC3: lk('กะ', 'SC3', 'กะ', '[กะ]'), SC4: lk('กะ', 'SC4', 'กะ', '[กะ]'),
};
/** product / calendar tokens: P F and the calendar columns K2…K10 (optionally LEFT/RIGHT n, or the day before) */
function productToken(tok) {
    if (tok === 'P')
        return lk('ฐานข้อมูล', 'Short Product Code', 'Link', '[Link]');
    if (tok === 'F')
        return '[รหัสเอกสาร]';
    const m = /^K(\d+)(?:([LR])(\d+)|(-1))?$/.exec(tok);
    if (!m || +m[1] < 2 || +m[1] > 10)
        return null;
    const key = m[4] ? `DATEADD("day", ${D}, -1)` : D;
    const base = lk('ปฏิทิน', `K${m[1]}`, 'วันที่ผลิต', key);
    return m[2] ? `${m[2] === 'L' ? 'LEFT' : 'RIGHT'}(${base}, ${m[3]})` : base;
}
const join = (map, names) => names.map((n) => `"${n}=" & ${map[n] ?? productToken(n)}`).join(' & "|" & ');
const ALIASES = (names) => names.map((a) => ({ alias: a, sheet: a }));
/** `usedTokens`: tokens found in the templates (tokens.json) — the helper columns only compute what is needed */
function worksheetFormulas(usedTokens) {
    const used = new Set(usedTokens);
    const prodNames = [...new Set(['P', 'F', ...usedTokens.filter((x) => productToken(x))])];
    const dateNames = Object.keys(exports.DATE_TOKENS);
    const codeNames = Object.keys(exports.CODE_TOKENS);
    for (const x of used)
        if (!exports.DATE_TOKENS[x] && !exports.CODE_TOKENS[x] && !productToken(x))
            throw new Error(`ไม่รู้จักตัวแปร {${x}} ในแบบโค้ด`);
    const db = (r) => lk('ฐานข้อมูล', r, 'Link', '[Link]');
    const vars = '[ตัวแปรวันที่] & "|" & [ตัวแปรรหัส] & "|" & [ตัวแปรสินค้า]';
    const code = (n) => `IF(ISBLANK([วันที่ผลิต]), "", FILL(${db(`แบบโค้ดแถว ${n}`)}, ${vars}))`;
    return [
        { name: 'Link', type: 'varchar', width: 150, formula: { expr: '[รหัสเอกสาร] & [Market]', sources: [] } },
        { name: 'พบในฐานข้อมูล', type: 'varchar', width: 120, formula: { expr: `IF(ISBLANK([รหัสเอกสาร]), "", IF(ISBLANK(${db('Link')}), "X", "1"))`, sources: ALIASES([exports.SHEETS.db]) } },
        { name: 'ลูกค้า', type: 'varchar', width: 160, formula: { expr: db('ลูกค้า'), sources: ALIASES([exports.SHEETS.db]) } },
        { name: 'ชนิด', type: 'varchar', width: 130, formula: { expr: db('ชนิด'), sources: ALIASES([exports.SHEETS.db]) } },
        { name: 'Product Code SAP', type: 'varchar', width: 200, formula: { expr: db('Product Code SAP'), sources: ALIASES([exports.SHEETS.db]) } },
        { name: 'ตัวแปรวันที่', type: 'text', width: 140, formula: { expr: `IF(ISBLANK(${D}), "", ${join(exports.DATE_TOKENS, dateNames)})`, sources: [] } },
        { name: 'ตัวแปรรหัส', type: 'text', width: 140, formula: { expr: `IF(ISBLANK(${D}), "", ${join(exports.CODE_TOKENS, codeNames)})`, sources: ALIASES([exports.SHEETS.year, exports.SHEETS.month, exports.SHEETS.day, exports.SHEETS.line, exports.SHEETS.shift]) } },
        { name: 'ตัวแปรสินค้า', type: 'text', width: 140, formula: { expr: `IF(ISBLANK(${D}), "", ${join({}, prodNames)})`, sources: ALIASES([exports.SHEETS.db, exports.SHEETS.calendar]) } },
        ...[1, 2, 3, 4].map((n) => ({ name: `Code Format แถว ${n}`, type: 'text', width: 300, formula: { expr: code(n), sources: ALIASES([exports.SHEETS.db]) } })),
        { name: 'Code ฝน', type: 'varchar', width: 200, formula: { expr: db('Code ฝน'), sources: ALIASES([exports.SHEETS.db]) } },
    ];
}
exports.WS_INPUTS = [
    { name: 'วันที่ผลิต', type: 'date', width: 130, required: true }, v('ไลน์'), v('กะ', 70), v('รหัสเอกสาร'), v('Market'),
    { name: 'วันออกจากตู้อบ', type: 'date', width: 140 }, v('PO'), { name: 'ยอด', type: 'float', width: 100 }, t('หมายเหตุ', 240),
];
/** the 4-copy print form of the Excel ("ใบแจ้งการเปลี่ยนแปลงการผลิต (นอกแผน)") */
function printTemplate(worksheetSheetId) {
    const id = () => crypto.randomUUID();
    const text = (text, style = {}, extra = {}) => ({ id: id(), type: 'text', text, style: { align: 'left', ...style }, marginBottom: 2, ...extra });
    return {
        id: id(), name: 'ใบออกโค้ดนอกแผน 4 ส่วน', mode: 'perRow', perRow: { sheetId: worksheetSheetId, sheetName: exports.SHEETS.ws, onlySelected: true },
        page: { size: 'A4', orientation: 'landscape', margins: { top: 10, right: 10, bottom: 10, left: 10 } },
        base: { font: 'Sarabun', fontSize: 11, color: '#111827' },
        header: { enabled: false, blocks: [] }, footer: { enabled: false, blocks: [] },
        copies: { labels: ['ฉบับที่ 1 — ควบคุมเอกสาร', 'ฉบับที่ 2 — หัวหน้าแผนกบรรจุ', 'ฉบับที่ 3 — QC', 'ฉบับที่ 4 — เก็บที่หน้างาน'], separator: 'line' },
        blocks: [
            text('บริษัท ไอ-เทล คอร์ปอเรชั่น จำกัด (มหาชน)', { align: 'center', bold: true, fontSize: 12 }, { marginBottom: 0 }),
            text('ใบแจ้งการเปลี่ยนแปลงการผลิต (นอกแผน)   — {{copyLabel}}', { align: 'center', fontSize: 11 }),
            text('Ref. {{#}}    ไลน์: {{ไลน์}}    วันที่ผลิต: {{วันที่ผลิต}}    กะ: {{กะ}}    ลูกค้า: {{ลูกค้า}}    ชนิด: {{ชนิด}}    PO: {{PO}}', { fontSize: 10 }),
            { id: id(), type: 'charGrid', cells: 40, cellHeightMm: 6, fontSize: 10, borderColor: '#374151', showIndex: true, showLabels: true, marginBottom: 3,
                lines: [1, 2, 3, 4].map((n) => ({ id: id(), label: `แถว ${n}`, text: `{{Code Format แถว ${n}}}` })) },
            { id: id(), type: 'signature', perRow: 3, boxHeightMm: 9, gapMm: 8, lineColor: '#111827', lineWidth: 0.6, marginTop: 2, marginBottom: 0,
                labelStyle: { fontSize: 8, align: 'center' }, nameStyle: { fontSize: 9, align: 'center' },
                slots: ['( ควบคุมเอกสาร )', '( หัวหน้าแผนกบรรจุ )', '( หัวหน้าแผนก QC )'].map((label) => ({ id: id(), label, askAtExport: false, showDate: false })) },
        ],
        watermark: { enabled: false, text: '', color: '#9CA3AF', opacity: 0.15, size: 90, angle: -35 }, lockEditing: false,
    };
}
//# sourceMappingURL=model.js.map