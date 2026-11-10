import { ClipboardEvent, KeyboardEvent, MouseEvent as RMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ, ArrowUpAZ, Camera, ChevronDown, ClipboardPaste, Copy, Eraser, Eye, EyeOff, Filter, History, Maximize2, MoveHorizontal,
  Pin, PinOff, Settings2, SquarePen, Trash2, ArrowDownUp,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ColumnStat, rowsApi } from '@/api/endpoints';
import { parseTsv, toTsv } from '@/lib/csv';
import { isComputed, TYPE_META } from '@/lib/columnTypes';
import { dependentsOf } from '@/lib/lookup';
import { displayValue, fmtNumber, relTime } from '@/lib/format';
import { toast } from '@/store/ui';
import type { CellValue, Column, Row } from '@/types';
import { Anchor, MenuItemDef, MenuList, Popover } from '../ui/Popover';
import { CellDisplay, CellEditor, Move } from './CellView';
import { alertColor, tint } from '@/modules/alerts/level';
import { toUrls, uploadImages } from './ImageCell';
import { useMinuteTick } from '@/modules/alerts/useMinuteTick';
import type { CellChange, SheetView } from './useSheetView';

interface Pos { r: number; c: number }
interface Props {
  view: SheetView;
  canWrite: boolean;
  canManage: boolean;
  onOpenRow: (row: Row) => void;
  onCellHistory: (row: Row, col: Column) => void;
  onRowHistory: (row: Row) => void;
  onFilterColumn: (columnId: string, anchor: HTMLElement) => void;
  onColumnSettings: () => void;
  onDeleteRows: (ids: string[]) => void;
  /** Ids of the rows touched by the current selection (drives the toolbar delete button) */
  onSelectRows?: (ids: string[]) => void;
  /** Opens the read-only full detail of a row (eye icon) */
  onViewRow?: (row: Row) => void;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const EDIT_INLINE_TYPED = new Set(['varchar', 'text', 'int', 'float', 'url', 'email']);
/** phone / tablet: no mouse, so no hover and no Ctrl+click */
const coarsePointer = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

function cellStyle(base: React.CSSProperties | undefined, col: Column, values: Row['values'], now: number): React.CSSProperties | undefined {
  const cfg = col.validation?.alert;
  if (!cfg) return base;
  const a = alertColor(cfg, values, now);
  return a ? { ...base, backgroundColor: tint(a.color, 0.3), boxShadow: `inset 3px 0 0 ${a.color}` } : base;
}

export function SpreadsheetGrid({ view, canWrite, canManage, onOpenRow, onCellHistory, onRowHistory, onFilterColumn, onColumnSettings, onDeleteRows, onSelectRows, onViewRow }: Props) {
  const { columns: cols, rows, prefs, setPrefs, query, setQuery, commit, users, flash } = view;
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [sel, setSel] = useState<{ a: Pos; f: Pos } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; initial?: string } | null>(null);
  const [menu, setMenu] = useState<{ anchor: Anchor; kind: 'cell' | 'header' | 'row'; r: number; c: number } | null>(null);
  const [resize, setResize] = useState<{ kind: 'col' | 'row'; id: string; size: number } | null>(null);
  const dragging = useRef(false);

  const z = prefs.zoom;
  const HEAD = Math.round(38 * z);
  const RN = Math.round(64 * z);
  const colW = useCallback((c: Column) => Math.round((resize?.kind === 'col' && resize.id === c.id ? resize.size : prefs.colWidths[c.id] ?? c.width) * z), [resize, prefs.colWidths, z]);
  const rowH = useCallback((r: Row) => Math.round((resize?.kind === 'row' && resize.id === r.id ? resize.size : prefs.rowHeights[r.id] ?? prefs.rowHeight) * z), [resize, prefs.rowHeights, prefs.rowHeight, z]);
  const fc = Math.min(prefs.frozenCols, cols.length);
  const fr = Math.min(prefs.frozenRows, rows.length);

  const lefts = useMemo(() => {
    const out: number[] = [];
    let x = RN;
    cols.forEach((c, i) => { out[i] = x; x += colW(c); });
    return out;
  }, [cols, colW, RN]);
  const tops = useMemo(() => {
    const out: number[] = [];
    let y = HEAD;
    rows.forEach((r, i) => { out[i] = y; y += rowH(r); });
    return out;
  }, [rows, rowH, HEAD]);
  const totalW = RN + cols.reduce((s, c) => s + colW(c), 0);

