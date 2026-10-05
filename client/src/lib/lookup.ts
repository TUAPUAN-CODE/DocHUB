import { useEffect, useState } from 'react';
import { rowsApi } from '@/api/endpoints';
import type { CellValue, Column } from '@/types';

/** a drop-down shows this many values; with more in the source the user searches (the server searches the whole table) */
export const LOOKUP_PAGE = 300;
const cache = new Map<string, { at: number; p: Promise<{ options: string[]; more: boolean }> }>();

/** Options of a relationship column for one parent value (cached for 20 s) */
export function fetchLookupPage(col: Pick<Column, 'sheetId' | 'id'>, parentValue: string | null, force = false): Promise<{ options: string[]; more: boolean }> {
  const key = `${col.id}|${parentValue ?? ''}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < 20_000) return hit.p;
  const p = rowsApi.lookupOptions(col.sheetId, { columnId: col.id, parentValue, limit: LOOKUP_PAGE }).then((r) => ({ options: r.options, more: !!r.more })).catch(() => { cache.delete(key); return { options: [] as string[], more: false }; });
  cache.set(key, { at: Date.now(), p });
  return p;
}
/** All options (used where a whole list is needed, e.g. document-number prefixes; these lists are short) */
export const fetchLookupOptions = (col: Pick<Column, 'sheetId' | 'id'>, parentValue: string | null, force = false): Promise<string[]> => fetchLookupPage(col, parentValue, force).then((r) => r.options);
/** Search the WHOLE source on the server (any size) */
export const searchLookupOptions = (col: Pick<Column, 'sheetId' | 'id'>, parentValue: string | null, search: string, limit = 100): Promise<string[]> =>
  rowsApi.lookupOptions(col.sheetId, { columnId: col.id, parentValue, search, limit }).then((r) => r.options).catch(() => []);
export const clearLookupCache = () => cache.clear();

export const lookupOf = (col: Pick<Column, 'validation' | 'dataType'>) => ((col.dataType === 'select' || col.dataType === 'multi_select') && col.validation?.lookup?.columnId ? col.validation.lookup : null);

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
  const [state, setState] = useState<{ options: string[] | null; more: boolean; loading: boolean }>({ options: null, more: false, loading: !!l });
  useEffect(() => {
    if (!col || !l) { setState({ options: null, more: false, loading: false }); return; }
    if (l.parent && parent === null) { setState({ options: [], more: false, loading: false }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    void fetchLookupPage(col, parent).then((o) => live && setState({ options: o.options, more: o.more, loading: false }));
    return () => { live = false; };
  }, [col?.id, l?.columnId, l?.parent?.localColumnId, parent]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, isLookup: !!l, needsParent: !!l?.parent && parent === null };
}

/** Columns that depend on `colId` (their options change when it changes) */
export const dependentsOf = <T extends Pick<Column, 'id' | 'validation' | 'dataType'>>(colId: string, columns: T[]): T[] =>
  columns.filter((c) => lookupOf(c)?.parent?.localColumnId === colId);
