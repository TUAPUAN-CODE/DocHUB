import type { DelayLine } from './lines';

/**
 * Plant of each production line (given by the factory). The Delay report F3PFPF67 / F3PFPV04 made by the AI needs no questions:
 * Plant comes from the line, Shift from the time packing was done. Lines are compared without spaces / capitals ("Cup 14" = "Cup14").
 */
const TABLE = `Cup1 PF1|Cup2 PF1|Cup3 PF1|Cup4 PF1|Cup5 PF1|Cup6 PF2|Cup7 PF2|Cup9 PF1|Can F PF1|Can K PF1|Can P PF2|Can R PF2|Can T PF2|Can U PF2|Can Y PF2|Can Z PF2|Pouch PF2 PF2|Pouch Sachet PF1|Pouch Spout 1 PF1|Cup10 PF1|Cup11 PF1|Cup12 PF1|Cup13 PF1|Can B PF1|Can C PF1|Can D PF1|Can E PF1|Can H PF1|Can J PF1|Cup8 PF1|Pouch PF1 PF1|Auto C PF1|Auto D PF1|Auto A PF2|Auto B PF1|Auto E PF2|Pouch VS PF1|Auto F PF2|FD FD|Cup 14 PF1|Pouch Spout 2 PF1|Pouch Spout 3 PF1|Big Spout PF1|Auto B+C PF1|Auto C+D PF1|Pouch Jerky Jerky`;
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
export const LINE_PLANT: Map<string, string> = new Map(TABLE.split('|').map((x) => { const i = x.lastIndexOf(' '); return [norm(x.slice(0, i)), x.slice(i + 1)] as [string, string]; }));

/** "PF1" / "PF2" / "FD" / "Jerky" — '' when the line is not in the table */
export const plantOf = (line: unknown): string => LINE_PLANT.get(norm(line)) ?? '';

/** Shift by the time packing was done: 06:00 – 17:30 = DS · 17:31 – 05:59 = NS (a time is read to the minute) */
export const shiftOfPacked = (t: string | null | undefined): 'DS' | 'NS' | '' => {
  const m = /(\d{2}):(\d{2})/.exec(String(t ?? ''));
  if (!m) return '';
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min >= 360 && min <= 17 * 60 + 30 ? 'DS' : 'NS';
};

/** Factory day (yyyy-mm-dd) of the packed time: the night shift after midnight (00:00 – 05:59) belongs to the day before */
export const workDayOfPacked = (t: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(t ?? ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - (Number(m[4]) * 60 + Number(m[5]) < 360 ? 1 : 0)));
  return d.toISOString().slice(0, 10);
};

export interface DelayGroup { day: string; shift: 'DS' | 'NS' | ''; plant: string; line: string; rows: DelayLine[] }

/**
 * Lines of the report → one block per factory day × shift × plant (× line when `split` = "line"), oldest day first, DS before NS, then plant.
 * Each block has its own pages and its own Date / Shift / Line / Plant. Rows without a packed time are kept (shift / day empty) at the end.
 */
export function groupDelayLines(lines: DelayLine[], split: 'plant' | 'line' = 'plant'): DelayGroup[] {
  const map = new Map<string, DelayGroup & { names: Set<string> }>();
  for (const l of lines) {
    const day = workDayOfPacked(l.time_f), shift = shiftOfPacked(l.time_f), plant = plantOf(l.line);
    const key = `${day}|${shift}|${plant}|${split === 'line' ? String(l.line ?? '') : ''}`;
    let g = map.get(key);
    if (!g) { g = { day, shift, plant, line: '', rows: [], names: new Set() }; map.set(key, g); }
    g.rows.push(l); if (l.line) g.names.add(String(l.line));
  }
  const rank = (x: string) => (x === 'DS' ? 0 : x === 'NS' ? 1 : 2);
  return [...map.values()]
    .map(({ names, ...g }) => {
      const list = [...names].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
      // the header has room for a short text: a few lines are listed, more are counted
      const line = list.length <= 3 ? list.join(', ') : `${list.length} ไลน์`;
      return { ...g, line };
    })
    .sort((a, b) => (a.day || '9999').localeCompare(b.day || '9999') || rank(a.shift) - rank(b.shift) || a.plant.localeCompare(b.plant) || a.line.localeCompare(b.line, 'th', { numeric: true }));
}
