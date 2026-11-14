import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCheck, ClipboardList, Eye, FileText, Hash, UserRound, Users } from 'lucide-react';
import { get, post } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { cn } from '@/lib/cn';
import { displayValue, fmtDateTime } from '@/lib/format';
import { toast } from '@/store/ui';
import type { Column, Row } from '@/types';
import { ImageGallery } from '../sheet/ImageCell';

/* ------------------------------------------------------------------ */
/* รับทราบ (acknowledgements) of a records widget                       */
/* ------------------------------------------------------------------ */
export interface Ack { id: string; rowId: string; rowLabel: string | null; employeeId: string | null; employeeName: string; at: string; by: string | null }
const base = (dash: string, wid: string) => `/dashboards/${dash}/widgets/${wid}`;
export const acksApi = {
  people: (dash: string, wid: string) => get<{ id: string; name: string }[]>(`${base(dash, wid)}/ack-people`),
  add: (dash: string, wid: string, b: { rowId: string; rowLabel?: string; employeeId: string }) => post<{ id: string; at: string; employeeName: string }>(`${base(dash, wid)}/acks`, b),
  ofRow: (dash: string, wid: string, rowId: string) => get<Ack[]>(`${base(dash, wid)}/acks`, { rowId }),
  ofDay: (dash: string, wid: string, date: string) => get<Ack[]>(`${base(dash, wid)}/acks`, { date }),
};

/** what a column is in the card: a heading box, a date box, a "by" box, a short value box, or a line of รายละเอียด */
const isByCol = (c: Column) => /update.?by|updated.?by|ผู้|บันทึกโดย|^by\b/i.test(c.name);
const isDateCol = (c: Column) => c.dataType === 'date' || c.dataType === 'datetime';
const isLong = (c: Column, v: unknown) => c.dataType === 'text' || (typeof v === 'string' && v.length > 40);

const TITLE_TONES = ['bg-blue-600 text-white', 'bg-violet-600 text-white', 'bg-teal-600 text-white', 'bg-slate-700 text-white'];
const BOX = {
  date: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
  by: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
  other: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200',
};

export interface CardModel {
  titleIds: string[]; fieldIds: string[]; imageCol?: Column; byId: Map<string, Column>;
}
const val = (m: CardModel, id: string, r: Row) => { const col = m.byId.get(id); return col ? displayValue(col, r.values[id] ?? null) : ''; };
export const rowLabelOf = (m: CardModel, r: Row) => m.titleIds.map((id) => val(m, id, r)).filter(Boolean).join(' · ');

function TitleBoxes({ m, r, big }: { m: CardModel; r: Row; big?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {m.titleIds.map((id, i) => {
        const v = val(m, id, r);
        if (!v) return null;
        return (
          <div key={id} className={cn('rounded-xl px-3 py-1.5 shadow-sm', TITLE_TONES[i % TITLE_TONES.length])}>
            <p className="text-[0.7em] font-medium uppercase tracking-wide opacity-80">{m.byId.get(id)!.name}</p>
            <p className={cn('font-bold leading-tight', big ? 'text-[1.5em]' : 'text-[1.15em]')}>{v}</p>
          </div>
        );
      })}
    </div>
  );
}

