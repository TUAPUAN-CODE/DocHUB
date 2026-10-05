import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, fmtNumber, fromLocalInput, optionLabel, toLocalInput } from '@/lib/format';
import { searchLookupOptions, useLookupOptions, parentValueFor } from '@/lib/lookup';
import type { CellValue, Column, SelectOption } from '@/types';
import { Popover } from '../ui/Popover';
import { DocNumberCellEditor } from './DocNumberCell';
import { ImageCellEditor, ImageThumbs, toUrls } from './ImageCell';

export function Chip({ label, color, size = 'md' }: { label: string; color?: string | null; size?: 'sm' | 'md' }) {
  const c = color ?? '#64748B';
  return (
    <span className={cn('inline-flex max-w-full items-center truncate rounded-full font-medium', size === 'sm' ? 'px-1.5 py-px text-[0.85em]' : 'px-2 py-0.5 text-[0.9em]')}
      style={{ background: `${c}1F`, color: c }}>{label}</span>
  );
}

export function CellDisplay({ col, value }: { col: Column; value: CellValue | undefined }): ReactNode {
  if (value === null || value === undefined || value === '') return null;
  switch (col.dataType) {
    case 'int':
    case 'float':
      return <span className="block text-right tabular-nums">{fmtNumber(value as number, col.validation?.decimals)}</span>;
    case 'date':
      return <span className="tabular-nums">{fmtDate(String(value))}</span>;
    case 'datetime':
      return <span className="tabular-nums">{fmtDateTime(String(value))}</span>;
    case 'boolean':
      return (
        <span className={cn('mx-auto grid h-[1.15em] w-[1.15em] place-items-center rounded-[4px] border', value ? 'border-primary bg-primary text-white' : 'border-ink/25')}>
          {value && <Check className="h-[0.8em] w-[0.8em]" strokeWidth={3} />}
        </span>
      );
    case 'select': {
      const o = col.options.find((x) => x.value === value);
      return <Chip label={o?.label ?? String(value)} color={o?.color} />;
    }
    case 'multi_select':
      return (
        <span className="flex gap-1 overflow-hidden">
          {(value as string[]).map((v) => <Chip key={v} size="sm" label={optionLabel(col, v)} color={col.options.find((o) => o.value === v)?.color} />)}
        </span>
      );
    case 'image':
      return <ImageThumbs urls={toUrls(value)} />;
    case 'url':
      return <a href={String(value)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="text-primary underline-offset-2 hover:underline">{String(value).replace(/^https?:\/\//, '')}</a>;
    case 'email':
      return <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()} className="text-primary underline-offset-2 hover:underline">{String(value)}</a>;
    default:
      return <>{String(value).split('\n')[0]}</>;
  }
}

export type Move = 'down' | 'up' | 'right' | 'left' | null;
const rawText = (col: Column, v: CellValue | undefined) => {
  if (v === null || v === undefined) return '';
  if (col.dataType === 'datetime') return toLocalInput(String(v));
  return String(v);
};

/** Inline / popover editor for one cell */
export function CellEditor({ col, value, initial, anchor, onCommit, onCancel, rowValues }: {
  col: Column; value: CellValue | undefined; initial?: string; anchor: HTMLElement | null; rowValues?: Record<string, CellValue | undefined>;
  onCommit: (v: CellValue, move: Move) => void; onCancel: () => void;
}) {
  const done = useRef(false);
  const start = initial ?? rawText(col, value);
  const [text, setText] = useState(start);
  const finish = (v: CellValue, move: Move) => {
    if (done.current) return;
    done.current = true;
    onCommit(v, move);
  };
  const cancel = () => { if (!done.current) { done.current = true; onCancel(); } };
  const conv = (s: string): CellValue => (col.dataType === 'datetime' ? fromLocalInput(s) : s === '' ? null : s);
  const keys = (e: KeyboardEvent, multiline = false) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); text === rawText(col, value) ? cancel() : finish(conv(text), 'down'); }
    else if (e.key === 'Tab') { e.preventDefault(); text === rawText(col, value) ? cancel() : finish(conv(text), e.shiftKey ? 'left' : 'right'); }
  };

  if (col.dataType === 'doc_number') return <DocNumberCellEditor col={col} value={value} anchor={anchor} rowValues={rowValues ?? {}} onCommit={finish} onCancel={cancel} />;
  if (col.dataType === 'image') return <ImageCellEditor col={col} value={value} anchor={anchor} onCommit={finish} onCancel={cancel} />;
  if (col.dataType === 'select' || col.dataType === 'multi_select') return <LookupAwareOptionEditor col={col} value={value} anchor={anchor} rowValues={rowValues ?? {}} onCommit={finish} onCancel={cancel} />;

  if (col.dataType === 'text')
    return (
      <Popover open anchor={anchor} onClose={() => (text === rawText(col, value) ? cancel() : finish(conv(text), null))} width={Math.max(320, anchor?.offsetWidth ?? 0)} offset={-((anchor?.offsetHeight ?? 0))}>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => keys(e, true)} rows={6}
          className="block w-full resize-y bg-transparent p-3 text-sm outline-none" />
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Enter บันทึก · Shift+Enter ขึ้นบรรทัดใหม่ · Esc ยกเลิก</p>
      </Popover>
    );

  const type = col.dataType === 'date' ? 'date' : col.dataType === 'datetime' ? 'datetime-local' : 'text';
  return (
    <input autoFocus value={text} type={type} inputMode={col.dataType === 'int' || col.dataType === 'float' ? 'decimal' : undefined}
      onChange={(e) => setText(e.target.value)} onKeyDown={(e) => keys(e)}
      onBlur={() => (text === rawText(col, value) ? cancel() : finish(conv(text), null))}
      onFocus={(e) => { if (initial !== undefined) { const el = e.currentTarget; requestAnimationFrame(() => { try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* date inputs */ } }); } }}
      className={cn('absolute inset-0 z-[5] h-full w-full bg-surface px-2 outline-none ring-2 ring-inset ring-primary', (col.dataType === 'int' || col.dataType === 'float') && 'text-right tabular-nums')} />
  );
}

