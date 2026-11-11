import { useEffect, useMemo, useState } from 'react';
import { History, Search, X } from 'lucide-react';
import { rowsApi } from '@/api/endpoints';
import { useDebounce } from '@/hooks';
import { cn } from '@/lib/cn';
import { loadCols } from '@/lib/dashCols';
import { displayValue, fmtDateTime } from '@/lib/format';
import { revisionsApi, RevDiff, RevMeta } from '@/modules/revisions/api';
import { RevDiffView, RevValue } from '@/modules/revisions/RevDiffView';
import type { Column, Row, Widget } from '@/types';
import { ImageGallery } from '../sheet/ImageCell';
import { useDash, withSlicers } from './dashContext';

function useColumns(sheetId: string | undefined) {
  const [cols, setCols] = useState<Column[]>([]);
  useEffect(() => { let live = true; if (sheetId) void loadCols(sheetId).then((c) => live && setCols(c)); else setCols([]); return () => { live = false; }; }, [sheetId]);
  return cols;
}
const text = (v: unknown) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v));

/** Latest revision of a sheet with its changes (null = no revision yet, or the reader cannot see it) */
function useLatestRev(sheetId: string | undefined, enabled: boolean, refreshKey: number) {
  const [rev, setRev] = useState<{ meta: RevMeta; diff: RevDiff | null } | null>(null);
  useEffect(() => {
    if (!sheetId || !enabled) { setRev(null); return; }
    let live = true;
    revisionsApi.get(sheetId, 'latest').then((r) => live && setRev(r)).catch(() => live && setRev(null));
    return () => { live = false; };
  }, [sheetId, enabled, refreshKey]);
  return rev;
}

