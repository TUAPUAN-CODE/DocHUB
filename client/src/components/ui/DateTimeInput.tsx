import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Date + time in 24-hour form (00–23), in place of <input type="datetime-local">, whose time shows AM / PM when the phone or
 * computer is set to English. Value = the same local string as datetime-local ("YYYY-MM-DDTHH:mm", '' = empty).
 * The time box takes 1950, 19:50, 19.50 or 9 (= 09:00).
 */
export const parseTime = (s: string): string | null => {
  const t = s.trim();
  if (!t) return null;
  let h: number, m: number;
  const sep = /^(\d{1,2})\s*[:.]\s*(\d{1,2})$/.exec(t);
  if (sep) { h = Number(sep[1]); m = Number(sep[2]); }
  else if (/^\d{1,4}$/.test(t)) {
    if (t.length <= 2) { h = Number(t); m = 0; }
    else { h = Number(t.slice(0, t.length - 2)); m = Number(t.slice(-2)); }
  } else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const pad = (n: number) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function DateTimeInput({ value, onChange, autoFocus, invalid, max, className, bare }: {
  value: string; onChange: (v: string) => void; autoFocus?: boolean; invalid?: boolean; max?: string; className?: string;
  /** no box around the two fields (inside a table cell) */ bare?: boolean;
}) {
  const date = value ? value.slice(0, 10) : '';
  const time = value ? value.slice(11, 16) : '';
  const [text, setText] = useState(time);
  const typing = useRef(false);
  useEffect(() => { if (!typing.current) setText(time); }, [time]);
  const bad = !!text.trim() && !parseTime(text);
  const emit = (d: string, t: string | null) => onChange(d ? `${d}T${t ?? '00:00'}` : '');
  return (
    <div className={cn('flex items-center gap-1.5', !bare && 'ds-input h-10 px-2', (invalid || bad) && !bare && '!border-danger', className)}>
      <input type="date" value={date} autoFocus={autoFocus} max={max?.slice(0, 10)} aria-label="วันที่"
        onChange={(e) => emit(e.target.value, parseTime(text) ?? (time || null))}
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none" />
      <input type="text" inputMode="numeric" value={text} placeholder="00:00" maxLength={5} aria-label="เวลา (00–23 น.)" title="เวลา 24 ชั่วโมง เช่น 19:50 หรือพิมพ์ 1950"
        onChange={(e) => { typing.current = true; setText(e.target.value); const t = parseTime(e.target.value); if (t && date) emit(date, t); }}
        onBlur={() => { typing.current = false; const t = parseTime(text); if (t) { setText(t); if (date) emit(date, t); } }}
        className={cn('h-full w-[3.6rem] shrink-0 bg-transparent text-center text-sm tabular-nums outline-none', bad && 'text-danger')} />
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { const n = nowLocal(); typing.current = false; setText(n.slice(11)); onChange(n); }}
        className="shrink-0 rounded-md p-1 text-muted hover:bg-ink/5 hover:text-primary" title="ตอนนี้" aria-label="ใส่วันเวลาตอนนี้"><Clock className="h-4 w-4" /></button>
    </div>
  );
}
