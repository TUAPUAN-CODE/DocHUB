/**
 * InkCode — the "ใบออกโค้ดนอกแผน" system of the two Excel files, as DocHUB sheets.
 *
 *   รหัสอ้างอิง  (ปี / เดือน / วัน / ไลน์ / กะ / ปฏิทิน)   ← the "Ref" sheet of the Master Database
 *   ฐานข้อมูล    one row per รหัสเอกสาร + Market, with 4 code TEMPLATES (แบบโค้ดแถว 1-4)
 *   Worksheet    what the staff type each day (ไลน์, กะ, วันที่ผลิต, รหัสเอกสาร, Market) → the 4 code lines are rendered by formulas
 *
 * A template is text with {tokens}, e.g.  "{P} S{YC}{MC}{DC}S{LC}".  FILL(template, "YC=5|MC=A|…") renders it.
 * This file only builds definitions (pure) — seedInkCode.ts sends them to a running DocHUB server.
 */
export type ColType = 'varchar' | 'text' | 'date' | 'float';
export interface ColDef {
  name: string; type: ColType | 'select'; width?: number; formula?: { expr: string; sources: { alias: string; sheet: string }[] }; required?: boolean; description?: string;
  /** drop-down whose choices are the values of a column of another sheet (sheet = sheet name inside the same seed, file = which seeded file) */
  lookup?: { sheet: string; column: string };
}
export interface SheetDef { name: string; columns: ColDef[]; tab?: string }

const v = (name: string, width = 140): ColDef => ({ name, type: 'varchar', width });
const t = (name: string, width = 320): ColDef => ({ name, type: 'text', width });

export const SHEETS = { year: 'ปี', month: 'เดือน', day: 'วัน', line: 'ไลน์', shift: 'กะ', calendar: 'ปฏิทิน', sample: 'ตัวอย่าง', db: 'ฐานข้อมูล', help: 'คู่มือตัวแปร', ws: 'Worksheet' } as const;

export const REF_SHEETS: SheetDef[] = [
  { name: SHEETS.year, columns: [v('ปี'), v('ปี_พศ'), v('รหัสปี'), v('รหัสปี2')] },
  { name: SHEETS.month, columns: [v('เดือน'), v('ตัวอักษร'), v('ชื่อย่อ'), v('เลข2หลัก'), v('อักษร2')] },
  { name: SHEETS.day, columns: [v('วัน'), v('รหัสวัน')] },
  { name: SHEETS.line, columns: [v('ไลน์'), v('รหัสไลน์'), v('รหัสไลน์2'), v('Plant'), v('อื่นๆ')] },
  { name: SHEETS.shift, columns: [v('กะ'), v('SC2'), v('SC3'), v('SC4')] },
  { name: SHEETS.sample, columns: [v('ชื่อ', 100), { name: 'วันที่ผลิต', type: 'date', width: 130 }, v('ไลน์'), v('กะ', 70)] },
  { name: SHEETS.calendar, columns: [{ name: 'วันที่ผลิต', type: 'date', width: 130 }, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => v(`K${i}`, 120))] },
];

export const DB_PLAIN: ColDef[] = [
  v('รหัสเอกสาร'), v('PKG', 80), v('Market'), v('ลูกค้า'),
  ...[1, 2, 3, 4].map((n): ColDef => ({ ...t(`แบบโค้ดแถว ${n}`), description: 'แบบข้อความที่มี {ตัวแปร} เช่น {P} S{YC}{MC}{DC}S{LC} — ความหมายและที่มาของแต่ละตัวแปรดูในชีต "คู่มือตัวแปร" ผลลัพธ์จริงดูที่คอลัมน์ "ตัวอย่างโค้ดแถว" ทางขวา' })),
  v('รหัสเอกสารระบบ Code'), v('Rev.', 70), v('Short Product Code'), v('Product Code SAP', 200),
  v('Material Packaging 1', 200), v('Material Packaging 2', 200), v('Material Packaging 3', 200),
  v('ชนิด'), t('Note', 200), v('SVT', 70), t('บันทึกประวัติ', 240), v('สถานะ'), v('สถานะติดตาม'), v('special'),
  t('สูตรเดิมที่ต้องตรวจ', 360),
];
/** Excel header → DocHUB column (the JSON keys written by scripts/inkcode/extract.py) */
export const DB_KEY_MAP: Record<string, string> = {
  'Product Code (SAP)': 'Product Code SAP', 'Material Packaging#1': 'Material Packaging 1', 'Material Packaging#2': 'Material Packaging 2', 'Material Packaging#3': 'Material Packaging 3', 'SVT?': 'SVT',
};
export const DB_FORMULAS: ColDef[] = [
  { name: 'Link', type: 'varchar', width: 150, formula: { expr: '[รหัสเอกสาร] & [Market]', sources: [] } },
  { name: 'Code ฝน', type: 'varchar', width: 200, formula: { expr: 'MID([Product Code SAP], 2, 1) & MID([Product Code SAP], 12, 5) & " " & MID([Product Code SAP], 3, 9)', sources: [] } },
];

