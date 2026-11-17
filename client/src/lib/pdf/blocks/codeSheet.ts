import qrEncModule from 'pdfmake/js/qrEnc.js';
import { fillTokens } from '../variables';
import type { BuildCtx } from '../build';
import { MM } from '../types';
import { charCell } from './charCell';
import { qrKindOf, qrPayload } from './qrPayload';
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
  /**
   * QR payload by package type, the same rules as the QR tool of the plant (see qrPayload.ts):
   * Can = 23 characters per line padded · Pouch / other = 40 padded · Cup = real data only (no padding, no HH:MM / HHMM) ·
   * Pouch Sachet = like Cup with a new line between the lines.
   */
  qrCanChars?: number;
  qrOtherChars?: number;
  /** text that tells the package type (default {{PKG}}: Can / Cup / Sachet / anything else = Pouch) */
  qrCanText?: string;
  /** used for the type only when qrCanText is empty: the production line (default {{ไลน์}}: "Cup 3", "Can R", "Sachet") */
  qrLineText?: string;
  /** QR size (mm). Empty = as large as the cell allows. A larger size makes the code rows taller / the QR column wider to fit it */
  qrSizeMm?: number | null;
  /** white space kept around the QR inside its cell (mm, default 0.8) */
  qrPadMm?: number;
  /** a code line that is a note (starts with "New Code", or has Thai letters) is not inked: it leaves the grid and the QR and is
   *  printed in a small "หมายเหตุ (ไม่ Ink)" box under the grid. Default on. */
  remarkRule?: boolean;
  /** text of the remark box besides those lines (default {{Remark (ไม่ Ink)}} — the column of the InkCode master database) */
  remarkText?: string;
}

/**
 * A code line that is a note, not something to ink: it starts with "New Code" (any case) or has a Thai letter. Real ink codes
 * have no Thai letters (checked on all 5,144 code lines of the master database: English, digits, symbols, Chinese). The whole line
 * is moved, never part of it. Same rule as isInkRemark in server/src/modules/inkcode/model.ts.
 */
export const isInkRemark = (line: string) => /^\s*new\s+code\b/i.test(line) || /[\u0E00-\u0E7F]/.test(line);
export const REMARK_TEXT = '{{Remark (ไม่ Ink)}}';

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

/**
 * A QR Code drawn at exactly `sizePt` points. pdfmake's own {qr, fit} rounds the module size DOWN to a whole number of points
 * (a 20 mm code can come out as 13 mm, a 10 mm code as nothing), so the code is built from pdfmake's module matrix and scaled
 * here; runs of dark modules in a row are merged and rects overlap a hair so no seams show.
 */
export function qrCanvas(payload: string, sizePt: number) {
  const enc: any = (qrEncModule as any).default ?? qrEncModule;
  const node = enc.measure({ qr: payload, eccLevel: 'L' });
  const base: number = node._width;
  const f = sizePt / base;
  const cells = (node._canvas as { x: number; y: number; w: number; h: number }[]).slice(1);   // [0] is the white background
  const rows = new Map<number, { x: number; w: number; h: number }[]>();
  for (const r of cells) {
    const list = rows.get(r.y) ?? [];
    const last = list[list.length - 1];
    if (last && Math.abs(last.x + last.w - r.x) < 0.01) last.w += r.w; else list.push({ x: r.x, w: r.w, h: r.h });
    rows.set(r.y, list);
  }
  const rects: any[] = [{ type: 'rect', x: 0, y: 0, w: sizePt, h: sizePt, lineWidth: 0, color: '#FFFFFF' }];
  for (const [y, list] of rows) for (const r of list) rects.push({ type: 'rect', x: r.x * f, y: y * f, w: r.w * f + 0.12, h: r.h * f + 0.12, lineWidth: 0, color: '#000000' });
  return { canvas: rects, width: sizePt, height: sizePt };
}
const NO_BORDER = [false, false, false, false];

export { qrPayload, qrKindOf, QR_RULES } from './qrPayload';
export type { QrKind } from './qrPayload';

