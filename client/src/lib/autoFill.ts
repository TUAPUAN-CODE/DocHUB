import type { CellValue, Column } from '@/types';
import { todayTh } from './today';

const bangkok = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { h: Number(p.hour), m: Number(p.minute) };
};

/**
 * Value a new row's form starts with for a column marked `validation.autoFill` (null when the column has no such setting):
 * today = today's date · now = the time (HH.mm for text columns, a date-time for date-time columns) · shift = the select option for the shift
 * of the time now (06:00 – 17:30 day = a value starting with D, otherwise night = N, e.g. D/S · N/S). Thai time, whatever the computer's zone.
 */
export function autoFillValue(col: Pick<Column, 'dataType' | 'validation' | 'options'>): CellValue {
  const k = col.validation?.autoFill;
  if (!k) return null;
  const { h, m } = bangkok();
  if (k === 'today') return col.dataType === 'date' ? todayTh() : null;
  if (k === 'now') {
    if (col.dataType === 'datetime') return new Date().toISOString();
    return col.dataType === 'varchar' ? `${String(h).padStart(2, '0')}.${String(m).padStart(2, '0')}` : null;
  }
  if (col.dataType !== 'select') return null;
  const min = h * 60 + m, day = min >= 360 && min <= 17 * 60 + 30;
  const opt = (col.options ?? []).find((o) => (day ? /^d/i : /^n/i).test(o.value));
  return opt ? opt.value : null;
}