/* ---------------- tokens → formulas ---------------- */
const num = (e: string) => `TEXT(${e})`;
const lk = (alias: string, result: string, key: string, k: string) => `LOOKUP(@${alias}[${result}], @${alias}[${key}], ${k})`;

/** Where a template is rendered: the Worksheet row (real production date / line) or the database row (sample date / line, to preview) */
export interface Ctx { date: string; line: string; shift: string; short: string; docCode: string; tpl: (n: number) => string; link: string }
const pad2 = (c: Ctx, fn: 'DAY' | 'MONTH', arg = c.date) => `IF(${fn}(${arg}) < 10, "0" & ${fn}(${arg}), TEXT(${fn}(${arg})))`;

export function dateTokens(c: Ctx): Record<string, string> {
  const D = c.date;
  return {
    Y: num(`YEAR(${D})`), D: num(`DAY(${D})`), DD: pad2(c, 'DAY'), 'DD-1': pad2(c, 'DAY', `DATEADD("day", ${D}, -1)`), Mo: num(`MONTH(${D})`), MM: pad2(c, 'MONTH'), Y1: `RIGHT(${num(`YEAR(${D})`)}, 1)`, YY: `RIGHT(${num(`YEAR(${D})`)}, 2)`,
    ...Object.fromEntries([1, 2, 3, 4, 5].flatMap((n) => [
      [`Y+${n}`, num(`YEAR(${D}) + ${n}`)], [`YY+${n}`, `RIGHT(${num(`YEAR(${D}) + ${n}`)}, 2)`], [`Y1+${n}`, `RIGHT(${num(`YEAR(${D}) + ${n}`)}, 1)`],
    ])),
  };
}
export function codeTokens(c: Ctx): Record<string, string> {
  const D = c.date, L = c.line, S = c.shift;
  return {
    YC: lk('ปี', 'รหัสปี', 'ปี', `YEAR(${D})`), YC2: lk('ปี', 'รหัสปี2', 'ปี', `YEAR(${D})`), YB: lk('ปี', 'ปี_พศ', 'ปี', `YEAR(${D})`),
    MC: lk('เดือน', 'ตัวอักษร', 'เดือน', `MONTH(${D})`), MON: lk('เดือน', 'ชื่อย่อ', 'เดือน', `MONTH(${D})`), M2: lk('เดือน', 'อักษร2', 'เดือน', `MONTH(${D})`),
    DC: lk('วัน', 'รหัสวัน', 'วัน', `DAY(${D})`),
    LC: lk('ไลน์', 'รหัสไลน์', 'ไลน์', L), LC2: lk('ไลน์', 'รหัสไลน์2', 'ไลน์', L), PF: lk('ไลน์', 'Plant', 'ไลน์', L), LX: lk('ไลน์', 'อื่นๆ', 'ไลน์', L),
    SC2: lk('กะ', 'SC2', 'กะ', S), SC3: lk('กะ', 'SC3', 'กะ', S), SC4: lk('กะ', 'SC4', 'กะ', S),
  };
}
/** product / calendar tokens: P F and the calendar columns K2…K10 (optionally LEFT/RIGHT n, or the day before) */
export function productToken(tok: string, c: Ctx): string | null {
  if (tok === 'P') return c.short;
  if (tok === 'F') return c.docCode;
  const m = /^K(\d+)(?:([LR])(\d+)|(-1))?$/.exec(tok);
  if (!m || +m[1] < 2 || +m[1] > 10) return null;
  const key = m[4] ? `DATEADD("day", ${c.date}, -1)` : c.date;
  const base = lk('ปฏิทิน', `K${m[1]}`, 'วันที่ผลิต', key);
  return m[2] ? `${m[2] === 'L' ? 'LEFT' : 'RIGHT'}(${base}, ${m[3]})` : base;
}
const isKnown = (tok: string) => { const c = WS_CTX; return !!(dateTokens(c)[tok] || codeTokens(c)[tok] || productToken(tok, c)); };

