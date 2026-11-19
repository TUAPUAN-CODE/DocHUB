import type { ColumnFilter, Widget } from '@/types';

/** today's date in Thailand (yyyy-mm-dd), whatever time zone this computer is set to */
export const todayTh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

/**
 * What a dashboard starts with: every date filter (slicer in "date" mode) set to today, so opening the dashboard reads only today's rows
 * instead of the whole history. A slicer opts out with `config.defaultToday = false` (property panel: "เปิดมาแล้วตั้งเป็นวันนี้").
 */
export function todaySlicers(widgets: Widget[], today = todayTh()): Record<string, ColumnFilter | null> {
  const out: Record<string, ColumnFilter | null> = {};
  for (const w of widgets) {
    if (w.type !== 'slicer' || w.style?.hidden || w.config?.mode !== 'date' || w.config?.defaultToday === false || !w.dataSource?.xColumnId) continue;
    out[w.id] = { columnId: w.dataSource.xColumnId, op: 'between', value: today, value2: today } as ColumnFilter;
  }
  return out;
}
