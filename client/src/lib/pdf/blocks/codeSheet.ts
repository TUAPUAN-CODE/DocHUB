import { fillTokens } from '../variables';
import type { BuildCtx } from '../build';
import { MM } from '../types';
import type { BlockBase } from '../types';

/**
 * One table in the layout of the ink-code notice: columns on the left (ไลน์ / ลำดับ / ลูกค้า / ชนิด), the position grid
 * (1 character per box, several lines), and columns on the right (Mat. Packaging / Code / document codes / QR).
 * Left and right columns span all the grid lines; a right column may stack several "label | value" items.
 */
export interface SheetSideItem { id: string; label: string; text: string }
export interface SheetSideCol { id: string; header: string; widthMm: number; items: SheetSideItem[] }
export interface CodeSheetLine { id: string; text: string }
export interface CodeSheetBlock extends BlockBase {
  type: 'codeSheet';
  left: SheetSideCol[];
  right: SheetSideCol[];
  gridHeader: string;
  lines: CodeSheetLine[];
  cells: number;
  cellHeightMm: number;
  fontSize: number;
  headerBg: string;
  borderColor: string;
  showIndex: boolean;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'c' + Math.random().toString(36).slice(2));
export const newSideItem = (text = '', label = ''): SheetSideItem => ({ id: uid(), label, text });
export const newSideCol = (header = 'หัวคอลัมน์', widthMm = 25, items: SheetSideItem[] = [newSideItem()]): SheetSideCol => ({ id: uid(), header, widthMm, items });
export const newCodeSheet = (): CodeSheetBlock => ({
  id: uid(), type: 'codeSheet', cells: 40, cellHeightMm: 5.5, fontSize: 9, headerBg: '#DCEAF7', borderColor: '#374151', showIndex: true, gridHeader: 'ตำแหน่ง', marginBottom: 2,
  left: [newSideCol('ไลน์', 14, [newSideItem('{{ไลน์}}')]), newSideCol('ลำดับ', 12, [newSideItem('{{#}}')]), newSideCol('ลูกค้า', 30, [newSideItem('{{ลูกค้า}}')]), newSideCol('ชนิด', 24, [newSideItem('{{ชนิด}}')])],
  right: [
    newSideCol('Mat. Packaging', 42, [newSideItem('{{Material Packaging 1}}'), newSideItem('{{Material Packaging 2}}'), newSideItem('{{Material Packaging 3}}')]),
    newSideCol('Code', 44, [newSideItem('{{PO}}', 'PO'), newSideItem('{{Code ฝน}}', 'New code'), newSideItem('{{Product Code SAP}}', 'Code Sap')]),
    newSideCol('รหัสเอกสารสูตรการผลิต', 24, [newSideItem('{{รหัสเอกสาร}}')]),
    newSideCol('รหัสเอกสารระบบ Code', 28, [newSideItem('{{รหัสเอกสารระบบ Code}}/{{Rev.}}')]),
    newSideCol('QR Code', 20, [newSideItem('')]),
  ],
  lines: [1, 2, 3, 4].map((n) => ({ id: uid(), text: `{{Code Format แถว ${n}}}` })),
});

const pt = (mm: number) => mm * MM;
const NO_BORDER = [false, false, false, false];