function FieldBoxes({ m, r, big }: { m: CardModel; r: Row; big?: boolean }) {
  const boxes: { id: string; tone: keyof typeof BOX; icon: JSX.Element }[] = [];
  const details: string[] = [];
  for (const id of m.fieldIds) {
    const col = m.byId.get(id)!;
    const v = r.values[id];
    if (v === null || v === undefined || v === '') continue;
    if (isLong(col, v)) { details.push(id); continue; }
    boxes.push({ id, tone: isDateCol(col) ? 'date' : isByCol(col) ? 'by' : 'other', icon: isDateCol(col) ? <CalendarDays className="h-3.5 w-3.5" /> : isByCol(col) ? <UserRound className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" /> });
  }
  return (
    <>
      {boxes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {boxes.map((b) => (
            <div key={b.id} className={cn('min-w-[8rem] rounded-xl border px-3 py-1.5', BOX[b.tone])}>
              <p className="flex items-center gap-1 text-[0.72em] font-medium opacity-80">{b.icon}{m.byId.get(b.id)!.name}</p>
              <p className={cn('font-semibold', big && 'text-[1.1em]')}>{val(m, b.id, r)}</p>
            </div>
          ))}
        </div>
      )}
      {details.length > 0 && (
        <div className="rounded-xl border border-line bg-ink/[.025] px-3 py-2">
          <p className="mb-1 flex items-center gap-1 text-[0.75em] font-semibold text-muted"><FileText className="h-3.5 w-3.5" />รายละเอียด</p>
          <div className="space-y-1.5">
            {details.map((id) => (
              <div key={id}>
                {details.length > 1 && <p className="text-[0.75em] text-muted">{m.byId.get(id)!.name}</p>}
                <p className={cn('whitespace-pre-wrap break-words leading-relaxed', big && 'text-[1.1em]')}>{val(m, id, r)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** One item of the list in the "boxes" style: coloured heading boxes, date / by / value boxes, รายละเอียด, pictures, buttons */
export function BoxCard({ m, r, onOpen, ack }: { m: CardModel; r: Row; onOpen: () => void; ack: boolean }) {
  const imgs = m.imageCol && Array.isArray(r.values[m.imageCol.id]) ? (r.values[m.imageCol.id] as string[]) : [];
  return (
    <div className="space-y-2.5 rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <TitleBoxes m={m} r={r} />
      <FieldBoxes m={m} r={r} />
      {imgs.length > 0 && <div onMouseDown={(e) => e.stopPropagation()}><ImageGallery urls={imgs} /></div>}
      <div className="flex flex-wrap justify-end gap-2" onMouseDown={(e) => e.stopPropagation()}>
        <Button size="sm" variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={onOpen}>ดูรายละเอียด{ack ? ' / รับทราบ' : ''}</Button>
      </div>
    </div>
  );
}

/** The item full size (pictures large) + รับทราบ: pick the employee (searchable), press รับทราบ; who has read it */
export function RecordDetail({ m, r, onClose, dashId, widgetId, ack }: { m: CardModel; r: Row; onClose: () => void; dashId?: string; widgetId: string; ack: boolean }) {
  const imgs = m.imageCol && Array.isArray(r.values[m.imageCol.id]) ? (r.values[m.imageCol.id] as string[]) : [];
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [emp, setEmp] = useState<string | null>(() => { try { return localStorage.getItem('ack.employee'); } catch { return null; } });
  const [list, setList] = useState<Ack[] | null>(null);
  const [busy, setBusy] = useState(false);
  const canAck = ack && !!dashId;
  useEffect(() => {
    if (!canAck) return;
    acksApi.people(dashId!, widgetId).then(setPeople).catch(() => setPeople([]));
    acksApi.ofRow(dashId!, widgetId, r.id).then(setList).catch(() => setList([]));
  }, [canAck, dashId, widgetId, r.id]);
  const options = useMemo(() => people.map((p) => ({ value: p.id, label: p.name })), [people]);
  const doAck = async () => {
    if (!emp || !dashId) return;
    setBusy(true);
    try {
      const a = await acksApi.add(dashId, widgetId, { rowId: r.id, rowLabel: rowLabelOf(m, r), employeeId: emp });
      try { localStorage.setItem('ack.employee', emp); } catch { /* private mode */ }
      toast.success(`${a.employeeName} รับทราบแล้ว`);
      setList(await acksApi.ofRow(dashId, widgetId, r.id));
    } catch (e) { toast.error(e, 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="xl" icon={<ClipboardList className="h-5 w-5" />} title={rowLabelOf(m, r) || 'รายละเอียด'}
      footer={<Button variant="secondary" onClick={onClose}>ปิด</Button>}>
      <div className="space-y-3 text-[15px]">
        <TitleBoxes m={m} r={r} big />
        <FieldBoxes m={m} r={r} big />
        {imgs.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {imgs.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line bg-ink/5"><img src={u} alt="" className="max-h-[60vh] w-full object-contain" /></a>)}
          </div>
        )}
        {canAck && (
          <div className="space-y-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50/60 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/10">
            <p className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-200"><CheckCheck className="h-4 w-4" />รับทราบ</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[220px] flex-1"><SearchSelect value={emp} onChange={(v) => setEmp(v)} options={options} placeholder="เลือกชื่อพนักงาน" searchPlaceholder="พิมพ์ชื่อเพื่อค้นหา…" /></div>
              <Button icon={<CheckCheck className="h-4 w-4" />} onClick={() => void doAck()} loading={busy} disabled={!emp} className="!bg-emerald-600 hover:!bg-emerald-700">รับทราบ</Button>
            </div>
            {list && list.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted">รับทราบแล้ว {new Set(list.map((a) => a.employeeName)).size} คน</p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm">
                  {list.slice(0, 50).map((a) => <li key={a.id} className="flex justify-between gap-2"><span>{a.employeeName}</span><span className="text-xs text-muted">{fmtDateTime(a.at)}</span></li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

const todayTh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

/** สรุปการรับทราบรายวัน: how many employees read that day, who, and which items */
export function AckSummary({ dashId, widgetId, onClose }: { dashId: string; widgetId: string; onClose: () => void }) {
  const [date, setDate] = useState(todayTh());
  const [list, setList] = useState<Ack[] | null>(null);
  useEffect(() => { setList(null); acksApi.ofDay(dashId, widgetId, date).then(setList).catch((e) => { toast.error(e); setList([]); }); }, [dashId, widgetId, date]);
  const people = useMemo(() => {
    const m = new Map<string, { name: string; items: Map<string, string>; count: number }>();
    for (const a of list ?? []) {
      const k = a.employeeId ?? a.employeeName;
      const p = m.get(k) ?? { name: a.employeeName, items: new Map(), count: 0 };
      p.count++;
      const label = a.rowLabel || a.rowId.slice(0, 8);
      if (!p.items.has(label) || a.at < p.items.get(label)!) p.items.set(label, a.at);
      m.set(k, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [list]);
  const items = new Set((list ?? []).map((a) => a.rowLabel || a.rowId)).size;
  return (
    <Modal open onClose={onClose} size="lg" icon={<Users className="h-5 w-5" />} title="สรุปการรับทราบรายวัน" footer={<Button variant="secondary" onClick={onClose}>ปิด</Button>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">วันที่<TextInput type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="mt-1 !h-10 w-44" /></label>
          <div className="flex gap-2">
            <div className="rounded-xl bg-emerald-50 px-4 py-2 text-center dark:bg-emerald-500/10"><p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{people.length}</p><p className="text-xs text-muted">คนที่อ่าน</p></div>
            <div className="rounded-xl bg-sky-50 px-4 py-2 text-center dark:bg-sky-500/10"><p className="text-2xl font-bold text-sky-700 dark:text-sky-300">{items}</p><p className="text-xs text-muted">รายการ</p></div>
            <div className="rounded-xl bg-ink/5 px-4 py-2 text-center"><p className="text-2xl font-bold">{list?.length ?? 0}</p><p className="text-xs text-muted">ครั้งที่กด</p></div>
          </div>
        </div>
        {list === null ? <p className="py-6 text-center text-sm text-muted">กำลังโหลด…</p> : !people.length ? <p className="py-6 text-center text-sm text-muted">ยังไม่มีใครรับทราบในวันนี้</p> : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-ink/[.03] text-xs text-muted"><tr><th className="px-3 py-2 text-left font-medium">พนักงาน</th><th className="px-3 py-2 text-left font-medium">รายการที่อ่าน (Sub Doc No · Short Code)</th></tr></thead>
              <tbody className="divide-y divide-line">
                {people.map((p) => (
                  <tr key={p.name} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{p.name}<span className="ml-1 text-xs text-muted">({p.items.size})</span></td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{[...p.items.entries()].map(([l, at]) => <span key={l} title={fmtDateTime(at)} className="rounded-md bg-sky-50 px-2 py-0.5 text-xs text-sky-800 dark:bg-sky-500/10 dark:text-sky-200">{l}</span>)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
