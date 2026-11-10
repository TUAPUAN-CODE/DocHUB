import { useEffect, useState } from 'react';
import { rowsApi } from '@/api/endpoints';
import type { CellValue, Column } from '@/types';

const cache = new Map<string, { at: number; p: Promise<string[]> }>();

/** Options of a relationship column for one parent value (cached for 20 s) */
export function fetchLookupOptions(col: Pick<Column, 'sheetId' | 'id'>, parentValue: string | null, force = false): Promise<string[]> {
  const key = `${col.id}|${parentValue ?? ''}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < 20_000) return hit.p;
  const p = rowsApi.lookupOptions(col.sheetId, { columnId: col.id, parentValue }).then((r) => r.options).catch(() => { cache.delete(key); return [] as string[]; });
  cache.set(key, { at: Date.now(), p });
  return p;
}
export const clearLookupCache = () => cache.clear();

export const lookupOf = (col: Pick<Column, 'validation' | 'dataType'>) => ((col.dataType === 'select' || col.dataType === 'multi_select') && (col.validation?.lookup?.columnId || col.validation?.lookup?.users) ? col.validation.lookup : null);

/** Parent value (text) for a dependent column, read from the row being edited */
export const parentValueFor = (col: Pick<Column, 'validation' | 'dataType'>, values: Record<string, CellValue | undefined>): string | null => {
  const p = lookupOf(col)?.parent;
  if (!p) return null;
  const v = values[p.localColumnId];
  return v === null || v === undefined || v === '' ? null : String(Array.isArray(v) ? v[0] : v);
};

/** Options for a lookup column (null while loading / when the column is not a lookup) */
export function useLookupOptions(col: Pick<Column, 'sheetId' | 'id' | 'validation' | 'dataType'> | null, values: Record<string, CellValue | undefined>) {
  const l = col ? lookupOf(col) : null;
  const parent = col ? parentValueFor(col, values) : null;
  const [state, setState] = useState<{ options: string[] | null; loading: boolean }>({ options: null, loading: !!l });
  useEffect(() => {
    if (!col || !l) { setState({ options: null, loading: false }); return; }
    if (l.parent && parent === null) { setState({ options: [], loading: false }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    void fetchLookupOptions(col, parent).then((o) => live && setState({ options: o, loading: false }));
    return () => { live = false; };
  }, [col?.id, l?.columnId, l?.users?.tag, l?.parent?.localColumnId, parent]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, isLookup: !!l, needsParent: !!l?.parent && parent === null };
}

/** Columns that depend on `colId` (their options change when it changes) */
export const dependentsOf = <T extends Pick<Column, 'id' | 'validation' | 'dataType'>>(colId: string, columns: T[]): T[] =>
  columns.filter((c) => lookupOf(c)?.parent?.localColumnId === colId);
