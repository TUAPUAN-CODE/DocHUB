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
export interface ColDef { name: string; type: ColType; width?: number; formula?: { expr: string; sources: { alias: string; sheet: string }[] }; required?: boolean }
export interface SheetDef { name: string; columns: ColDef[]; tab?: string }

const v = (name: string, width = 140): ColDef => ({ name, type: 'varchar', width });
const t = (name: string, width = 320): ColDef => ({ name, type: 'text', width });

export const SHEETS = { year: 'ปี', month: 'เดือน', day: 'วัน', line: 'ไลน์', shift: 'กะ', calendar: 'ปฏิทิน', db: 'ฐานข้อมูล', ws: 'Worksheet' } as const;

export const REF_SHEETS: SheetDef[] = [
  { name: SHEETS.year, columns: [v('ปี'), v('ปี_พศ'), v('รหัสปี'), v('รหัสปี2')] },
  { name: SHEETS.month, columns: [v('เดือน'), v('ตัวอักษร'), v('ชื่อย่อ'), v('เลข2หลัก'), v('อักษร2')] },
  { name: SHEETS.day, columns: [v('วัน'), v('รหัสวัน')] },
  { name: SHEETS.line, columns: [v('ไลน์'), v('รหัสไลน์'), v('รหัสไลน์2'), v('Plant'), v('อื่นๆ')] },
  { name: SHEETS.shift, columns: [v('กะ'), v('SC2'), v('SC3'), v('SC4')] },
  { name: SHEETS.calendar, columns: [{ name: 'วันที่ผลิต', type: 'date', width: 130 }, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => v(`K${i}`, 120))] },
];