/** Fixed options, or the live options of a relationship column (filtered by the row's parent value) */
function LookupAwareOptionEditor(p: { col: Column; value: CellValue | undefined; anchor: HTMLElement | null; rowValues: Record<string, CellValue | undefined>; onCommit: (v: CellValue, m: Move) => void; onCancel: () => void }) {
  const lk = useLookupOptions(p.col, p.rowValues);
  const options: SelectOption[] = lk.isLookup ? (lk.options ?? []).map((v) => ({ value: v, label: v })) : p.col.options;
  const hint = lk.isLookup ? (lk.loading ? 'กำลังโหลดตัวเลือก…' : lk.needsParent ? 'กรุณาเลือกคอลัมน์ที่เชื่อมโยงก่อน' : !options.length ? 'ไม่มีตัวเลือกในตารางต้นทาง' : null) : null;
  const remote = lk.isLookup && lk.more ? (q: string) => searchLookupOptions(p.col, parentValueFor(p.col, p.rowValues), q) : undefined;
  return <OptionEditor col={p.col} options={options} hint={hint} search={remote} value={p.value} anchor={p.anchor} onCommit={p.onCommit} onCancel={p.onCancel} />;
}

function OptionEditor({ col, options, hint, search, value, anchor, onCommit, onCancel }: { col: Column; options: SelectOption[]; hint?: string | null; search?: (q: string) => Promise<string[]>; value: CellValue | undefined; anchor: HTMLElement | null; onCommit: (v: CellValue, m: Move) => void; onCancel: () => void }) {
  const multi = col.dataType === 'multi_select';
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>(multi ? ((value as string[]) ?? []) : value ? [String(value)] : []);
  const [hi, setHi] = useState(0);
  const [remote, setRemote] = useState<SelectOption[] | null>(null);
  // source longer than one page: ask the server (whole table) while the user types
  useEffect(() => {
    if (!search || !q.trim()) { setRemote(null); return; }
    let live = true;
    const t = setTimeout(() => { void search(q).then((r) => live && setRemote(r.map((v) => ({ value: v, label: v })))); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, search]);
  const list = useMemo(() => remote ?? options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase())), [options, q, remote]);
  const canClear = !col.isRequired && col.validation?.allowEmpty !== false;
  useEffect(() => setHi(0), [q]);
  const pick = (v: string) => {
    if (!multi) return onCommit(v, 'down');
    const max = col.validation?.maxSelections ?? Infinity;
    setSel((s) => (s.includes(v) ? s.filter((x) => x !== v) : s.length >= max ? s : [...s, v]));
  };
  const close = () => {
    if (!multi) return onCancel();
    const orig = JSON.stringify((value as string[]) ?? []);
    if (JSON.stringify(sel) === orig) onCancel(); else onCommit(sel.length ? sel : null, null);
  };
  return (
    <Popover open anchor={anchor} onClose={close} width={Math.max(240, anchor?.offsetWidth ?? 0)}>
      <div className="border-b border-line p-2">
        <div className="flex items-center gap-2 rounded-lg bg-ink/5 px-2.5">
          <Search className="h-4 w-4 text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาตัวเลือก…" className="h-9 w-full bg-transparent text-sm outline-none"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) pick(list[hi].value); else if (multi) close(); }
              if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }} />
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {list.map((o, i) => (
          <button key={o.value} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)}
            className={cn('flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm', i === hi && 'bg-ink/5')}>
            <span className={cn('grid h-4 w-4 place-items-center rounded border', sel.includes(o.value) ? 'border-primary bg-primary text-white' : 'border-ink/25', !multi && 'rounded-full')}>
              {sel.includes(o.value) && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <Chip label={o.label} color={o.color} />
          </button>
        ))}
        {!list.length && <p className="px-3 py-4 text-center text-sm text-muted">{hint ?? 'ไม่พบตัวเลือก'}</p>}
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-2">
        {canClear ? <button type="button" onClick={() => onCommit(null, null)} className="text-xs text-muted hover:text-danger">ล้างค่า</button> : <span />}
        {multi && <button type="button" onClick={close} className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white">เสร็จ</button>}
      </div>
    </Popover>
  );
}
