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
export interface SheetSideCol {
  id: string; header: string; widthMm: number; items: SheetSideItem[];
  /** this column holds a QR Code made from the code lines (see CodeSheetBlock.qr*) */
  qr?: boolean;
}
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
  /** hide the boxes to the right of the longest code line (the table keeps its width: the other columns widen) */
  autoCells?: boolean;
  minCells?: number;
  /** QR payload = the 4 lines, each padded/cut to N characters, joined, trailing spaces removed (same as the QR tool of the plant) */
  qrCanChars?: number;
  qrOtherChars?: number;
  /** text that is "can" for a Can package (e.g. {{PKG}}) → qrCanChars per line, anything else → qrOtherChars */
  qrCanText?: string;
  /** QR size (mm). Empty = as large as the cell allows. A larger size makes the code rows taller / the QR column wider to fit it */
  qrSizeMm?: number | null;
  /** white space kept around the QR inside its cell (mm, default 0.8) */
  qrPadMm?: number;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'c' + Math.random().toString(36).slice(2));
export const newSideItem = (text = '', label = ''): SheetSideItem => ({ id: uid(), label, text });
export const newSideCol = (header = 'หัวคอลัมน์', widthMm = 25, items: SheetSideItem[] = [newSideItem()]): SheetSideCol => ({ id: uid(), header, widthMm, items });
export const newCodeSheet = (): CodeSheetBlock => ({
  id: uid(), type: 'codeSheet', cells: 40, cellHeightMm: 5.5, fontSize: 9, headerBg: '#DCEAF7', borderColor: '#374151', showIndex: true, gridHeader: 'ตำแหน่ง', marginBottom: 2, autoCells: true, minCells: 12, qrCanChars: 23, qrOtherChars: 40, qrCanText: '{{PKG}}',
  left: [newSideCol('ไลน์', 14, [newSideItem('{{ไลน์}}')]), newSideCol('ลำดับ', 12, [newSideItem('{{#}}')]), newSideCol('ลูกค้า', 30, [newSideItem('{{ลูกค้า}}')]), newSideCol('ชนิด', 24, [newSideItem('{{ชนิด}}')])],
  right: [
    newSideCol('Mat. Packaging', 42, [newSideItem('{{Material Packaging 1}}'), newSideItem('{{Material Packaging 2}}'), newSideItem('{{Material Packaging 3}}')]),
    newSideCol('Code', 44, [newSideItem('{{PO}}', 'PO'), newSideItem('{{Code ฝน}}', 'New code'), newSideItem('{{Product Code SAP}}', 'Code Sap')]),
    newSideCol('รหัสเอกสารสูตรการผลิต', 24, [newSideItem('{{รหัสเอกสาร}}')]),
    newSideCol('รหัสเอกสารระบบ Code', 28, [newSideItem('{{รหัสเอกสารระบบ Code}}/{{Rev.}}')]),
    { ...newSideCol('QR Code', 26, [newSideItem('')]), qr: true },
  ],
  lines: [1, 2, 3, 4].map((n) => ({ id: uid(), text: `{{Code Format แถว ${n}}}` })),
});

const pt = (mm: number) => mm * MM;
const NO_BORDER = [false, false, false, false];

/** What the QR Code of a notice contains: 4 lines × N characters (N = 23 for a Can, 40 otherwise), joined, trailing spaces cut */
export function qrPayload(lines: string[], charsPerRow: number): string {
  return lines.map((l) => { const cs = [...l]; return cs.length >= charsPerRow ? cs.slice(0, charsPerRow).join('') : l + ' '.repeat(charsPerRow - cs.length); }).join('').replace(/\s+$/, '');
}