const join = (names: string[], get: (n: string) => string | null | undefined) => names.map((n) => `"${n}=" & ${get(n)}`).join(' & "|" & ');
const ALIASES = (names: string[]) => names.map((a) => ({ alias: a, sheet: a }));
const REF_ALIASES = [SHEETS.year, SHEETS.month, SHEETS.day, SHEETS.line, SHEETS.shift];

const db = (r: string) => lk('ฐานข้อมูล', r, 'Link', '[Link]');
const WS_CTX: Ctx = { date: '[วันที่ผลิต]', line: '[ไลน์]', shift: '[กะ]', short: db('Short Product Code'), docCode: '[รหัสเอกสาร]', link: '[Link]', tpl: (n) => db(`แบบโค้ดแถว ${n}`) };
const DB_CTX: Ctx = { date: '[วันที่ตัวอย่าง]', line: '[ไลน์ตัวอย่าง]', shift: '[กะตัวอย่าง]', short: '[Short Product Code]', docCode: '[รหัสเอกสาร]', link: '[Link]', tpl: (n) => `[แบบโค้ดแถว ${n}]` };

/** The three helper columns (date / code / product variables) + the four rendered code lines for a context */
function renderColumns(c: Ctx, usedTokens: string[], prefix: string, codeNames: string[], tplSources: string[]): ColDef[] {
  for (const x of usedTokens) if (!isKnown(x)) throw new Error(`ไม่รู้จักตัวแปร {${x}} ในแบบโค้ด`);
  const dT = dateTokens(c), cT = codeTokens(c);
  const prodNames = [...new Set(['P', 'F', ...usedTokens.filter((x) => productToken(x, c))])];
  const guard = (e: string) => `IF(ISBLANK(${c.date}), "", ${e})`;
  const vN = `${prefix}ตัวแปรวันที่`, vC = `${prefix}ตัวแปรรหัส`, vP = `${prefix}ตัวแปรสินค้า`;
  const vars = `[${vN}] & "|" & [${vC}] & "|" & [${vP}]`;
  const hasLookupP = c.short.startsWith('LOOKUP');
  return [
    { name: vN, type: 'text', width: 140, formula: { expr: guard(join(Object.keys(dT), (n) => dT[n])), sources: [] } },
    { name: vC, type: 'text', width: 140, formula: { expr: guard(join(Object.keys(cT), (n) => cT[n])), sources: ALIASES(REF_ALIASES) } },
    { name: vP, type: 'text', width: 140, formula: { expr: guard(join(prodNames, (n) => productToken(n, c))), sources: ALIASES([...(hasLookupP ? [SHEETS.db] : []), SHEETS.calendar]) } },
    ...codeNames.map((name, i) => ({ name, type: 'text' as const, width: 300, formula: { expr: `IF(OR(ISBLANK(${c.date}), ISBLANK(${c.tpl(i + 1)})), "", FILL(${c.tpl(i + 1)}, ${vars}))`, sources: ALIASES(tplSources) } })),
  ];
}

