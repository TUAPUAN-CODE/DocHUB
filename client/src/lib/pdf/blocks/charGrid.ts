import { charCell } from './charCell';
import { fillTokens } from '../variables';
import type { BuildCtx } from '../build';
import { MM } from '../types';
import type { BlockBase } from '../types';

/**
 * Character grid: every character of a line in its own box — the "ตำแหน่ง 1…40" table of the ink-print notice.
 * Each line is text with {{tokens}} (e.g. {{Code Format แถว 1}}), so one row of data fills the grid.
 */
export interface CharGridLine { id: string; text: string; label: string }
export interface CharGridBlock extends BlockBase {
  type: 'charGrid';
  lines: CharGridLine[];
  /** number of boxes per line (positions) */
  cells: number;
  /** box height (mm) */
  cellHeightMm: number;
  fontSize: number;
  borderColor: string;
  showIndex: boolean;
  /** column on the left with the line label (e.g. "แถว 1") */
  showLabels: boolean;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'g' + Math.random().toString(36).slice(2));
export const newCharGridLine = (n = 1): CharGridLine => ({ id: uid(), label: `แถว ${n}`, text: '' });
export const newCharGrid = (): CharGridBlock => ({
  id: uid(), type: 'charGrid', cells: 40, cellHeightMm: 6, fontSize: 10, borderColor: '#374151', showIndex: true, showLabels: false, marginBottom: 3,
  lines: [newCharGridLine(1), newCharGridLine(2), newCharGridLine(3), newCharGridLine(4)],
});

const pt = (mm: number) => mm * MM;
const chars = (s: string) => [...s];

export function buildCharGrid(b: CharGridBlock, c: BuildCtx) {
  const n = Math.max(1, Math.min(120, Math.floor(b.cells || 40)));
  const labelW = b.showLabels ? pt(14) : 0;
  const room = c.contentWidth - pt(b.marginLeft ?? 0) - pt(b.marginRight ?? 0) - labelW;
  const cw = room / n;
  const line = { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => b.borderColor, vLineColor: () => b.borderColor, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 1, paddingBottom: () => 1 };
  const body: any[][] = [];
  const lead = (v: string, o: object = {}) => (b.showLabels ? [{ text: v, fontSize: 8, color: '#6B7280', alignment: 'right', border: [false, false, false, false], margin: [0, 2, 3, 0], ...o }] : []);
  if (b.showIndex) body.push([...lead(''), ...Array.from({ length: n }, (_v, i) => ({ text: String(i + 1), fontSize: Math.min(7, cw / 2.2), alignment: 'center', color: '#6B7280' }))]);
  const overflow: string[] = [];
  for (const l of b.lines) {
    const text = fillTokens(l.text, c.vars, c.rowVars);
    const cs = chars(text);
    if (cs.length > n) overflow.push(`${l.label}: ${cs.length} ตัวอักษร (เกิน ${n} ช่อง)`);
    body.push([...lead(l.label), ...Array.from({ length: n }, (_v, i) => charCell(cs[i] ?? ' ', Math.min(b.fontSize, cw * 0.9), cw, pt(b.cellHeightMm), Math.max(0, (pt(b.cellHeightMm) - b.fontSize * 1.2) / 2 - 1)))]);
  }
  const node: any = {
    table: { widths: [...(b.showLabels ? [labelW] : []), ...Array.from({ length: n }, () => cw)], body, heights: (row: number) => (b.showIndex && row === 0 ? undefined : pt(b.cellHeightMm)) },
    layout: line,
  };
  const stack: any[] = [node];
  if (overflow.length) stack.push({ text: `⚠ ${overflow.join(' · ')}`, color: '#DC2626', fontSize: 8, margin: [0, 2, 0, 0] });
  return { stack, margin: [pt(b.marginLeft ?? 0), pt(b.marginTop ?? 0), pt(b.marginRight ?? 0), pt(b.marginBottom ?? 0)] };
}
