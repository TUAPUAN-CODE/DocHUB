import { ZERO_FONT } from '../fonts';

/**
 * One box of a character grid. Printed ink codes mix the letter "O" and the digit "0", which look the same in most fonts, so a zero
 * is printed with the font ZERO_FONT (Sarabun Bold's own "0" with a diagonal bar inside the oval — never past its outline) on a light
 * grey background, and is never mistaken for the letter.
 */
export const ZERO_BG = '#E5E7EB';

export function charCell(ch: string, fs: number, _cw: number, _cellH: number, topPad: number): Record<string, unknown> {
  const base = { text: ch || ' ', fontSize: fs, bold: true, alignment: 'center', margin: [0, topPad, 0, 0] };
  return ch === '0' ? { ...base, font: ZERO_FONT, fillColor: ZERO_BG } : base;
}
