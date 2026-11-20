import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { apiError, ApiErrorInfo } from '@/api/client';
import { cellsApi, RowPage, rowsApi, SheetDetail, sheetsApi } from '@/api/endpoints';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import type { CellValue, Column, ColumnFilter, Row, SheetPrefs, SortSpec } from '@/types';

export const DEFAULT_PREFS: SheetPrefs = { zoom: 1, frozenCols: 0, frozenRows: 0, colWidths: {}, rowHeights: {}, hiddenCols: [], rowHeight: 34, pageSize: 100 };

export interface CellChange { rowId: string; columnId: string; value: CellValue }
interface UndoEntry { rowId: string; columnId: string; before: CellValue; after: CellValue }
interface Patch { rowId: string; columnId: string; value: CellValue; meta?: { by: string; at: string } }
export interface QueryState { page: number; sorts: SortSpec[]; filters: ColumnFilter[]; search: string }

export function useSheetView(sheetId: string | null) {
  const me = useAuth((s) => s.user);
  const [detail, setDetail] = useState<SheetDetail | null>(null);
  const [detailError, setDetailError] = useState<ApiErrorInfo | null>(null);
  const [prefs, setPrefsState] = useState<SheetPrefs>(DEFAULT_PREFS);
  const [query, setQueryState] = useState<QueryState>({ page: 1, sorts: [], filters: [], search: '' });
  const [page, setPage] = useState<RowPage | null>(null);
  const [loadingRows, setLoadingRows] = useState(true);
  const [presence, setPresence] = useState<{ id: string; displayName: string; avatarUrl: string | null }[]>([]);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const undoStack = useRef<UndoEntry[][]>([]);
  const redoStack = useRef<UndoEntry[][]>([]);
  const pageRef = useRef(page);
  pageRef.current = page;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const seq = useRef(0);
  const restoreQuery = useRef(true); // the saved sort / filter of this person is applied once, when a sheet is opened
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const loadDetail = useCallback(async () => {
    if (!sheetId) return;
    try {
      const d = await sheetsApi.get(sheetId);
      setDetail(d);
      // a phone draws far slower than a PC: when nobody chose a page size yet (server default 100) start with 50 rows
      const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
      setPrefsState({ ...DEFAULT_PREFS, ...d.prefs, ...(phone && (d.prefs?.pageSize ?? 100) === 100 ? { pageSize: 50 } : {}) });
      if (restoreQuery.current) {
        restoreQuery.current = false;
        const ids = new Set(d.columns.map((c) => c.id.toLowerCase()));
        const saved = d.prefs?.query; // columns deleted since then are dropped, so a stale sort can not break the sheet
        setQueryState({ page: 1, search: '', sorts: (saved?.sorts ?? []).filter((x) => ids.has(x.columnId.toLowerCase())), filters: (saved?.filters ?? []).filter((x) => ids.has(x.columnId.toLowerCase())) });
      }
      setDetailError(null);
    } catch (e) {
      setDetailError(apiError(e));
    }
  }, [sheetId]);

  useEffect(() => {
    setDetail(null);
    setPage(null);
    setQueryState({ page: 1, sorts: [], filters: [], search: '' });
    restoreQuery.current = true;
    undoStack.current = [];
    redoStack.current = [];
    void loadDetail();
  }, [loadDetail]);

  const loadRows = useCallback(async (silent = false) => {
    if (!sheetId) return;
    const id = ++seq.current;
    if (!silent) setLoadingRows(true);
    try {
      const r = await rowsApi.query(sheetId, {
        page: query.page, pageSize: prefs.pageSize, sorts: query.sorts, filters: query.filters, search: query.search || undefined,
      });
      if (id === seq.current) setPage(r);
    } catch (e) {
      if (id === seq.current) toast.error(e, 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      if (id === seq.current) setLoadingRows(false);
    }
  }, [sheetId, query, prefs.pageSize]);

  const detailReady = !!detail && detail.sheet.id === sheetId;
  useEffect(() => {
    if (detailReady) void loadRows();
  }, [loadRows, detailReady]);

  const loadRowsRef = useRef(loadRows);
  loadRowsRef.current = loadRows;

  /* ---------- prefs ---------- */
  const setPrefs = useCallback((patch: Partial<SheetPrefs> | ((p: SheetPrefs) => Partial<SheetPrefs>)) => {
    setPrefsState((p) => {
      const next = { ...p, ...(typeof patch === 'function' ? patch(p) : patch) };
      const heights = Object.entries(next.rowHeights);
      if (heights.length > 500) next.rowHeights = Object.fromEntries(heights.slice(-500));
      return next;
    });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (sheetId) sheetsApi.savePrefs(sheetId, prefsRef.current).catch(() => undefined);
    }, 700);
  }, [sheetId]);

  /* ---------- query ---------- */
  // remember this person's sort / filter for the sheet (separate for every account); saved with the other prefs, a moment after the change
  useEffect(() => {
    if (!detail || detail.sheet.id !== sheetId || restoreQuery.current) return;
    const cur = prefsRef.current.query;
    if (JSON.stringify(cur?.sorts ?? []) === JSON.stringify(query.sorts) && JSON.stringify(cur?.filters ?? []) === JSON.stringify(query.filters)) return;
    setPrefs({ query: { sorts: query.sorts, filters: query.filters } });
  }, [query.sorts, query.filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQuery = useCallback((patch: Partial<QueryState>) => {
    setQueryState((q) => ({ ...q, ...patch, page: patch.page ?? (patch.sorts || patch.filters || patch.search !== undefined ? 1 : q.page) }));
  }, []);

  /* ---------- row patching ---------- */
  const patchRows = useCallback((patches: Patch[]) => {
    if (!patches.length) return;
    setPage((p) => {
      if (!p) return p;
      const byRow = new Map<string, Patch[]>();
      patches.forEach((x) => byRow.set(x.rowId, [...(byRow.get(x.rowId) ?? []), x]));
      return {
        ...p,
        rows: p.rows.map((r) => {
          const ps = byRow.get(r.id);
          if (!ps) return r;
          const values = { ...r.values };
          const meta = { ...r.meta };
          ps.forEach((x) => {
            if (x.value === null || x.value === undefined || x.value === '') delete values[x.columnId];
            else values[x.columnId] = x.value;
            if (x.meta) meta[x.columnId] = x.meta;
          });
          return { ...r, values, meta, updatedAt: ps.find((x) => x.meta)?.meta?.at ?? r.updatedAt };
        }),
      };
    });
  }, []);

  const flashCells = (keys: string[]) => {
    if (!keys.length) return;
    setFlash(new Set(keys));
    setTimeout(() => setFlash(new Set()), 1400);
  };

  const commit = useCallback(async (changes: CellChange[], opts: { source?: string; recordUndo?: boolean; partial?: boolean } = {}) => {
    if (!sheetId || !changes.length) return null;
    const rows = pageRef.current?.rows ?? [];
    const before = new Map(changes.map((c) => [`${c.rowId}:${c.columnId}`, rows.find((r) => r.id === c.rowId)?.values[c.columnId] ?? null]));
    const revert = (list: CellChange[]) => patchRows(list.map((c) => ({ ...c, value: before.get(`${c.rowId}:${c.columnId}`) ?? null })));
    patchRows(changes);
    try {
      let applied: { rowId: string; columnId: string; value: CellValue; at: string; by: string }[] = [];
      let derived: typeof applied = []; // cells recalculated by the server because of this edit (formula columns)
      if (changes.length === 1 && !opts.partial) {
        const r = await cellsApi.update(changes[0].rowId, changes[0].columnId, changes[0].value);
        if (!r.unchanged) applied = [{ rowId: r.rowId, columnId: r.columnId, value: r.value, at: r.at, by: r.by }];
        derived = r.derived ?? [];
      } else {
        const r = await cellsApi.bulk(sheetId, changes, opts.partial ?? true, opts.source ?? 'edit');
        const asked = new Set(changes.map((c) => `${c.rowId}:${c.columnId}`));
        applied = r.updated.filter((u) => asked.has(`${u.rowId}:${u.columnId}`));
        derived = r.updated.filter((u) => !asked.has(`${u.rowId}:${u.columnId}`));
        if (r.errors.length) toast.error(`${r.errors.length} เซลล์ไม่ผ่านการตรวจสอบ: ${r.errors[0].message}`, 'บางเซลล์ไม่ได้บันทึก');
      }
      const got = new Set(applied.map((a) => `${a.rowId}:${a.columnId}`));
      revert(changes.filter((c) => !got.has(`${c.rowId}:${c.columnId}`)));
      patchRows([...applied, ...derived].map((a) => ({ rowId: a.rowId, columnId: a.columnId, value: a.value, meta: { by: a.by, at: a.at } })));
      if (me && applied.length)
        setPage((p) => (p && !p.users[me.id] ? { ...p, users: { ...p.users, [me.id]: { name: me.displayName, avatarUrl: me.avatarUrl } } } : p));
      if (opts.recordUndo !== false && applied.length) {
        undoStack.current.push(applied.map((a) => ({ rowId: a.rowId, columnId: a.columnId, before: before.get(`${a.rowId}:${a.columnId}`) ?? null, after: a.value })));
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = [];
        bump();
      }
      return applied;
    } catch (e) {
      revert(changes);
      toast.error(e, 'บันทึกไม่สำเร็จ');
      return null;
    }
  }, [sheetId, patchRows, me]);

  const undo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry) return toast.info('ไม่มีรายการให้ย้อนกลับ');
    const r = await commit(entry.map((e) => ({ rowId: e.rowId, columnId: e.columnId, value: e.before })), { recordUndo: false, source: 'undo', partial: true });
    if (r) { redoStack.current.push(entry); flashCells(entry.map((e) => `${e.rowId}:${e.columnId}`)); } else undoStack.current.push(entry);
    bump();
  }, [commit]);

  const redo = useCallback(async () => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    const r = await commit(entry.map((e) => ({ rowId: e.rowId, columnId: e.columnId, value: e.after })), { recordUndo: false, source: 'undo', partial: true });
    if (r) { undoStack.current.push(entry); flashCells(entry.map((e) => `${e.rowId}:${e.columnId}`)); } else redoStack.current.push(entry);
    bump();
  }, [commit]);

  const addRow = useCallback(async (values: Record<string, CellValue>) => {
    if (!sheetId) return null;
    const r = await rowsApi.create(sheetId, values);
    await loadRowsRef.current(true);
    flashCells(Object.keys(r.row.values).map((c) => `${r.row.id}:${c}`).concat(`${r.row.id}:__row`));
    return r.row;
  }, [sheetId]);

  const deleteRows = useCallback(async (ids: string[]) => {
    if (!sheetId || !ids.length) return;
    try {
      await rowsApi.removeMany(sheetId, ids);
      toast.success(`ลบ ${ids.length} แถวแล้ว`, 'กู้คืนได้จากถังขยะของชีต');
      await loadRowsRef.current(true);
    } catch (e) {
      toast.error(e);
    }
  }, [sheetId]);

  /* ---------- realtime ---------- */
  useEffect(() => {
    if (!sheetId) return;
    const s = getSocket();
    if (!s) return;
    let t: ReturnType<typeof setTimeout>;
    const join = () => s.emit('sheet:join', sheetId);
    join();
    const onCells = (p: any) => {
      if (p.sheetId !== sheetId) return;
      patchRows(p.updates.map((u: any) => ({ rowId: u.rowId, columnId: u.columnId, value: u.value, meta: { by: u.by, at: u.at } })));
      const u0 = p.updates[0];
      if (u0) setPage((pg) => (pg && !pg.users[u0.by] ? { ...pg, users: { ...pg.users, [u0.by]: { name: u0.byName, avatarUrl: null } } } : pg));
      flashCells(p.updates.map((u: any) => `${u.rowId}:${u.columnId}`));
    };
    const onRows = (p: any) => {
      if (p.sheetId !== sheetId) return;
      clearTimeout(t);
      t = setTimeout(() => void loadRowsRef.current(true), 300);
    };
    const onCols = (p: any) => { if (p.sheetId === sheetId) void loadDetail(); };
    const onPresence = (p: any) => { if (p.sheetId === sheetId) setPresence(p.users); };
    s.on('connect', join);
    s.on('cells:updated', onCells);
    s.on('rows:changed', onRows);
    s.on('columns:changed', onCols);
    s.on('sheet:presence', onPresence);
    return () => {
      clearTimeout(t);
      s.emit('sheet:leave', sheetId);
      s.off('connect', join);
      s.off('cells:updated', onCells);
      s.off('rows:changed', onRows);
      s.off('columns:changed', onCols);
      s.off('sheet:presence', onPresence);
      setPresence([]);
    };
  }, [sheetId, patchRows, loadDetail]);

  const sheetHidden = detail?.settings?.hiddenColumnIds;
  const columns: Column[] = useMemo(() => (detail?.columns ?? []).filter((c) => !prefs.hiddenCols.includes(c.id) && !sheetHidden?.includes(c.id)), [detail, prefs.hiddenCols, sheetHidden]);
  const rows: Row[] = page?.rows ?? [];

  return {
    sheetId, detail, detailError, columns, allColumns: detail?.columns ?? [], rows, total: page?.total ?? 0, users: page?.users ?? {},
    prefs, setPrefs, query, setQuery, loadingRows, loadRows, loadDetail, commit, undo, redo, addRow, deleteRows, presence, flash,
    canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0,
  };
}
export type SheetView = ReturnType<typeof useSheetView>;