/** Worksheet: what the staff type → everything else is computed */
export function worksheetFormulas(usedTokens: string[]): ColDef[] {
  const d = ALIASES([SHEETS.db]);
  return [
    { name: 'Link', type: 'varchar', width: 150, formula: { expr: '[รหัสเอกสาร] & [Market]', sources: [] } },
    { name: 'พบในฐานข้อมูล', type: 'varchar', width: 120, description: '1 = พบรหัสเอกสาร+Market ในฐานข้อมูล · X = ไม่พบ (ตรวจการพิมพ์)', formula: { expr: `IF(ISBLANK([รหัสเอกสาร]), "", IF(ISBLANK(${db('Link')}), "X", "1"))`, sources: d } },
    { name: 'ลูกค้า', type: 'varchar', width: 160, formula: { expr: db('ลูกค้า'), sources: d } },
    { name: 'ชนิด', type: 'varchar', width: 130, formula: { expr: db('ชนิด'), sources: d } },
    { name: 'Product Code SAP', type: 'varchar', width: 200, formula: { expr: db('Product Code SAP'), sources: d } },
    { name: 'PKG', type: 'varchar', width: 80, description: 'ชนิดบรรจุภัณฑ์ (Can = QR 23 ตัวอักษร/แถว, อื่นๆ 40)', formula: { expr: db('PKG'), sources: d } },
    ...['Material Packaging 1', 'Material Packaging 2', 'Material Packaging 3', 'รหัสเอกสารระบบ Code', 'Rev.'].map((n): ColDef => ({ name: n, type: 'varchar', width: 170, formula: { expr: db(n), sources: d } })),
    ...renderColumns(WS_CTX, usedTokens, '', [1, 2, 3, 4].map((n) => `Code Format แถว ${n}`), [SHEETS.db]),
    { name: 'Code ฝน', type: 'varchar', width: 200, formula: { expr: db('Code ฝน'), sources: d } },
  ];
}

/** Master database: preview of the 4 code lines for a sample date / line (edit the sheet "ตัวอย่าง" in the reference file) */
export function dbPreviewFormulas(usedTokens: string[]): ColDef[] {
  const smp = ALIASES([SHEETS.sample]);
  const pick = (col: string) => lk('ตัวอย่าง', col, 'ชื่อ', '"ตัวอย่าง"');
  return [
    { name: 'วันที่ตัวอย่าง', type: 'date', width: 130, description: 'ดึงจากชีต "ตัวอย่าง" ในไฟล์ InkCode - รหัสอ้างอิง (แก้ที่นั่น)', formula: { expr: pick('วันที่ผลิต'), sources: smp } },
    { name: 'ไลน์ตัวอย่าง', type: 'varchar', width: 120, formula: { expr: pick('ไลน์'), sources: smp } },
    { name: 'กะตัวอย่าง', type: 'varchar', width: 90, formula: { expr: pick('กะ'), sources: smp } },
    ...renderColumns(DB_CTX, usedTokens, 'ตัวอย่าง-', [1, 2, 3, 4].map((n) => `ตัวอย่างโค้ดแถว ${n}`), []),
  ];
}
export const SAMPLE_ROW = { ชื่อ: 'ตัวอย่าง', วันที่ผลิต: '2026-03-17', ไลน์: 'Can R', กะ: 'DS' };

const dropdown = (name: string, sheet: string, column: string, width = 140): ColDef => ({ name, type: 'select', width, lookup: { sheet, column } });
export const WS_INPUTS: ColDef[] = [
  { name: 'วันที่ผลิต', type: 'date', width: 130, required: true }, v('เวลาเริ่ม', 90),
  { ...dropdown('ไลน์', SHEETS.line, 'ไลน์'), description: 'เลือกจากรายการในไฟล์ InkCode - รหัสอ้างอิง › ไลน์' },
  { ...dropdown('กะ', SHEETS.shift, 'กะ', 80), description: 'เลือกจากรายการในไฟล์ InkCode - รหัสอ้างอิง › กะ' },
  { ...dropdown('รหัสเอกสาร', SHEETS.db, 'รหัสเอกสาร'), description: 'เลือกจากรายการใน InkCode - Master Database › ฐานข้อมูล' },
  { ...dropdown('Market', SHEETS.db, 'Market'), description: 'เลือกจากรายการใน InkCode - Master Database › ฐานข้อมูล (ต้องเป็นคู่กับรหัสเอกสาร)' },
  { name: 'วันออกจากตู้อบ', type: 'date', width: 140 }, v('PO'), { name: 'ยอด', type: 'float', width: 100 }, t('หมายเหตุ', 240),
];