export const DB_PLAIN: ColDef[] = [
  v('รหัสเอกสาร'), v('PKG', 80), v('Market'), v('ลูกค้า'),
  t('แบบโค้ดแถว 1'), t('แบบโค้ดแถว 2'), t('แบบโค้ดแถว 3'), t('แบบโค้ดแถว 4'),
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

/* ---------------- the daily worksheet ---------------- */
const D = '[วันที่ผลิต]';
const num = (e: string) => `TEXT(${e})`;
const pad2 = (fn: 'DAY' | 'MONTH', arg = D) => `IF(${fn}(${arg}) < 10, "0" & ${fn}(${arg}), TEXT(${fn}(${arg})))`;
const lk = (alias: string, result: string, key: string, k: string) => `LOOKUP(@${alias}[${result}], @${alias}[${key}], ${k})`;

/** token → expression that produces its value for the row (D = the production date) */
export const DATE_TOKENS: Record<string, string> = {
  Y: num(`YEAR(${D})`), D: num(`DAY(${D})`), DD: pad2('DAY'), 'DD-1': pad2('DAY', `DATEADD("day", ${D}, -1)`), Mo: num(`MONTH(${D})`), MM: pad2('MONTH'), Y1: `RIGHT(${num(`YEAR(${D})`)}, 1)`, YY: `RIGHT(${num(`YEAR(${D})`)}, 2)`,
  ...Object.fromEntries([1, 2, 3, 4, 5].flatMap((n) => [
    [`Y+${n}`, num(`YEAR(${D}) + ${n}`)], [`YY+${n}`, `RIGHT(${num(`YEAR(${D}) + ${n}`)}, 2)`], [`Y1+${n}`, `RIGHT(${num(`YEAR(${D}) + ${n}`)}, 1)`],
  ])),
};
export const CODE_TOKENS: Record<string, string> = {
  YC: lk('ปี', 'รหัสปี', 'ปี', `YEAR(${D})`), YC2: lk('ปี', 'รหัสปี2', 'ปี', `YEAR(${D})`), YB: lk('ปี', 'ปี_พศ', 'ปี', `YEAR(${D})`),
  MC: lk('เดือน', 'ตัวอักษร', 'เดือน', `MONTH(${D})`), MON: lk('เดือน', 'ชื่อย่อ', 'เดือน', `MONTH(${D})`), M2: lk('เดือน', 'อักษร2', 'เดือน', `MONTH(${D})`),
  DC: lk('วัน', 'รหัสวัน', 'วัน', `DAY(${D})`),
  LC: lk('ไลน์', 'รหัสไลน์', 'ไลน์', '[ไลน์]'), LC2: lk('ไลน์', 'รหัสไลน์2', 'ไลน์', '[ไลน์]'), PF: lk('ไลน์', 'Plant', 'ไลน์', '[ไลน์]'), LX: lk('ไลน์', 'อื่นๆ', 'ไลน์', '[ไลน์]'),
  SC2: lk('กะ', 'SC2', 'กะ', '[กะ]'), SC3: lk('กะ', 'SC3', 'กะ', '[กะ]'), SC4: lk('กะ', 'SC4', 'กะ', '[กะ]'),
};
/** product / calendar tokens: P F and the calendar columns K2…K10 (optionally LEFT/RIGHT n, or the day before) */
export function productToken(tok: string): string | null {
  if (tok === 'P') return lk('ฐานข้อมูล', 'Short Product Code', 'Link', '[Link]');
  if (tok === 'F') return '[รหัสเอกสาร]';
  const m = /^K(\d+)(?:([LR])(\d+)|(-1))?$/.exec(tok);
  if (!m || +m[1] < 2 || +m[1] > 10) return null;
  const key = m[4] ? `DATEADD("day", ${D}, -1)` : D;
  const base = lk('ปฏิทิน', `K${m[1]}`, 'วันที่ผลิต', key);
  return m[2] ? `${m[2] === 'L' ? 'LEFT' : 'RIGHT'}(${base}, ${m[3]})` : base;
}

const join = (map: Record<string, string>, names: string[]) => names.map((n) => `"${n}=" & ${map[n] ?? productToken(n)}`).join(' & "|" & ');
const ALIASES = (names: string[]) => names.map((a) => ({ alias: a, sheet: a }));

/** `usedTokens`: tokens found in the templates (tokens.json) — the helper columns only compute what is needed */
export function worksheetFormulas(usedTokens: string[]): ColDef[] {
  const used = new Set(usedTokens);
  const prodNames = [...new Set(['P', 'F', ...usedTokens.filter((x) => productToken(x))])];
  const dateNames = Object.keys(DATE_TOKENS);
  const codeNames = Object.keys(CODE_TOKENS);
  for (const x of used) if (!DATE_TOKENS[x] && !CODE_TOKENS[x] && !productToken(x)) throw new Error(`ไม่รู้จักตัวแปร {${x}} ในแบบโค้ด`);
  const db = (r: string) => lk('ฐานข้อมูล', r, 'Link', '[Link]');
  const vars = '[ตัวแปรวันที่] & "|" & [ตัวแปรรหัส] & "|" & [ตัวแปรสินค้า]';
  const code = (n: number) => `IF(ISBLANK([วันที่ผลิต]), "", FILL(${db(`แบบโค้ดแถว ${n}`)}, ${vars}))`;
  return [
    { name: 'Link', type: 'varchar', width: 150, formula: { expr: '[รหัสเอกสาร] & [Market]', sources: [] } },
    { name: 'พบในฐานข้อมูล', type: 'varchar', width: 120, formula: { expr: `IF(ISBLANK([รหัสเอกสาร]), "", IF(ISBLANK(${db('Link')}), "X", "1"))`, sources: ALIASES([SHEETS.db]) } },
    { name: 'ลูกค้า', type: 'varchar', width: 160, formula: { expr: db('ลูกค้า'), sources: ALIASES([SHEETS.db]) } },
    { name: 'ชนิด', type: 'varchar', width: 130, formula: { expr: db('ชนิด'), sources: ALIASES([SHEETS.db]) } },
    { name: 'Product Code SAP', type: 'varchar', width: 200, formula: { expr: db('Product Code SAP'), sources: ALIASES([SHEETS.db]) } },
    { name: 'ตัวแปรวันที่', type: 'text', width: 140, formula: { expr: `IF(ISBLANK(${D}), "", ${join(DATE_TOKENS, dateNames)})`, sources: [] } },
    { name: 'ตัวแปรรหัส', type: 'text', width: 140, formula: { expr: `IF(ISBLANK(${D}), "", ${join(CODE_TOKENS, codeNames)})`, sources: ALIASES([SHEETS.year, SHEETS.month, SHEETS.day, SHEETS.line, SHEETS.shift]) } },
    { name: 'ตัวแปรสินค้า', type: 'text', width: 140, formula: { expr: `IF(ISBLANK(${D}), "", ${join({}, prodNames)})`, sources: ALIASES([SHEETS.db, SHEETS.calendar]) } },
    ...[1, 2, 3, 4].map((n) => ({ name: `Code Format แถว ${n}`, type: 'text' as const, width: 300, formula: { expr: code(n), sources: ALIASES([SHEETS.db]) } })),
    { name: 'Code ฝน', type: 'varchar', width: 200, formula: { expr: db('Code ฝน'), sources: ALIASES([SHEETS.db]) } },
  ];
}
export const WS_INPUTS: ColDef[] = [
  { name: 'วันที่ผลิต', type: 'date', width: 130, required: true }, v('ไลน์'), v('กะ', 70), v('รหัสเอกสาร'), v('Market'),
  { name: 'วันออกจากตู้อบ', type: 'date', width: 140 }, v('PO'), { name: 'ยอด', type: 'float', width: 100 }, t('หมายเหตุ', 240),
];

/** the 4-copy print form of the Excel ("ใบแจ้งการเปลี่ยนแปลงการผลิต (นอกแผน)") */
export function printTemplate(worksheetSheetId: string) {
  const id = () => crypto.randomUUID();
  const text = (text: string, style: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id: id(), type: 'text', text, style: { align: 'left', ...style }, marginBottom: 2, ...extra });
  return {
    id: id(), name: 'ใบออกโค้ดนอกแผน 4 ส่วน', mode: 'perRow', perRow: { sheetId: worksheetSheetId, sheetName: SHEETS.ws, onlySelected: true },
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
