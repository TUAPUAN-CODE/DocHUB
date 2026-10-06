/**
 * One box of a character grid. Printed ink codes mix the letter "O" and the digit "0", which look the same in most fonts, so a zero
 * is drawn with a diagonal bar and a light grey background and is never mistaken for the letter.
 */
export const ZERO_BG = '#E5E7EB';

export function charCell(ch: string, fs: number, cw: number, cellH: number, topPad: number): Record<string, unknown> {
  const base = { text: ch || ' ', fontSize: fs, bold: true, alignment: 'center' };
  if (ch !== '0') return { ...base, margin: [0, topPad, 0, 0] };
  // digit box inside the cell (Sarabun / Prompt / Kanit digits are ≈0.58 em wide and ≈0.7 em tall); the bar overshoots it a little
  const gw = Math.min(cw * 0.78, fs * 0.62), gh = fs * 0.78;
  const x0 = (cw - gw) / 2, y0 = Math.max(0, topPad + fs * 0.22);
  const bar = { type: 'line', x1: x0, y1: y0 + gh, x2: x0 + gw, y2: y0, lineWidth: Math.max(0.5, fs * 0.07), lineColor: '#111827' };
  return {
    fillColor: ZERO_BG,
    stack: [{ canvas: [bar], margin: [0, 0, 0, 0] }, { ...base, margin: [0, topPad - (y0 + gh), 0, 0] }],
  };
}