/** Help sheet of the master database: every variable of a code template and where its value comes from */
export const HELP_COLUMNS: ColDef[] = [v('ตัวแปร', 90), t('ความหมาย', 260), v('ดึงมาจากไฟล์', 200), v('ชีต', 130), v('คอลัมน์', 150), v('ตัวอย่าง', 160)];
const REFF = 'InkCode - รหัสอ้างอิง', DBF = 'InkCode - Master Database';
const hrow = (ตัวแปร: string, ความหมาย: string, ไฟล์: string, ชีต: string, คอลัมน์: string, ตัวอย่าง: string) => ({ ตัวแปร: `{${ตัวแปร}}`, ความหมาย, ดึงมาจากไฟล์: ไฟล์, ชีต, คอลัมน์, ตัวอย่าง });
export const HELP_ROWS = [
  hrow('P', 'Short Product Code ของสินค้า (แถวนี้)', DBF, SHEETS.db, 'Short Product Code', 'B23AA'),
  hrow('F', 'รหัสเอกสาร ของแถวที่กรอกใน Worksheet', 'ใบออกโค้ดนอกแผน', SHEETS.ws, 'รหัสเอกสาร', 'P519'),
  hrow('YC', 'รหัสปี (ตามปีของวันที่ผลิต)', REFF, SHEETS.year, 'รหัสปี', '9 (ปี 2026)'),
  hrow('YC2', 'รหัสปี แบบที่ 2', REFF, SHEETS.year, 'รหัสปี2', '6'),
  hrow('YB', 'ปี พ.ศ.', REFF, SHEETS.year, 'ปี_พศ', '2569'),
  hrow('MC', 'รหัสเดือน (A–M ไม่มี I)', REFF, SHEETS.month, 'ตัวอักษร', 'C (มีนาคม)'),
  hrow('MON', 'ชื่อเดือนย่อ', REFF, SHEETS.month, 'ชื่อย่อ', 'MAR'),
  hrow('M2', 'ชื่อเดือน 2 ตัวอักษร', REFF, SHEETS.month, 'อักษร2', 'MR'),
  hrow('DC', 'รหัสวัน', REFF, SHEETS.day, 'รหัสวัน', 'H (วันที่ 17)'),
  hrow('LC', 'รหัสไลน์ (ตามไลน์ที่เลือก)', REFF, SHEETS.line, 'รหัสไลน์', 'R (Can R)'),
  hrow('LC2', 'รหัสไลน์ แบบ 2 หลัก', REFF, SHEETS.line, 'รหัสไลน์2', '01'),
  hrow('PF', 'Plant ของไลน์', REFF, SHEETS.line, 'Plant', 'PF2'),
  hrow('SC2', 'รหัสกะ (ตัวที่ 2)', REFF, SHEETS.shift, 'SC2', '1'),
  hrow('SC3', 'รหัสกะ (ตัวที่ 3)', REFF, SHEETS.shift, 'SC3', 'S'),
  hrow('SC4', 'รหัสกะ (ตัวที่ 4)', REFF, SHEETS.shift, 'SC4', '1'),
  hrow('Y', 'ปี ค.ศ. 4 หลัก ของวันที่ผลิต (คำนวณ ไม่ได้ดึงจากตาราง)', 'วันที่ผลิตใน Worksheet', SHEETS.ws, 'วันที่ผลิต', '2026'),
  hrow('Y+3', 'ปี ค.ศ. บวก 3 (ใช้ +1…+5 ได้)', 'วันที่ผลิตใน Worksheet', SHEETS.ws, 'วันที่ผลิต', '2029'),
  hrow('YY', 'ปี 2 หลักท้าย (YY+3 = ปีบวก 3 แล้วเอา 2 หลัก)', 'วันที่ผลิตใน Worksheet', SHEETS.ws, 'วันที่ผลิต', '26'),
  hrow('Y1', 'ปี 1 หลักท้าย', 'วันที่ผลิตใน Worksheet', SHEETS.ws, 'วันที่ผลิต', '6'),
  hrow('D', 'วันที่ (ไม่เติมศูนย์)', 'วันที่ผลิตใน Worksheet', SHEETS.ws, 'วันที่ผลิต', '5'),
  hrow('DD', 'วันที่ 2 หลัก (เติมศูนย์)', 'วันที่ผลิตใน Worksheet', SHEETS.ws, 'วันที่ผลิต', '05'),
  hrow('DD-1', 'วันที่ของ "วันก่อนหน้า" แบบ 2 หลัก', 'วันที่ผลิตใน Worksheet', SHEETS.ws, 'วันที่ผลิต', '04'),
  hrow('Mo', 'เดือนเป็นตัวเลข (ไม่เติมศูนย์)', 'วันที่ผลิตใน Worksheet', SHEETS.ws, 'วันที่ผลิต', '3'),
  hrow('MM', 'เดือนเป็นตัวเลข 2 หลัก', 'วันที่ผลิตใน Worksheet', SHEETS.ws, 'วันที่ผลิต', '03'),
  hrow('K2…K10', 'ค่าจากปฏิทิน Julian ของวันที่ผลิต (K3 = เลขวันที่ในปี เช่น 278)', REFF, SHEETS.calendar, 'K2…K10', '278'),
  hrow('K6L3 / K6R1', 'ปฏิทิน K6 เอา 3 ตัวแรก / 1 ตัวท้าย (K3-1 = ของวันก่อนหน้า)', REFF, SHEETS.calendar, 'K6', '641 / A'),
];

