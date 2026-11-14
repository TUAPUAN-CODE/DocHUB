import { createContext, useContext } from 'react';
import type { ColumnFilter, DataSource, Widget } from '@/types';

/** Values chosen in slicer widgets, shared by every widget on the canvas */
export interface DashCtxValue {
  /** the dashboard shown (widgets that store things of their own, e.g. รับทราบ of the records widget) */
  dashboardId?: string;
  slicers: Record<string, ColumnFilter | null>;
  setSlicer: (id: string, f: ColumnFilter | null) => void;
  widgets: Widget[];
}
export const DashCtx = createContext<DashCtxValue>({ slicers: {}, setSlicer: () => undefined, widgets: [] });
export const useDash = () => useContext(DashCtx);

/** Adds the filters of every active slicer that targets this widget (same sheet) */
export function withSlicers(ctx: DashCtxValue, widgetId: string, ds: DataSource | null): DataSource | null {
  if (!ds) return ds;
  const extra: ColumnFilter[] = [];
  for (const s of ctx.widgets) {
    if (s.type !== 'slicer' || s.id === widgetId || s.style?.hidden) continue;
    const f = ctx.slicers[s.id];
    if (!f || s.dataSource?.sheetId !== ds.sheetId) continue;
    const targets: string[] = s.config.targets ?? [];
    if (targets.length && !targets.includes(widgetId)) continue;
    extra.push(f);
  }
  return extra.length ? { ...ds, filters: [...(ds.filters ?? []), ...extra] } : ds;
}
