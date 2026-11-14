/**
 * What the QR Code of an ink-code notice contains. Same rules as the plant's QR tool (repo QR_Code_Ink_Code_HUB, "Generate QR Code.html"):
 *
 *   can    23 characters per line, every line padded with spaces to 23, lines joined, trailing spaces cut
 *   pouch  40 characters per line, every line padded with spaces to 40, lines joined, trailing spaces cut   (Pouch, Spout, Jerky … = anything else)
 *   cup    each line keeps only its real data (trailing spaces cut, at most 40 characters), "HH:MM" / "HHMM" left out, lines joined directly
 *   sachet like cup, but the lines are separated by a new line (CR+LF) — only for Pouch Sachet
 *
 * "HH:MM" / "HHMM" are placeholders for the time that the ink printer fills in by itself; they stay in the position grid of the
 * notice, never in the QR. Pure functions (no imports) so they can be tested with node alone.
 */
export type QrKind = 'can' | 'pouch' | 'cup' | 'sachet';

export interface QrRule {
  kind: QrKind;
  label: string;
  /** characters per line (a line longer than this is cut) */
  chars: number;
  /** pad every line with spaces up to `chars` */
  pad: boolean;
  /** leave the time placeholders "HH:MM" / "HHMM" out of the QR */
  dropTime: boolean;
  /** text put between the lines */
  sep: string;
}

export const QR_RULES: Record<QrKind, QrRule> = {
  can: { kind: 'can', label: 'Can', chars: 23, pad: true, dropTime: false, sep: '' },
  pouch: { kind: 'pouch', label: 'Pouch / อื่นๆ', chars: 40, pad: true, dropTime: false, sep: '' },
  cup: { kind: 'cup', label: 'Cup', chars: 40, pad: false, dropTime: true, sep: '' },
  // CR+LF: a bare LF is swallowed by the keyboard-wedge scanners of the plant, so the lines ran together
  sachet: { kind: 'sachet', label: 'Pouch Sachet', chars: 40, pad: false, dropTime: true, sep: '\r\n' },
};

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Package type of a notice: the PKG column of the master database first ("Can", "CUP", "Sachet" …), and only when that is empty the
 * name of the production line ("Cup 3", "Can R", "Sachet"). Spout / Jerky / Pouch / anything else is a plain pouch.
 */
export function qrKindOf(pkg: unknown, line: unknown = ''): QrKind {
  const p = norm(pkg);
  if (p) {
    if (p === 'can') return 'can';
    if (p === 'cup') return 'cup';
    if (p === 'sachet' || p === 'pouch sachet') return 'sachet';
    return 'pouch';
  }
  const l = norm(line);
  if (/^can\b/.test(l)) return 'can';
  if (/^cup\b/.test(l)) return 'cup';
  if (/^sachet\b/.test(l)) return 'sachet';
  return 'pouch';
}

const stripEnd = (s: string) => s.replace(/\s+$/, '');
const stripTime = (s: string) => s.split('HH:MM').join('').split('HHMM').join('');

/** The text of the QR Code from the code lines (the note lines are already empty strings) */
export function qrPayload(lines: string[], kind: QrKind | QrRule, override?: { chars?: number }): string {
  const rule = typeof kind === 'string' ? QR_RULES[kind] : kind;
  const chars = override?.chars ?? rule.chars;
  const rows = lines.map((l) => {
    const cs = [...(rule.dropTime ? stripTime(l) : l)];
    const cut = cs.slice(0, chars).join('');
    return rule.pad ? cut + ' '.repeat(Math.max(0, chars - cs.length)) : stripEnd(cut);
  });
  return stripEnd(rows.join(rule.sep));
}