/** the print form of the Excel ("ใบแจ้งการเปลี่ยนแปลงการผลิต (นอกแผน)"): one table per notice, printed 4 times (A3 landscape) */
export function printTemplate(worksheetSheetId: string) {
  const id = () => crypto.randomUUID();
  const text = (text: string, style: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id: id(), type: 'text', text, style: { align: 'left', ...style }, marginBottom: 0, ...extra });
  const row3 = (center: string, right: string, centerStyle: Record<string, unknown>, rightStyle: Record<string, unknown>, mb = 0) => ({
    id: id(), type: 'columns', gap: 2, marginBottom: mb,
    cols: [{ widthPct: 22, blocks: [text('')] }, { widthPct: 56, blocks: [text(center, { align: 'center', ...centerStyle })] }, { widthPct: 22, blocks: [text(right, { align: 'right', ...rightStyle })] }],
  });
  const side = (header: string, widthMm: number, items: { label?: string; text: string }[]) => ({ id: id(), header, widthMm, items: items.map((i) => ({ id: id(), label: i.label ?? '', text: i.text })) });
  return {
    id: id(), name: 'ใบออกโค้ดนอกแผน 4 ส่วน', mode: 'perRow', followSheet: true, perRow: { sheetId: worksheetSheetId, sheetName: SHEETS.ws, onlySelected: true },
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
export function printTemplateByCustomer(worksheetSheetId: string) {
  const base: any = printTemplate(worksheetSheetId);
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
export const TREE = { root: 'InkCode', tree: 'InkCode - ใบออกโค้ด', templateFolder: 'แม่แบบ', plans: 'แผนผลิต', dayTemplate: 'แม่แบบรายวัน', plants: ['PF1', 'PF2'] } as const;
/** sheets of a day file — one per production area; the last one catches lines that belong to none of the others */
export const AREAS = ['Pouch', 'Can', 'Cup', 'อื่นๆ'] as const;
export const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const monthFolderName = (m: number) => `${String(m).padStart(2, '0')} ${THAI_MONTHS[m - 1]}`;
/** "2026-10-03" → { year: "2026", month: "10 ตุลาคม", file: "2026-10-03" } */
export function dayPath(date: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`วันที่ไม่ถูกต้อง: ${date}`);
  return { year: m[1], month: monthFolderName(Number(m[2])), file: date };
}
/** Area (sheet of the day file) of a production line: Cup / Can by the line name, Pouch also for Spout / Auto lines */
export function areaOf(line: string, product = ''): (typeof AREAS)[number] {
  for (const text of [line, product]) {
    const t = ` ${text.toLowerCase()} `;
    if (/\bcup\b/.test(t)) return 'Cup';
    if (/\bcan\b/.test(t)) return 'Can';
    if (/\b(pouch|spout|auto)\b/.test(t)) return 'Pouch';
  }
  return 'อื่นๆ';
}
/** Plant written inside a line name of the plan, e.g. "Pouch PF2 ชั้นบน" → PF2 */
export const plantInText = (s: string): string | null => { const m = /\bPF\s*(\d)\b/i.exec(s); return m ? `PF${m[1]}` : null; };
