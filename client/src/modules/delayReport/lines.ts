import type { Column, Row } from '@/types';

/**
 * "รายงาน Delay F3PFPF67" (DelayHUB's Delay report, copied every day by the connector set up in server/src/modules/delayReport): a sheet is one
 * when it has these columns. Its rows become the lines of the PDF F3PFPF67 / Excel F3PFPV04 exactly as DelayHUB prints them.
 * Column names = server/src/modules/delayReport/columns.ts (keep in step).
 */
const FIELDS: Record<string, string> = {
  mapping_id: 'mapping_id', 'วันที่': 'work_day', 'กะ': 'shift', 'ไลน์': 'line', Code: 'code', 'โค้ด (Product Code)': 'production',
  'วัตถุดิบ (Raw Mat.)': 'mat_name', Batch: 'batch', 'น้ำหนัก (kgs.)': 'weight', 'ชุดที่': 'group_no', 'วันที่-เวลาเตรียม': 'prep_date',
  'Hist./Viscosity/Temp': 'hist', 'สี': 'color', 'กลิ่น': 'odor', 'เนื้อสัมผัส': 'texture',
  'เตรียมเสร็จ (A)': 'time_a', 'เข้าห้องเย็น 1 (B)': 'time_b', 'ออกห้องเย็น 1 (C)': 'time_c', 'เข้าห้องเย็น 2 (D)': 'time_d', 'ออกห้องเย็น 2 (E)': 'time_e', 'บรรจุเสร็จ (F)': 'time_f',
  'ช่วงที่ 1': 'dbs1', 'ช่วงที่ 2': 'dbs2', 'ช่วงที่ 3': 'dbs3', 'ช่วงที่ 4': 'dbs4',
  'ช่วงที่ 1 (ชม.)': 'dbs1_h', 'ช่วงที่ 2 (ชม.)': 'dbs2_h', 'ช่วงที่ 3 (ชม.)': 'dbs3_h', 'ช่วงที่ 4 (ชม.)': 'dbs4_h',
  'เกินมาตรฐานช่วงที่ 1': 'over1', 'เกินมาตรฐานช่วงที่ 2': 'over2', 'เกินมาตรฐานช่วงที่ 3': 'over3', 'เกินมาตรฐานช่วงที่ 4': 'over4',
  'กลุ่มพิเศษ': 'special', 'หมายเหตุ (Remark)': 'remark',
};
const DATETIME = new Set(['prep_date', 'time_a', 'time_b', 'time_c', 'time_d', 'time_e', 'time_f']);

export type DelayLine = Record<string, any> & { production?: string; mat_name?: string; time_f?: string | null; line?: string; code?: string };

/** the sheet is a Delay report when it has the key, the packed time and the periods */
export const isDelaySheet = (columns: Pick<Column, 'name'>[]) => ['mapping_id', 'บรรจุเสร็จ (F)', 'ช่วงที่ 1', 'เตรียมเสร็จ (A)'].every((n) => columns.some((c) => c.name === n));

/** stored date-time (ISO, UTC) → "yyyy-mm-dd HH:mm:ss" in Thai time (the wall clock DelayHUB printed), whatever the viewer's computer is set to */
const TH = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export const wall = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(TH.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

export function toDelayLines(rows: Row[], columns: Pick<Column, 'id' | 'name'>[]): DelayLine[] {
  const map = columns.filter((c) => FIELDS[c.name]).map((c) => [c.id, FIELDS[c.name]] as const);
  return rows.map((r) => {
    const o: DelayLine = {};
    for (const [id, f] of map) { const v = (r.values as Record<string, unknown>)[id]; o[f] = DATETIME.has(f) ? wall(v) : v ?? null; }
    return o;
  });
}

const ms = (v: unknown) => { const d = v ? new Date(String(v).replace(' ', 'T')) : null; return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0; };
export const sortLines = (lines: DelayLine[], by: 'time' | 'code') => [...lines].sort((a, b) => (by === 'code'
  ? String(a.code ?? '').localeCompare(String(b.code ?? ''), 'th', { numeric: true }) || ms(a.time_f) - ms(b.time_f)
  : ms(a.time_f) - ms(b.time_f)));