  const bounds = sel ? { r1: Math.min(sel.a.r, sel.f.r), r2: Math.max(sel.a.r, sel.f.r), c1: Math.min(sel.a.c, sel.f.c), c2: Math.max(sel.a.c, sel.f.c) } : null;
  const selKey = bounds ? rows.slice(bounds.r1, bounds.r2 + 1).map((r) => r.id).join(',') : '';
  useEffect(() => { onSelectRows?.(selKey ? selKey.split(',') : []); }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const inSel = (r: number, c: number) => !!bounds && r >= bounds.r1 && r <= bounds.r2 && c >= bounds.c1 && c <= bounds.c2;

  // keep selection valid when data changes
  useEffect(() => {
    if (!sel) return;
    const maxR = rows.length - 1;
    const maxC = cols.length - 1;
    if (maxR < 0 || maxC < 0) return setSel(null);
    const clamp = (p: Pos) => ({ r: Math.min(p.r, maxR), c: Math.min(p.c, maxC) });
    if (sel.a.r > maxR || sel.f.r > maxR || sel.a.c > maxC || sel.f.c > maxC) setSel({ a: clamp(sel.a), f: clamp(sel.f) });
  }, [rows.length, cols.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sel) return;
    tableRef.current?.querySelector(`[data-cell="${sel.f.r}:${sel.f.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel?.f.r, sel?.f.c]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // Ctrl + wheel zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const next = Math.round(Math.min(2, Math.max(0.5, prefs.zoom + (e.deltaY < 0 ? 0.1 : -0.1))) * 10) / 10;
      if (next !== prefs.zoom) setPrefs({ zoom: next });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [prefs.zoom, setPrefs]);

  const focusGrid = () => scrollRef.current?.focus({ preventScroll: true });

  const move = (dr: number, dc: number, extend = false, jump = false) => {
    if (!rows.length || !cols.length) return;
    const cur = sel?.f ?? { r: 0, c: 0 };
    const r = jump ? (dr > 0 ? rows.length - 1 : dr < 0 ? 0 : cur.r) : Math.max(0, Math.min(rows.length - 1, cur.r + dr));
    const c = jump ? (dc > 0 ? cols.length - 1 : dc < 0 ? 0 : cur.c) : Math.max(0, Math.min(cols.length - 1, cur.c + dc));
    setSel(extend && sel ? { a: sel.a, f: { r, c } } : { a: { r, c }, f: { r, c } });
  };

  const startEdit = (r: number, c: number, initial?: string) => {
    const col = cols[c];
    const row = rows[r];
    if (!col || !row) return;
    if (!canWrite) return toast.info('คุณมีสิทธิ์ดูข้อมูลเท่านั้น', 'ขอสิทธิ์แก้ไขได้จากเมนูของไฟล์');
    if (isComputed(col)) return toast.info('คอลัมน์นี้คำนวณจากสูตรอัตโนมัติ', 'แก้ไขสูตรได้ที่ “ตั้งค่าคอลัมน์”');
    if (col.dataType === 'boolean') return void commit([{ rowId: row.id, columnId: col.id, value: !row.values[col.id] }]);
    setEditing({ r, c, initial: initial !== undefined && EDIT_INLINE_TYPED.has(col.dataType) ? initial : undefined });
  };

  /** Tap the camera of an image cell: the phone's camera opens at once, the photo is added to the cell */
  const captureInto = (row: Row, col: Column) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
    inp.onchange = async () => {
      const files = [...(inp.files ?? [])];
      if (!files.length) return;
      const cur = toUrls(row.values[col.id]);
      const max = col.validation?.maxSelections ?? 200;
      if (cur.length >= max) { toast.info(`ใส่รูปได้ไม่เกิน ${max} รูป`); return; }
      const added = await uploadImages(files.slice(0, max - cur.length));
      if (added.length) void commit([{ rowId: row.id, columnId: col.id, value: [...cur, ...added] }]);
    };
    inp.click();
  };

  const finishEdit = (value: CellValue, mv: Move) => {
    if (!editing) return;
    const row = rows[editing.r];
    const col = cols[editing.c];
    setEditing(null);
    if (row && col) {
      const cur = row.values[col.id] ?? null;
      if (JSON.stringify(cur) !== JSON.stringify(value ?? null)) {
        const changes: CellChange[] = [{ rowId: row.id, columnId: col.id, value }];
        // a dependent drop-down (relationship) is cleared when its parent changes
        for (const d of dependentsOf(col.id, cols)) if (!d.isRequired && row.values[d.id] != null) changes.push({ rowId: row.id, columnId: d.id, value: null });
        void commit(changes);
      }
    }
    if (mv === 'down') move(1, 0);
    else if (mv === 'up') move(-1, 0);
    else if (mv === 'right') move(0, 1);
    else if (mv === 'left') move(0, -1);
    requestAnimationFrame(focusGrid);
  };

  const clearSelection = () => {
    if (!bounds || !canWrite) return;
    const changes: CellChange[] = [];
    for (let r = bounds.r1; r <= bounds.r2; r++)
      for (let c = bounds.c1; c <= bounds.c2; c++) {
        const row = rows[r];
        const col = cols[c];
        if (row && col && !isComputed(col) && !isEmpty(row.values[col.id])) changes.push({ rowId: row.id, columnId: col.id, value: null });
      }
    if (changes.length) void commit(changes, { partial: true, source: 'edit' });
  };

  const selectionTsv = () => {
    if (!bounds) return '';
    const grid: string[][] = [];
    for (let r = bounds.r1; r <= bounds.r2; r++) {
      const line: string[] = [];
      for (let c = bounds.c1; c <= bounds.c2; c++) line.push(cols[c] && rows[r] ? displayValue(cols[c], rows[r].values[cols[c].id] ?? null) : '');
      grid.push(line);
    }
    return toTsv(grid);
  };

  const pasteText = (text: string) => {
    if (!bounds || !canWrite) return;
    const grid = parseTsv(text);
    if (!grid.length) return;
    const single = grid.length === 1 && grid[0].length === 1;
    const rEnd = single ? bounds.r2 : Math.min(rows.length - 1, bounds.r1 + grid.length - 1);
    const cEnd = single ? bounds.c2 : Math.min(cols.length - 1, bounds.c1 + Math.max(...grid.map((g) => g.length)) - 1);
    const changes: CellChange[] = [];
    for (let r = bounds.r1; r <= rEnd; r++)
      for (let c = bounds.c1; c <= cEnd; c++) {
        const v = single ? grid[0][0] : grid[r - bounds.r1]?.[c - bounds.c1];
        if (v === undefined) continue;
        if (isComputed(cols[c])) continue;
        changes.push({ rowId: rows[r].id, columnId: cols[c].id, value: v === '' ? null : v });
      }
    const skipped = single ? 0 : grid.length - (rEnd - bounds.r1 + 1);
    if (skipped > 0) toast.info(`วางได้ ${rEnd - bounds.r1 + 1} แถว`, `ข้าม ${skipped} แถวที่เกินหน้าปัจจุบัน — เพิ่มแถวหรือเพิ่มจำนวนแถวต่อหน้าก่อน`);
    if (changes.length) void commit(changes, { partial: true, source: 'paste' });
    setSel({ a: { r: bounds.r1, c: bounds.c1 }, f: { r: rEnd, c: cEnd } });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); void (e.shiftKey ? view.redo() : view.undo()); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); void view.redo(); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); if (rows.length && cols.length) setSel({ a: { r: 0, c: 0 }, f: { r: rows.length - 1, c: cols.length - 1 } }); return; }
    if (mod) return;
    const arrows: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) { e.preventDefault(); move(arrows[k][0], arrows[k][1], e.shiftKey, e.altKey); return; }
    if (!sel) { if (rows.length && cols.length && (k === 'Enter' || k === 'Tab')) { e.preventDefault(); setSel({ a: { r: 0, c: 0 }, f: { r: 0, c: 0 } }); } return; }
    if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); startEdit(sel.f.r, sel.f.c); return; }
    if (k === 'Escape') { setSel({ a: sel.f, f: sel.f }); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearSelection(); return; }
    if (k === ' ' && cols[sel.f.c]?.dataType === 'boolean') { e.preventDefault(); startEdit(sel.f.r, sel.f.c); return; }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(sel.f.r, sel.f.c, k); }
  };

  const onCopy = (e: ClipboardEvent) => {
    if (editing || !bounds) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionTsv());
    toast.info(`คัดลอก ${(bounds.r2 - bounds.r1 + 1) * (bounds.c2 - bounds.c1 + 1)} เซลล์แล้ว`);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (editing) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  };

  /* ---------- resizing ---------- */
  const startColResize = (e: RMouseEvent, col: Column) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = prefs.colWidths[col.id] ?? col.width;
    let w = startW;
    const mm = (ev: MouseEvent) => { w = Math.max(50, Math.min(1200, startW + (ev.clientX - startX) / z)); setResize({ kind: 'col', id: col.id, size: w }); };
    const up = () => {
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', up);
      setResize(null);
      setPrefs((p) => ({ colWidths: { ...p.colWidths, [col.id]: Math.round(w) } }));
    };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', up);
  };
  const startRowResize = (e: RMouseEvent, row: Row) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = prefs.rowHeights[row.id] ?? prefs.rowHeight;
    let h = startH;
    const mm = (ev: MouseEvent) => { h = Math.max(22, Math.min(400, startH + (ev.clientY - startY) / z)); setResize({ kind: 'row', id: row.id, size: h }); };
    const up = () => {
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', up);
      setResize(null);
      setPrefs((p) => ({ rowHeights: { ...p.rowHeights, [row.id]: Math.round(h) } }));
    };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', up);
  };
  const autoFit = (col: Column) => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return;
    ctx.font = `13px ${getComputedStyle(document.body).fontFamily}`;
    let w = ctx.measureText(col.name).width + 64;
    rows.forEach((r) => { w = Math.max(w, col.dataType === 'image' ? 180 : ctx.measureText(displayValue(col, r.values[col.id] ?? null)).width + (col.dataType === 'select' || col.dataType === 'multi_select' ? 40 : 24)); });
    setPrefs((p) => ({ colWidths: { ...p.colWidths, [col.id]: Math.round(Math.min(600, Math.max(60, w))) } }));
  };

  /* ---------- sorting ---------- */
  const sortOf = (id: string) => {
    const i = query.sorts.findIndex((s) => s.columnId === id);
    return i < 0 ? null : { dir: query.sorts[i].dir, i };
  };
  const cycleSort = (col: Column, add: boolean) => {
    const cur = sortOf(col.id);
    const nextDir = !cur ? 'asc' : cur.dir === 'asc' ? 'desc' : null;
    const others = add ? query.sorts.filter((s) => s.columnId !== col.id) : [];
    setQuery({ sorts: nextDir ? [...others, { columnId: col.id, dir: nextDir }] : others });
  };
  const filtered = (id: string) => query.filters.some((f) => f.columnId === id);

  /* ---------- menus ---------- */
  const menuItems = (): MenuItemDef[] => {
    if (!menu) return [];
    const col = cols[menu.c];
    const row = rows[menu.r];
    if (menu.kind === 'header' && col)
      return [
        { label: 'เรียงน้อย → มาก', icon: <ArrowDownAZ />, onClick: () => setQuery({ sorts: [{ columnId: col.id, dir: 'asc' }] }) },
        { label: 'เรียงมาก → น้อย', icon: <ArrowUpAZ />, onClick: () => setQuery({ sorts: [{ columnId: col.id, dir: 'desc' }] }) },
        { label: 'ตัวกรองคอลัมน์นี้', icon: <Filter />, onClick: () => { const th = tableRef.current?.querySelector<HTMLElement>(`[data-col="${menu.c}"]`); if (th) onFilterColumn(col.id, th); } },
        { divider: true },
        { label: 'ตรึงคอลัมน์ถึงตรงนี้', icon: <Pin />, onClick: () => setPrefs({ frozenCols: menu.c + 1 }) },
        ...(prefs.frozenCols ? [{ label: 'เลิกตรึงคอลัมน์', icon: <PinOff />, onClick: () => setPrefs({ frozenCols: 0 }) }] : []),
        { label: 'ปรับความกว้างอัตโนมัติ', icon: <MoveHorizontal />, onClick: () => autoFit(col) },
        { label: 'ซ่อนคอลัมน์ (เฉพาะฉัน)', icon: <EyeOff />, onClick: () => setPrefs((p) => ({ hiddenCols: [...p.hiddenCols, col.id], frozenCols: Math.min(p.frozenCols, cols.length - 1) })) },
        ...(canManage ? [{ divider: true }, { label: 'ตั้งค่าคอลัมน์', icon: <Settings2 />, onClick: onColumnSettings }] : []),
      ];
    if (!row) return [];
    const selRows = bounds ? rows.slice(bounds.r1, bounds.r2 + 1) : [row];
    const delIds = selRows.some((r) => r.id === row.id) ? selRows.map((r) => r.id) : [row.id];
    const common: MenuItemDef[] = [
      { label: 'เปิดแถวในฟอร์ม', icon: <Maximize2 />, onClick: () => onOpenRow(row) },
      { label: 'ประวัติของแถว', icon: <History />, onClick: () => onRowHistory(row) },
      { divider: true },
      { label: 'ตรึงแถวถึงตรงนี้', icon: <Pin />, onClick: () => setPrefs({ frozenRows: menu.r + 1 }) },
      ...(prefs.frozenRows ? [{ label: 'เลิกตรึงแถว', icon: <PinOff />, onClick: () => setPrefs({ frozenRows: 0 }) }] : []),
      ...(canWrite ? [{ divider: true }, { label: delIds.length > 1 ? `ลบ ${delIds.length} แถว` : 'ลบแถว', icon: <Trash2 />, danger: true, onClick: () => onDeleteRows(delIds) }] : []),
    ];
    if (menu.kind === 'row') return common;
    return [
      { label: 'คัดลอก', icon: <Copy />, hint: 'Ctrl+C', onClick: () => navigator.clipboard?.writeText(selectionTsv()).then(() => toast.info('คัดลอกแล้ว')).catch(() => toast.info('กด Ctrl+C เพื่อคัดลอก')) },
      ...(canWrite ? [
        { label: 'วาง', icon: <ClipboardPaste />, hint: 'Ctrl+V', onClick: () => navigator.clipboard?.readText().then(pasteText).catch(() => toast.info('กด Ctrl+V เพื่อวาง', 'เบราว์เซอร์ไม่อนุญาตให้อ่านคลิปบอร์ดจากเมนู')) },
        { label: 'ล้างค่า', icon: <Eraser />, hint: 'Del', onClick: clearSelection },
        { label: 'แก้ไขเซลล์', icon: <SquarePen />, hint: 'Enter', onClick: () => startEdit(menu.r, menu.c) },
      ] : []),
      { label: 'ประวัติของเซลล์', icon: <History />, onClick: () => col && onCellHistory(row, col) },
      { divider: true },
      { label: 'ตรึงคอลัมน์ถึงตรงนี้', icon: <Pin />, onClick: () => setPrefs({ frozenCols: menu.c + 1 }) },
      ...common,
    ];
  };

  /* ---------- status bar ---------- */
  // ---- whole-column selection (click a header) with count / sum for the current filter
  const [colSel, setColSel] = useState<string[]>([]);
  const lastCol = useRef<string | null>(null);
  const [stats, setStats] = useState<{ totalRows: number; columns: ColumnStat[] } | null>(null);
  const pickColumn = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    setSel(null);
    setColSel((cur) => {
      if (e.shiftKey && lastCol.current) {
        const a = cols.findIndex((c) => c.id === lastCol.current), b = cols.findIndex((c) => c.id === id);
        return cols.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.id);
      }
      if (e.ctrlKey || e.metaKey) return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return cur.length === 1 && cur[0] === id ? [] : [id];
    });
    lastCol.current = id;
  };
  useEffect(() => { if (sel) setColSel([]); }, [sel]);
  const sheetKey = view.detail?.sheet.id;
  const statsKey = JSON.stringify([colSel, query.filters, query.search, view.total]);
  useEffect(() => {
    if (!colSel.length || !sheetKey) { setStats(null); return; }
    let live = true;
    const t = setTimeout(() => {
      rowsApi.columnStats(sheetKey, { columnIds: colSel, filters: query.filters, search: query.search || undefined }).then((r) => live && setStats(r)).catch(() => live && setStats(null));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [statsKey, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = useMemo(() => {
    if (!bounds) return null;
    const cells = (bounds.r2 - bounds.r1 + 1) * (bounds.c2 - bounds.c1 + 1);
    const nums: number[] = [];
    let filled = 0;
    for (let r = bounds.r1; r <= bounds.r2; r++)
      for (let c = bounds.c1; c <= bounds.c2; c++) {
        const v = rows[r]?.values[cols[c]?.id ?? ''];
        if (!isEmpty(v)) filled++;
        if (typeof v === 'number') nums.push(v);
      }
    const focus = rows[bounds.r1 === sel!.f.r ? sel!.f.r : sel!.f.r];
    const fcol = cols[sel!.f.c];
    const meta = focus && fcol ? focus.meta[fcol.id] : undefined;
    return { cells, filled, nums, focus, fcol, meta };
  }, [bounds, sel, rows, cols]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- render ---------- */
  // colour alerts: the clock only runs while a visible column has one (once a minute, in the browser — no server load)
  const nowMs = useMinuteTick(cols.some((c) => c.validation?.alert));
  const stickyCell = (ri: number, ci: number) => {
    const frow = ri < fr;
    const fcol = ci < fc;
    if (!frow && !fcol) return { position: 'relative' as const };
    return { position: 'sticky' as const, left: fcol ? lefts[ci] : undefined, top: frow ? tops[ri] : undefined, zIndex: frow && fcol ? 14 : frow ? 12 : 10 };
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste} className="grid-scroll min-h-0 flex-1" style={{ fontSize: 13 * z }}
        aria-label="ตารางข้อมูล" role="grid" aria-rowcount={rows.length} aria-colcount={cols.length}>
        <table ref={tableRef} className="ds-grid" style={{ width: totalW }}>
          <colgroup>
            <col style={{ width: RN }} />
            {cols.map((c) => <col key={c.id} style={{ width: colW(c) }} />)}
          </colgroup>
          <thead>
            <tr style={{ height: HEAD }}>
              <th className="rownum" style={{ position: 'sticky', left: 0, top: 0, zIndex: 30, fontSize: '0.85em' }}>#</th>
              {cols.map((c, ci) => {
                const s = sortOf(c.id);
                return (
                  <th key={c.id} data-col={ci} role="columnheader" aria-sort={s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn('group select-none text-left', ci === fc - 1 && 'freeze-col-edge', colSel.includes(c.id) && 'colsel')}
                    style={{ position: 'sticky', top: 0, left: ci < fc ? lefts[ci] : undefined, zIndex: ci < fc ? 28 : 26 }}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ anchor: { x: e.clientX, y: e.clientY }, kind: 'header', r: 0, c: ci }); }}>
                    <div className="flex h-full items-center gap-1.5" style={{ padding: `0 ${8 * z}px` }}>
                      {isComputed(c) ? <span title="คอลัมน์สูตร" className="shrink-0 font-serif text-[1.05em] font-bold italic text-primary">ƒ</span> : <span className="shrink-0 opacity-60 [&>svg]:h-[1em] [&>svg]:w-[1em]">{TYPE_META[c.dataType].icon}</span>}
                      <button onClick={(e) => pickColumn(c.id, e)} title={`${c.name}${c.description ? ` — ${c.description}` : ''}\nคลิกเพื่อเลือกคอลัมน์ (ดูจำนวนแถว/ผลรวม) · Ctrl+คลิก เลือกหลายคอลัมน์ · Shift+คลิก เลือกเป็นช่วง`}
                        className="min-w-0 flex-1 truncate text-left font-medium text-ink/85">
                        {c.name}{c.isRequired && <span className="ml-0.5 text-danger">*</span>}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); cycleSort(c, e.shiftKey); }} aria-label={`เรียงตาม ${c.name}`} title="คลิกเพื่อเรียง · Shift+คลิกเพื่อเรียงหลายคอลัมน์"
                        className={cn('shrink-0 rounded px-0.5 text-primary hover:bg-ink/10', !s && 'text-muted opacity-0 group-hover:opacity-100')} style={{ fontSize: '0.8em' }}>
                        {s ? <>{s.dir === 'asc' ? '▲' : '▼'}{query.sorts.length > 1 ? s.i + 1 : ''}</> : <ArrowDownUp className="h-[1em] w-[1em]" />}
                      </button>
                      <button onClick={(e) => onFilterColumn(c.id, e.currentTarget.closest('th') as HTMLElement)} aria-label={`ตัวกรอง ${c.name}`}
                        className={cn('grid shrink-0 place-items-center rounded p-0.5', filtered(c.id) ? 'bg-primary text-white' : 'opacity-0 hover:bg-ink/10 group-hover:opacity-100')}>
                        {filtered(c.id) ? <Filter className="h-[0.9em] w-[0.9em]" /> : <ChevronDown className="h-[1em] w-[1em]" />}
                      </button>
                    </div>
                    <span className={cn('col-resizer', resize?.id === c.id && 'on')} onMouseDown={(e) => startColResize(e, c)} onDoubleClick={() => autoFit(c)} title="ลากเพื่อปรับความกว้าง · ดับเบิลคลิกเพื่อปรับอัตโนมัติ" />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const frow = ri < fr;
              return (
                <tr key={row.id} style={{ height: rowH(row), animationDelay: `${Math.min(ri, 24) * 12}ms` }} className="row-in">
                  <td className={cn('rownum group/rn', flash.has(`${row.id}:__row`) && 'cell-flash', ri === fr - 1 && 'freeze-row-edge')}
                    style={{ position: 'sticky', left: 0, top: frow ? tops[ri] : undefined, zIndex: frow ? 16 : 11, fontSize: '0.85em' }}
                    onClick={() => cols.length && setSel({ a: { r: ri, c: 0 }, f: { r: ri, c: cols.length - 1 } })}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ anchor: { x: e.clientX, y: e.clientY }, kind: 'row', r: ri, c: 0 }); }}>
                    <span className="flex w-full items-center justify-center gap-1 group-hover/rn:hidden">
                      <span>{row.order}</span>
                      {onViewRow && <button onClick={(e) => { e.stopPropagation(); onViewRow(row); }} className="text-muted" title="ดูข้อมูลทั้งแถว" aria-label="ดูข้อมูลทั้งแถว"><Eye className="h-[1.05em] w-[1.05em]" /></button>}
                    </span>
                    <span className="hidden w-full items-center justify-center gap-1.5 group-hover/rn:flex">
                      {onViewRow && <button onClick={(e) => { e.stopPropagation(); onViewRow(row); }} className="text-primary" title="ดูข้อมูลทั้งแถว" aria-label="ดูข้อมูลทั้งแถว"><Eye className="h-[1.05em] w-[1.05em]" /></button>}
                      <button onClick={(e) => { e.stopPropagation(); onOpenRow(row); }} className="text-primary" title="เปิดแถวในฟอร์ม" aria-label="เปิดแถวในฟอร์ม">
                        <Maximize2 className="h-[1.05em] w-[1.05em]" />
                      </button>
                      {canWrite && (
                        <button onClick={(e) => { e.stopPropagation(); onDeleteRows([row.id]); }} className="text-danger" title="ลบแถวนี้" aria-label="ลบแถวนี้">
                          <Trash2 className="h-[1.05em] w-[1.05em]" />
                        </button>
                      )}
                    </span>
                    <span className="row-resizer" onMouseDown={(e) => startRowResize(e, row)} />
                  </td>
                  {cols.map((col, ci) => {
                    const v = row.values[col.id];
                    const isFocus = sel?.f.r === ri && sel?.f.c === ci;
                    const isEdit = editing?.r === ri && editing?.c === ci;
                    return (
                      <td key={col.id} data-cell={`${ri}:${ci}`} role="gridcell" aria-selected={inSel(ri, ci)}
                        className={cn(inSel(ri, ci) && 'sel', isFocus && 'focus', colSel.includes(col.id) && 'colsel', col.isRequired && isEmpty(v) && 'req-empty', ci === fc - 1 && 'freeze-col-edge',
                          ri === fr - 1 && 'freeze-row-edge', flash.has(`${row.id}:${col.id}`) && 'cell-flash', col.dataType === 'boolean' && 'text-center')}
                        style={cellStyle(stickyCell(ri, ci), col, row.values, nowMs)}
                        title={col.isRequired && isEmpty(v) ? `"${col.name}" จำเป็นต้องกรอก` : undefined}
                        onMouseDown={(e) => {
                          if (e.button !== 0 || isEdit) return;
                          dragging.current = true;
                          setSel((s) => (e.shiftKey && s ? { a: s.a, f: { r: ri, c: ci } } : { a: { r: ri, c: ci }, f: { r: ri, c: ci } }));
                          focusGrid();
                        }}
                        onMouseEnter={() => dragging.current && setSel((s) => (s ? { a: s.a, f: { r: ri, c: ci } } : s))}
                        onDoubleClick={() => startEdit(ri, ci)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!inSel(ri, ci)) setSel({ a: { r: ri, c: ci }, f: { r: ri, c: ci } });
                          setMenu({ anchor: { x: e.clientX, y: e.clientY }, kind: 'cell', r: ri, c: ci });
                        }}>
                        <div className="flex h-full items-center overflow-hidden" style={{ padding: `0 ${8 * z}px` }}>
                          <div className={col.dataType === 'image' ? 'h-full min-w-0 flex-1 overflow-hidden' : 'min-w-0 flex-1 truncate'}><CellDisplay col={col} value={v} /></div>
                          {col.dataType === 'image' && canWrite && !isComputed(col) && (
                            <button type="button" title="ถ่ายรูป" aria-label="ถ่ายรูป" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); captureInto(row, col); }}
                              className="ml-1 grid shrink-0 place-items-center rounded-md p-1 text-primary hover:bg-primary/10"><Camera className="h-[1.1em] w-[1.1em]" /></button>
                          )}
                        </div>
                        {isEdit && (
                          <CellEditor col={col} value={v} rowValues={row.values} initial={editing?.initial}
                            anchor={tableRef.current?.querySelector<HTMLElement>(`[data-cell="${ri}:${ci}"]`) ?? null}
                            onCommit={finishEdit} onCancel={() => { setEditing(null); requestAnimationFrame(focusGrid); }} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && !view.loadingRows && (
          <div className="sticky left-0 px-6 py-16 text-center text-sm text-muted" style={{ width: scrollRef.current?.clientWidth }}>
            {query.filters.length || query.search ? 'ไม่พบข้อมูลที่ตรงกับตัวกรอง' : 'ยังไม่มีข้อมูล — กด “เพิ่มแถว” เพื่อเริ่มกรอก'}
          </div>
        )}
      </div>

      {/* touch screens: the keyboard / mouse hint is meaningless, so the bar only appears when there is something to show */}
      {(colSel.length > 0 || status || !coarsePointer) && <div className="flex h-9 shrink-0 items-center gap-4 overflow-x-auto border-t border-line px-3 text-xs text-muted">
        {colSel.length > 0 ? (
          <>
            <button onClick={() => setColSel([])} className="shrink-0 rounded-lg bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20">เลือก {colSel.length} คอลัมน์ ✕</button>
            {stats ? stats.columns.map((s) => {
              const col = cols.find((c) => c.id === s.columnId);
              if (!col) return null;
              const dec = col.validation?.decimals ?? (col.dataType === 'float' ? 2 : 0);
              return (
                <span key={s.columnId} className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-line px-2 py-0.5">
                  <b className="text-ink/85">{col.name}</b>
                  <span>แถว {stats.totalRows.toLocaleString()}</span>
                  <span>มีข้อมูล {s.filled.toLocaleString()}</span>
                  {stats.totalRows - s.filled > 0 && <span>ว่าง {(stats.totalRows - s.filled).toLocaleString()}</span>}
                  {s.sum !== null && <b className="text-primary">ผลรวม {fmtNumber(s.sum, dec)}</b>}
                  {s.avg !== null && <span>เฉลี่ย {fmtNumber(s.avg, Math.max(dec, 2))}</span>}
                  {s.min !== null && <span>ต่ำสุด {fmtNumber(Number(s.min), dec)}</span>}
                  {s.max !== null && <span>สูงสุด {fmtNumber(Number(s.max), dec)}</span>}
                  {s.trueCount !== null && <span>ใช่ {s.trueCount.toLocaleString()}</span>}
                </span>
              );
            }) : <span>กำลังคำนวณ…</span>}
          </>
        ) : status ? (
          <>
            <span className="whitespace-nowrap font-medium text-ink/80">{status.fcol?.name} · แถว #{status.focus?.order}</span>
            {status.meta && <span className="whitespace-nowrap">แก้ไขโดย {users[status.meta.by]?.name ?? 'ผู้ใช้'} · {relTime(status.meta.at)}</span>}
            {status.focus && status.fcol && (
              <button className="whitespace-nowrap text-primary hover:underline" onClick={() => onCellHistory(status.focus!, status.fcol!)}>ดูประวัติเซลล์</button>
            )}
            <span className="ml-auto" />
            {status.cells > 1 && <span className="whitespace-nowrap">จำนวน {status.filled}</span>}
            {status.nums.length > 1 && (
              <>
                <span className="whitespace-nowrap">ผลรวม {fmtNumber(status.nums.reduce((a, b) => a + b, 0))}</span>
                <span className="whitespace-nowrap">เฉลี่ย {fmtNumber(Math.round((status.nums.reduce((a, b) => a + b, 0) / status.nums.length) * 100) / 100)}</span>
              </>
            )}
          </>
        ) : (
          <span className="whitespace-nowrap">คลิกเซลล์เพื่อเลือก · คลิกชื่อคอลัมน์เพื่อดูจำนวนแถว/ผลรวม (Ctrl+คลิก เลือกหลายคอลัมน์) · ดับเบิลคลิกหรือ Enter เพื่อแก้ไข · Ctrl+Z ย้อนกลับ</span>
        )}
      </div>}

      <Popover open={!!menu} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} width={240}>
        {menu && <MenuList items={menuItems()} onClose={() => setMenu(null)} />}
      </Popover>
    </div>
  );
}