/* ------------------------------------------------------------------ */
/* "ค้นหารายละเอียด": type a key (e.g. Sub Doc No. / Short Code) → every matching row with its details and pictures */
/* ------------------------------------------------------------------ */
export function RecordsBody({ w, refreshKey, editing }: { w: Widget; refreshKey: number; editing?: boolean }) {
  const ctx = useDash();
  const ds = withSlicers(ctx, w.id, w.dataSource);
  const c = w.config ?? {};
  const cols = useColumns(ds?.sheetId);
  const byId = useMemo(() => new Map(cols.map((x) => [x.id, x])), [cols]);
  const titleIds: string[] = (c.titleColumnIds ?? []).filter((id: string) => byId.has(id));
  const imageCol = c.imageColumnId ? byId.get(c.imageColumnId) : undefined;
  /** fieldColumnsAll: every column that is not a heading or a picture, in sheet order — columns added later show up by themselves */
  const fieldIds: string[] = c.fieldColumnsAll
    ? cols.filter((x) => x.dataType !== 'image' && !titleIds.includes(x.id)).map((x) => x.id)
    : (c.fieldColumnIds ?? []).filter((id: string) => byId.has(id));
  const searchIds: string[] = (c.searchColumnIds ?? []).filter((id: string) => byId.has(id));
  const pageSize = Math.max(5, Math.min(200, Number(c.pageSize) || 20));
  /** a heading as the table shows it (dates dd/mm/yyyy, option labels …) */
  const shown = (id: string, r: Row) => { const col = byId.get(id); return col ? displayValue(col, r.values[id] ?? null) : text(r.values[id]); };

  const [q, setQ] = useState('');
  const dq = useDebounce(q.trim(), 300);
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => setLimit(pageSize), [dq, pageSize]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const filtersKey = JSON.stringify(ds?.filters ?? []);
  useEffect(() => {
    if (!ds?.sheetId) return;
    let live = true;
    setError('');
    rowsApi.query(ds.sheetId, {
      page: 1, pageSize: limit, filters: ds.filters ?? [], search: dq || undefined, searchColumns: dq && searchIds.length ? searchIds : undefined,
      sorts: titleIds.length ? titleIds.map((id) => ({ columnId: id, dir: 'asc' as const })) : [],
    })
      .then((r) => { if (live) { setRows(r.rows); setTotal(r.total); } })
      .catch((e) => live && setError(e?.response?.data?.error?.message ?? 'โหลดข้อมูลไม่สำเร็จ'));
    return () => { live = false; };
  }, [ds?.sheetId, dq, limit, filtersKey, searchIds.join(), titleIds.join(), refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const rev = useLatestRev(ds?.sheetId, c.showRev !== false, refreshKey);
  const revOf = useMemo(() => {
    const m = new Map<string, { kind: 'changed' | 'added'; fields: string[] }>();
    rev?.diff?.changed.forEach((r) => m.set(r.id, { kind: 'changed', fields: r.fields.map((f) => f.name) }));
    rev?.diff?.added.forEach((r) => m.set(r.id, { kind: 'added', fields: [] }));
    return m;
  }, [rev]);

  // rows sharing the first heading (e.g. one Sub Doc No. with several Short Codes) are shown under one card
  const groups = useMemo(() => {
    const out: { key: string; rows: Row[] }[] = [];
    for (const r of rows ?? []) {
      const key = titleIds[0] ? shown(titleIds[0], r) : r.id;
      const last = out[out.length - 1];
      if (last && last.key === key && titleIds[0]) last.rows.push(r); else out.push({ key, rows: [r] });
    }
    return out;
  }, [rows, titleIds.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ds?.sheetId || !titleIds.length) return <p className="grid h-full place-items-center text-center text-xs opacity-60">{editing ? 'เลือกชีตและคอลัมน์หัวข้อที่แผง “ข้อมูล” ด้านขวา' : 'ยังไม่ได้ตั้งค่าข้อมูล'}</p>;
  const searchNames = searchIds.map((id) => byId.get(id)!.name);
  const fs = Number(c.fontSize) || 14;
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ fontSize: fs }}>
      <div className="mb-2 flex shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15" onMouseDown={(e) => e.stopPropagation()}>
        <Search className="h-4 w-4 shrink-0 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={c.placeholder || (searchNames.length ? `ค้นหา ${searchNames.join(' / ')}` : 'ค้นหา…')}
          className="h-11 min-w-0 flex-1 bg-transparent outline-none focus-visible:outline-none" enterKeyHint="search"
          style={{ fontSize: 'max(16px, 1em)' }} /* iPhone zooms the page into a field smaller than 16 px */ />
        {q && <button onClick={() => setQ('')} aria-label="ล้างคำค้น" className="rounded-full p-1 text-muted hover:bg-ink/10"><X className="h-4 w-4" /></button>}
      </div>
      <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-x-3 text-xs opacity-70">
        <span>{rows === null ? 'กำลังโหลด…' : dq ? `พบ ${total.toLocaleString()} รายการสำหรับ “${dq}”` : `ทั้งหมด ${total.toLocaleString()} รายการ`}</span>
        {rev && <span className="inline-flex items-center gap-1"><History className="h-3.5 w-3.5" />Rev.{rev.meta.revNo} · {fmtDateTime(rev.meta.createdAt)}</span>}
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
        {error && <p className="px-2 py-6 text-center text-sm text-danger">{error}</p>}
        {rows !== null && !rows.length && !error && <p className="px-2 py-10 text-center text-sm opacity-60">{dq ? `ไม่พบ “${dq}”` : 'ยังไม่มีข้อมูล'}</p>}
        {groups.map((g) => (
          <div key={g.rows[0].id} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line bg-primary/[.05] px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-[1.15em] font-semibold text-primary">{titleIds[0] ? g.key || '—' : `แถว ${g.rows[0].order}`}</p>
              {g.rows.length > 1 && <span className="shrink-0 rounded-full bg-primary/10 px-2 text-[0.8em] font-medium text-primary">{g.rows.length} รายการ</span>}
            </div>
            <div className="divide-y divide-line">
              {g.rows.map((r) => {
                const rv = revOf.get(r.id);
                const imgs = imageCol && Array.isArray(r.values[imageCol.id]) ? (r.values[imageCol.id] as string[]) : [];
                return (
                  <div key={r.id} className="space-y-2 px-3 py-2.5">
                    {(titleIds.length > 1 || rv) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {titleIds.slice(1).map((id) => shown(id, r) && (
                          <span key={id} className="rounded-lg bg-ink/[.06] px-2 py-0.5 text-[0.9em] font-medium" title={byId.get(id)!.name}>{shown(id, r)}</span>
                        ))}
                        {rv && rev && (
                          <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[0.75em] font-semibold', rv.kind === 'added' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}
                            title={rv.fields.length ? `แก้ไข: ${rv.fields.join(', ')}` : undefined}>
                            {rv.kind === 'added' ? 'ใหม่ใน' : 'แก้ไขใน'} Rev.{rev.meta.revNo}{rv.fields.length ? ` · ${rv.fields.join(', ')}` : ''}
                          </span>
                        )}
                      </div>
                    )}
                    {fieldIds.length > 0 && (
                      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
                        {fieldIds.map((id) => {
                          const col = byId.get(id)!;
                          const v = r.values[id];
                          if (v === null || v === undefined || v === '') return null;
                          return (
                            <div key={id} className="contents">
                              <dt className="text-[0.85em] opacity-60">{col.name}</dt>
                              <dd className="min-w-0"><RevValue type={col.dataType} value={v} /></dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                    {imgs.length > 0 && <div onMouseDown={(e) => e.stopPropagation()}><ImageGallery urls={imgs} /></div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {rows !== null && rows.length < total && (
          <button onClick={() => setLimit((l) => Math.min(1000, l + pageSize))} onMouseDown={(e) => e.stopPropagation()}
            className="w-full rounded-xl border border-dashed border-line py-2 text-sm font-medium text-primary hover:bg-primary/5">
            ดูเพิ่ม ({rows.length.toLocaleString()} จาก {total.toLocaleString()})
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Rev ล่าสุด": the current revision of a sheet and how it differs from the one before                                 */
/* ------------------------------------------------------------------ */
export function RevisionBody({ w, refreshKey, editing }: { w: Widget; refreshKey: number; editing?: boolean }) {
  const sheetId = w.dataSource?.sheetId;
  const [list, setList] = useState<RevMeta[] | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ meta: RevMeta; diff: RevDiff | null; prevRevNo: number | null } | null>(null);
  useEffect(() => {
    if (!sheetId) return;
    let live = true;
    revisionsApi.list(sheetId).then((r) => { if (live) { setList(r.revisions); setPick(null); } }).catch(() => live && setList([]));
    return () => { live = false; };
  }, [sheetId, refreshKey]);
  useEffect(() => {
    if (!sheetId || !list?.length) { setDetail(null); return; }
    let live = true;
    revisionsApi.get(sheetId, pick ?? 'latest').then((r) => live && setDetail(r)).catch(() => live && setDetail(null));
    return () => { live = false; };
  }, [sheetId, list, pick]);
  if (!sheetId) return <p className="grid h-full place-items-center text-xs opacity-60">{editing ? 'เลือกชีตที่แผง “ข้อมูล”' : 'ยังไม่ได้ตั้งค่าข้อมูล'}</p>;
  if (list && !list.length) return <p className="grid h-full place-items-center text-center text-sm opacity-60">ชีตนี้ยังไม่เคยออก Rev</p>;
  if (!detail) return <div className="skeleton h-full w-full" />;
  const m = detail.meta;
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ fontSize: Number(w.config?.fontSize) || 14 }}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <span className="rounded-xl bg-primary px-2.5 py-1 text-[1.1em] font-semibold text-white">Rev.{m.revNo}</span>
        <span className="min-w-0 flex-1 text-xs opacity-70">{fmtDateTime(m.createdAt)}{m.createdByName ? ` · ${m.createdByName}` : ''}<br />
          {detail.diff ? `เทียบ Rev.${detail.prevRevNo}: แก้ไข ${m.changed} · เพิ่ม ${m.added} · ลบ ${m.removed}` : `Rev แรก · ${m.rowCount.toLocaleString()} แถว`}</span>
        {list && list.length > 1 && (
          <select value={pick ?? ''} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : null)} onMouseDown={(e) => e.stopPropagation()}
            className="ds-input h-8 px-2 text-xs" aria-label="เลือก Rev">
            <option value="">ล่าสุด</option>
            {list.map((r) => <option key={r.revNo} value={r.revNo}>Rev.{r.revNo}</option>)}
          </select>
        )}
      </div>
      {m.note && <p className="mb-2 shrink-0 whitespace-pre-wrap rounded-xl bg-ink/5 px-3 py-1.5 text-[0.9em]">{m.note}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5" onMouseDown={(e) => e.stopPropagation()}>
        {detail.diff ? <RevDiffView diff={detail.diff} limit={Number(w.config?.limit) || 10} /> : <p className="py-6 text-center text-sm opacity-60">Rev แรก — ยังไม่มี Rev ก่อนหน้าให้เทียบ</p>}
      </div>
    </div>
  );
}