export function buildCodeSheet(b: CodeSheetBlock, c: BuildCtx) {
  const nMax = Math.max(5, Math.min(80, Math.floor(b.cells || 40)));
  const rows = Math.max(1, b.lines.length);
  const raw = b.lines.map((l) => fillTokens(l.text, c.vars, c.rowVars));
  const ruleOn = b.remarkRule !== false;
  // a note line leaves its place empty (the other lines keep their row numbers) and goes to the remark box
  const texts = raw.map((t) => (ruleOn && isInkRemark(t) ? '' : t));
  const remarks = [...new Set([
    ...fillTokens(b.remarkText ?? REMARK_TEXT, c.vars, c.rowVars).split(/\r?\n/),
    ...(ruleOn ? raw.filter(isInkRemark) : []),
  ].map((x) => x.trim()).filter(Boolean))];
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
  // freed width goes to the text columns; the QR column keeps its own width (a QR does not grow, white space around it would only appear)
  const qrTotal = side.filter((x) => x.qr).reduce((s2, x) => s2 + pt(widthMm(x)) * k, 0);
  const flexTotal = Math.max(1, sideTotal - side.filter((x) => x.qr).reduce((s2, x) => s2 + pt(widthMm(x)), 0));
  const k2 = Math.min(2.2, (room - cw * n - qrTotal) / flexTotal);
  const w = (x: SheetSideCol) => pt(widthMm(x)) * (x.qr ? k : k2);
  const fs = Math.min(b.fontSize, cw * 0.95 / 0.6);
  // a wanted QR size also sets the minimum height of the code rows
  const cellH = Math.max(pt(b.cellHeightMm), qrWant ? pt(qrWant + 2 * qrPad) / rows : 0);
  const head = (text: string, extra: object = {}) => ({ text, bold: true, fontSize: Math.min(9, b.fontSize), alignment: 'center', fillColor: b.headerBg, margin: [0, 2, 0, 2], ...extra });
  const span = (_col: SheetSideCol, rowSpan: number) => ({ text: '', rowSpan });
  // QR rule by package type (Can / Pouch / Cup / Pouch Sachet) — the PKG of the product, else the name of the line
  const kind = qrKindOf(fillTokens(b.qrCanText ?? '{{PKG}}', c.vars, c.rowVars), fillTokens(b.qrLineText ?? '{{ไลน์}}', c.vars, c.rowVars));
  const payload = qrPayload(texts, kind, { chars: kind === 'can' ? (b.qrCanChars ?? 23) : (b.qrOtherChars ?? 40) });

  const body: any[][] = [];
  const r1: any[] = [...b.left.map((x) => head(x.header, { rowSpan: b.showIndex ? 2 : 1 })), head(b.gridHeader, { colSpan: n, fontSize: 9 }), ...Array.from({ length: n - 1 }, () => ({})), ...b.right.map((x) => head(x.header, { rowSpan: b.showIndex ? 2 : 1 }))];
  body.push(r1);
  if (b.showIndex) body.push([...b.left.map(() => ({})), ...Array.from({ length: n }, (_v, i) => ({ text: String(i + 1), fontSize: Math.min(6.5, cw / 2.2), alignment: 'center', color: '#374151', margin: [0, 0.5, 0, 0.5] })), ...b.right.map(() => ({}))]);

  const styleCell = (text: string) => ({ text: text || ' ', fontSize: Math.min(b.fontSize, 9.5), margin: [2, 1, 2, 1] });
  const stack = (col: SheetSideCol) => {
    if (col.qr) {
      if (!payload) return { text: ' ', rowSpan: rows };
      const room2 = Math.min(w(col) - pt(2 * qrPad), cellH * rows - pt(2 * qrPad));
      const fit = Math.max(8, qrWant ? Math.min(pt(qrWant), room2) : room2);
      const q = qrCanvas(payload, fit);
      return { rowSpan: rows, stack: [{ canvas: q.canvas, margin: [Math.max(0, (w(col) - fit) / 2), Math.max(0, (cellH * rows - fit) / 2), 0, 0] }] };
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
      ...Array.from({ length: n }, (_v, i) => charCell(cs[i] ?? ' ', fs, cw, cellH, Math.max(0, (cellH - fs * 1.2) / 2 - 1))),
      ...b.right.map((x) => (first ? stack(x) : span(x, 1))),
    ]);
  });

  const node: any = {
    table: { widths: [...b.left.map(w), ...Array.from({ length: n }, () => cw), ...b.right.map(w)], body, dontBreakRows: true, heights: (row: number) => (row < (b.showIndex ? 2 : 1) ? undefined : cellH), keepWithHeaderRows: 0 },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => b.borderColor, vLineColor: () => b.borderColor, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    unbreakable: true,
  };
  const out: any[] = [node];
  if (remarks.length) {
    // under the position grid, as wide as the grid: the staff still see "New Code … ตรวจ 100%" but nobody inks it
    const leftW = b.left.reduce((s2, x) => s2 + w(x), 0);
    out.push({
      margin: [leftW, 1, 0, 0],
      table: { widths: [Math.min(room - leftW, Math.max(cw * n, pt(90)))], body: [[{ text: [{ text: 'หมายเหตุ (ไม่ Ink): ', bold: true }, remarks.join(' · ')], fontSize: Math.min(8, b.fontSize), color: '#374151', fillColor: '#FFFBEB', margin: [2, 1, 2, 1] }]] },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#D97706', vLineColor: () => '#D97706' },
    });
  }
  if (overflow.length) out.push({ text: `⚠ ${overflow.join(' · ')}`, color: '#DC2626', fontSize: 8, margin: [0, 2, 0, 0] });
  return { stack: out, unbreakable: remarks.length > 0, margin: [pt(b.marginLeft ?? 0), pt(b.marginTop ?? 0), pt(b.marginRight ?? 0), pt(b.marginBottom ?? 0)] };
}
