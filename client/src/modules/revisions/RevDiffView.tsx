import { useState } from 'react';
import { ArrowRight, Minus, Pencil, Plus } from 'lucide-react';
import { ImageThumbs } from '@/components/sheet/ImageCell';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime } from '@/lib/format';
import type { CellValue } from '@/types';
import type { FieldValue, RevDiff, RowRef } from './api';

const isEmpty = (v: CellValue | undefined) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

/** One value as a person reads it (pictures as thumbnails, dates as dd/mm/yyyy) */
export function RevValue({ type, value, tone }: { type: string; value: CellValue | undefined; tone?: 'old' | 'new' }) {
  const [more, setMore] = useState(false);
  if (isEmpty(value)) return <span className="italic text-muted">(ว่าง)</span>;
  if (type === 'image' && Array.isArray(value)) return <span className="inline-flex h-12 max-w-full align-middle"><ImageThumbs urls={value as string[]} max={6} /></span>;
  let text: string;
  if (type === 'date') text = fmtDate(String(value));
  else if (type === 'datetime') text = fmtDateTime(String(value));
  else if (type === 'boolean') text = value ? 'ใช่' : 'ไม่ใช่';
  else text = Array.isArray(value) ? value.join(', ') : String(value);
  const long = text.length > 220 || text.split('\n').length > 4;
  return (
    <span className={cn('whitespace-pre-wrap break-words', tone === 'old' && 'text-danger/80 line-through decoration-danger/40', tone === 'new' && 'text-success')}>
      <span className={cn(long && !more && 'line-clamp-4')}>{text}</span>
      {long && <button type="button" onClick={() => setMore((m) => !m)} className="ml-1 text-xs font-medium text-primary no-underline hover:underline">{more ? 'ย่อ' : 'ดูทั้งหมด'}</button>}
    </span>
  );
}

function Who({ r }: { r: RowRef }) {
  if (isEmpty(r.by) && isEmpty(r.at)) return null;
  return <span className="text-xs text-muted">{!isEmpty(r.at) && fmtDate(String(r.at))}{!isEmpty(r.at) && !isEmpty(r.by) && ' · '}{!isEmpty(r.by) && String(r.by)}</span>;
}

function Section({ icon, title, count, tone, children }: { icon: JSX.Element; title: string; count: number; tone: string; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className={cn('grid h-6 w-6 place-items-center rounded-full [&>svg]:h-3.5 [&>svg]:w-3.5', tone)}>{icon}</span>{title} <span className="text-muted">{count}</span></h4>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Values({ values }: { values: FieldValue[] }) {
  return (
    <dl className="mt-1.5 grid gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[max-content_1fr]">
      {values.map((f) => (
        <div key={f.columnId} className="contents">
          <dt className="text-muted">{f.name}</dt>
          <dd className="min-w-0"><RevValue type={f.type} value={f.value} /></dd>
        </div>
      ))}
    </dl>
  );
}

/** What changed in a revision compared with the one before it */
export function RevDiffView({ diff, limit }: { diff: RevDiff; limit?: number }) {
  const [all, setAll] = useState(false);
  const cut = <T,>(xs: T[]) => (limit && !all ? xs.slice(0, limit) : xs);
  const total = diff.added.length + diff.changed.length + diff.removed.length;
  const hidden = limit && !all ? Math.max(0, diff.changed.length - limit) + Math.max(0, diff.added.length - limit) + Math.max(0, diff.removed.length - limit) : 0;
  const cols = diff.columns;
  return (
    <div className="space-y-5">
      {(cols.added.length > 0 || cols.removed.length > 0 || cols.renamed.length > 0) && (
        <div className="rounded-xl bg-primary/[.06] px-3 py-2 text-[13px]">
          <p className="font-medium text-primary">โครงสร้างคอลัมน์เปลี่ยน</p>
          {cols.added.length > 0 && <p>เพิ่มคอลัมน์: {cols.added.join(', ')}</p>}
          {cols.removed.length > 0 && <p>ลบคอลัมน์: {cols.removed.join(', ')}</p>}
          {cols.renamed.map((r) => <p key={r.from}>เปลี่ยนชื่อ: {r.from} → {r.to}</p>)}
        </div>
      )}
      {!total && !cols.added.length && !cols.removed.length && !cols.renamed.length && <p className="py-6 text-center text-sm text-muted">ไม่มีการเปลี่ยนแปลง</p>}
      <Section icon={<Pencil />} title="แก้ไข" count={diff.changed.length} tone="bg-warning/15 text-warning">
        {cut(diff.changed).map((r) => (
          <div key={r.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3"><p className="font-semibold">{r.label}</p><Who r={r} /></div>
            <div className="mt-2 space-y-2">
              {r.fields.map((f) => (
                <div key={f.columnId} className="text-[13px]">
                  <p className="mb-0.5 text-xs font-medium text-muted">{f.name}</p>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
                    <div className="min-w-0 flex-1 rounded-lg bg-danger/[.05] px-2 py-1"><RevValue type={f.type} value={f.old} tone="old" /></div>
                    <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted sm:mt-1.5 sm:block" />
                    <div className="min-w-0 flex-1 rounded-lg bg-success/[.06] px-2 py-1"><RevValue type={f.type} value={f.new} tone="new" /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>
      <Section icon={<Plus />} title="เพิ่มใหม่" count={diff.added.length} tone="bg-success/15 text-success">
        {cut(diff.added).map((r) => (
          <div key={r.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3"><p className="font-semibold">{r.label}</p><Who r={r} /></div>
            <Values values={r.values} />
          </div>
        ))}
      </Section>
      <Section icon={<Minus />} title="ลบออก" count={diff.removed.length} tone="bg-danger/15 text-danger">
        {cut(diff.removed).map((r) => (
          <div key={r.id} className="rounded-xl border border-line p-3 opacity-80">
            <p className="font-semibold line-through decoration-danger/40">{r.label}</p>
            <Values values={r.values} />
          </div>
        ))}
      </Section>
      {hidden > 0 && <button type="button" onClick={() => setAll(true)} className="w-full rounded-xl border border-dashed border-line py-2 text-sm font-medium text-primary hover:bg-primary/5">ดูอีก {hidden} รายการ</button>}
    </div>
  );
}