export function buildCodeSheet(b: CodeSheetBlock, c: BuildCtx) {
  const n = Math.max(5, Math.min(80, Math.floor(b.cells || 40)));
  const rows = Math.max(1, b.lines.length);
  const side = [...b.left, ...b.right];
  const sideTotal = side.reduce((s, x) => s + pt(x.widthMm), 0);
  const room = c.contentWidth - pt(b.marginLeft ?? 0) - pt(b.marginRight ?? 0);
  // grid boxes get what the side columns leave; if that is too little the side columns shrink, never the page overflows
  const minCell = pt(2.8);
  let k = 1;
  if (room - sideTotal < minCell * n) k = Math.max(0.4, (room - minCell * n) / sideTotal);
  const w = (x: SheetSideCol) => pt(x.widthMm) * k;
  const cw = (room - sideTotal * k) / n;
  const fs = Math.min(b.fontSize, cw * 0.95 / 0.6);
  const cellH = pt(b.cellHeightMm);
  const head = (text: string, extra: object = {}) => ({ text, bold: true, fontSize: Math.min(9, b.fontSize), alignment: 'center', fillColor: b.headerBg, margin: [0, 2, 0, 2], ...extra });
  const span = (col: SheetSideCol, rowSpan: number) => ({ text: '', rowSpan });

  const body: any[][] = [];
  // header row 1: side headers (spanning header rows 1-2), grid title over all boxes
  const r1: any[] = [...b.left.map((x) => head(x.header, { rowSpan: b.showIndex ? 2 : 1 })), head(b.gridHeader, { colSpan: n, fontSize: 9 }), ...Array.from({ length: n - 1 }, () => ({})), ...b.right.map((x) => head(x.header, { rowSpan: b.showIndex ? 2 : 1 }))];
  body.push(r1);
  if (b.showIndex) body.push([...b.left.map(() => ({})), ...Array.from({ length: n }, (_v, i) => ({ text: String(i + 1), fontSize: Math.min(6.5, cw / 2.2), alignment: 'center', color: '#374151', margin: [0, 0.5, 0, 0.5] })), ...b.right.map(() => ({}))]);

  const styleCell = (text: string) => ({ text: text || ' ', fontSize: Math.min(b.fontSize, 9.5), margin: [2, 1, 2, 1] });
  const stack = (col: SheetSideCol) => {
    const items = col.items.map((it) => ({ label: it.label, text: fillTokens(it.text, c.vars, c.rowVars) }));
    if (items.length <= 1 && !items[0]?.label) return { ...styleCell(items[0]?.text ?? ''), rowSpan: rows, alignment: 'left' };
    const lw = Math.min(w(col) * 0.38, pt(16));
    const hasLabel = items.some((i) => i.label);
    const hEach = (cellH * rows) / items.length;
    return {
      rowSpan: rows, margin: [0, 0, 0, 0],
      table: { widths: hasLabel ? [lw, '*'] : ['*'], heights: items.map(() => hEach), body: items.map((i) => (hasLabel ? [{ text: i.label || ' ', fontSize: 8, alignment: 'center', margin: [1, 1, 1, 1] }, styleCell(i.text)] : [styleCell(i.text)])) },
      layout: { hLineWidth: (i: number) => (i === 0 ? 0 : 0.5), vLineWidth: (i: number) => (i === 0 ? 0 : 0.5), hLineColor: () => b.borderColor, vLineColor: () => b.borderColor, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    };
  };
  const overflow: string[] = [];
  b.lines.forEach((l, ri) => {
    const text = fillTokens(l.text, c.vars, c.rowVars);
    const cs = [...text];
    if (cs.length > n) overflow.push(`แถว ${ri + 1}: ${cs.length} ตัวอักษร (เกิน ${n} ช่อง)`);
    const first = ri === 0;
    body.push([
      ...b.left.map((x) => (first ? { ...stack(x), alignment: x.header === 'ลำดับ' || x.header === 'ไลน์' ? 'center' : 'left' } : span(x, 1))),
      ...Array.from({ length: n }, (_v, i) => ({ text: cs[i] ?? ' ', fontSize: fs, bold: true, alignment: 'center', margin: [0, Math.max(0, (cellH - fs * 1.2) / 2 - 1), 0, 0] })),
      ...b.right.map((x) => (first ? stack(x) : span(x, 1))),
    ]);
  });

  const node: any = {
    table: { widths: [...b.left.map(w), ...Array.from({ length: n }, () => cw), ...b.right.map(w)], body, dontBreakRows: true, heights: (row: number) => (row < (b.showIndex ? 2 : 1) ? undefined : cellH), keepWithHeaderRows: 0 },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => b.borderColor, vLineColor: () => b.borderColor, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    unbreakable: true,
  };
  void NO_BORDER;
  const out: any[] = [node];
  if (overflow.length) out.push({ text: `⚠ ${overflow.join(' · ')}`, color: '#DC2626', fontSize: 8, margin: [0, 2, 0, 0] });
  return { stack: out, margin: [pt(b.marginLeft ?? 0), pt(b.marginTop ?? 0), pt(b.marginRight ?? 0), pt(b.marginBottom ?? 0)] };
}