export function buildCodeSheet(b: CodeSheetBlock, c: BuildCtx) {
  const nMax = Math.max(5, Math.min(80, Math.floor(b.cells || 40)));
  const rows = Math.max(1, b.lines.length);
  const texts = b.lines.map((l) => fillTokens(l.text, c.vars, c.rowVars));
  const used = Math.max(1, ...texts.map((t) => [...t.replace(/\s+$/, '')].length));
  const n = b.autoCells === false ? nMax : Math.max(Math.min(nMax, b.minCells ?? 12), Math.min(nMax, used));
  const qrPad = Math.max(0, b.qrPadMm ?? 0.8);
  const qrWant = b.qrSizeMm && b.qrSizeMm > 0 ? b.qrSizeMm : 0;
  const widthMm = (x: SheetSideCol) => (x.qr && qrWant ? Math.max(x.widthMm, qrWant + 2 * qrPad) : x.widthMm);
  const side = [...b.left, ...b.right];
  const sideTotal = side.reduce((s, x) => s + pt(widthMm(x)), 0);
  const room = c.contentWidth - pt(b.marginLeft ?? 0) - pt(b.marginRight ?? 0);
  // box width is what a full row of boxes would get; hidden boxes free their width for the other columns
  const minCell = pt(2.8);
  let k = 1;
  if (room - sideTotal < minCell * nMax) k = Math.max(0.4, (room - minCell * nMax) / sideTotal);
  const cw = (room - sideTotal * k) / nMax;
  const k2 = Math.min(2.2, (room - cw * n) / sideTotal);
  const w = (x: SheetSideCol) => pt(widthMm(x)) * k2;
  const fs = Math.min(b.fontSize, cw * 0.95 / 0.6);
  // a wanted QR size also sets the minimum height of the code rows
  const cellH = Math.max(pt(b.cellHeightMm), qrWant ? pt(qrWant + 2 * qrPad) / rows : 0);
  const head = (text: string, extra: object = {}) => ({ text, bold: true, fontSize: Math.min(9, b.fontSize), alignment: 'center', fillColor: b.headerBg, margin: [0, 2, 0, 2], ...extra });
  const span = (_col: SheetSideCol, rowSpan: number) => ({ text: '', rowSpan });
  const isCan = fillTokens(b.qrCanText ?? '{{PKG}}', c.vars, c.rowVars).trim().toLowerCase() === 'can';
  const payload = qrPayload(texts, isCan ? (b.qrCanChars ?? 23) : (b.qrOtherChars ?? 40));

  const body: any[][] = [];
  const r1: any[] = [...b.left.map((x) => head(x.header, { rowSpan: b.showIndex ? 2 : 1 })), head(b.gridHeader, { colSpan: n, fontSize: 9 }), ...Array.from({ length: n - 1 }, () => ({})), ...b.right.map((x) => head(x.header, { rowSpan: b.showIndex ? 2 : 1 }))];
  body.push(r1);
  if (b.showIndex) body.push([...b.left.map(() => ({})), ...Array.from({ length: n }, (_v, i) => ({ text: String(i + 1), fontSize: Math.min(6.5, cw / 2.2), alignment: 'center', color: '#374151', margin: [0, 0.5, 0, 0.5] })), ...b.right.map(() => ({}))]);

  const styleCell = (text: string) => ({ text: text || ' ', fontSize: Math.min(b.fontSize, 9.5), margin: [2, 1, 2, 1] });
  const stack = (col: SheetSideCol) => {
    if (col.qr) {
      if (!payload) return { text: ' ', rowSpan: rows };
      const room2 = Math.min(w(col) - pt(2 * qrPad), cellH * rows - pt(2 * qrPad));
      const fit = Math.max(20, qrWant ? Math.min(pt(qrWant), room2) : room2);
      return { rowSpan: rows, stack: [{ qr: payload, fit, eccLevel: 'L', alignment: 'center', margin: [0, (cellH * rows - fit) / 2, 0, 0] }] };
    }
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
  texts.forEach((text, ri) => {
    const cs = [...text];
    if (cs.length > nMax) overflow.push(`แถว ${ri + 1}: ${cs.length} ตัวอักษร (เกิน ${nMax} ช่อง)`);
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
  const out: any[] = [node];
  if (overflow.length) out.push({ text: `⚠ ${overflow.join(' · ')}`, color: '#DC2626', fontSize: 8, margin: [0, 2, 0, 0] });
  return { stack: out, margin: [pt(b.marginLeft ?? 0), pt(b.marginTop ?? 0), pt(b.marginRight ?? 0), pt(b.marginBottom ?? 0)] };
}
