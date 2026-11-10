import { Fragment, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileSpreadsheet, Search } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { useDebounce } from '@/hooks';
import { displayValue, relTime } from '@/lib/format';
import type { Column } from '@/types';
import { DataHitGroup, DataSearchResult, dataSearchApi } from './api';

const SHOWN = 8;

/** the searched words in <mark> */
function Hi({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const low = text.toLowerCase();
  const t = q.toLowerCase();
  const out: JSX.Element[] = [];
  let at = 0;
  for (let i = low.indexOf(t); i >= 0 && out.length < 40; i = low.indexOf(t, i + t.length)) {
    out.push(<Fragment key={out.length}>{text.slice(at, i)}<mark className="rounded bg-warning/30 px-0.5 text-ink">{text.slice(i, i + t.length)}</mark></Fragment>);
    at = i + t.length;
  }
  return <>{out}{text.slice(at)}</>;
}

function Group({ g, q }: { g: DataHitGroup; q: string }) {
  const nav = useNavigate();
  const [all, setAll] = useState(false);
  const col = new Map(g.columns.map((c) => [c.id.toLowerCase(), c]));
  const rows = all ? g.rows : g.rows.slice(0, SHOWN);
  const show = (c: Column | undefined, v: unknown) => (c ? displayValue(c, (v ?? null) as never) : '');
  return (
    <section className="ds-card overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <FileSpreadsheet className="h-5 w-5 shrink-0" style={{ color: g.color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{g.fileName}<span className="font-normal text-muted"> › {g.sheetName}</span></p>
          <p className="truncate text-xs text-muted">{g.path}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{g.rows.length} แถว</span>
      </header>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const hit = r.matched.map((id) => col.get(id)).filter((c): c is Column => !!c);
          const others = g.columns.filter((c) => !r.matched.includes(c.id.toLowerCase())).slice(0, 3);
          return (
            <li key={r.id}>
              <button type="button" onClick={() => nav(`/files/${g.fileId}?sheet=${g.sheetId}&row=${r.id}`)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/[.04]">
                <span className="mt-0.5 shrink-0 rounded-md bg-ink/5 px-1.5 py-0.5 text-xs font-medium text-muted">#{r.order}</span>
                <span className="min-w-0 flex-1 space-y-1 text-sm">
                  {hit.map((c) => (
                    <span key={c.id} className="block"><span className="text-muted">{c.name}: </span><span className="font-medium"><Hi text={show(c, r.values[c.id])} q={q} /></span></span>
                  ))}
                  {!!others.length && (
                    <span className="block truncate text-xs text-muted">{others.map((c) => `${c.name}: ${show(c, r.values[c.id]) || '–'}`).join(' · ')}</span>
                  )}
                </span>
                <span className="hidden shrink-0 text-xs text-muted sm:block">{relTime(r.updatedAt)}</span>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
      {g.rows.length > SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="flex w-full items-center justify-center gap-1 border-t border-line py-2 text-sm font-medium text-primary hover:bg-primary/[.04]">
          <ChevronDown className={`h-4 w-4 transition-transform ${all ? 'rotate-180' : ''}`} />{all ? 'แสดงน้อยลง' : `ดูทั้งหมด ${g.rows.length} แถว`}
        </button>
      )}
    </section>
  );
}

/** Search mode "ค้นหาทุกข้อมูล": a word → every row of every sheet you can open that contains it */
export function DataSearch() {
  const [sp, setSp] = useSearchParams();
  const [text, setText] = useState(sp.get('q') ?? '');
  const dq = useDebounce(text.trim(), 450);
  const [data, setData] = useState<DataSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (dq.length < 2) { setData(null); setErr(''); return; }
    let live = true;
    setBusy(true); setErr('');
    const n = new URLSearchParams(sp); n.set('q', dq); n.delete('mode'); setSp(n, { replace: true });
    dataSearchApi.search(dq).then((r) => live && setData(r)).catch((e) => live && setErr(apiError(e).message)).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="ds-card p-4">
        <div className="flex gap-2">
          <TextInput icon={<Search />} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="พิมพ์คำที่ต้องการหา เช่น รหัสสินค้า เลขล็อต ชื่อคน (อย่างน้อย 2 ตัวอักษร)"
            className="min-w-0 flex-1" aria-label="คำที่ต้องการหา" />
          {text && <Button variant="secondary" onClick={() => setText('')}>ล้าง</Button>}
        </div>
        <p className="mt-2 text-xs text-muted">ค้นในทุกชีตของทุกไฟล์ที่คุณมีสิทธิ์เปิด (ทุกคอลัมน์) · กดผลลัพธ์เพื่อเปิดแถวนั้น</p>
      </div>
      {err && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      {busy && !data ? <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-theme" />)}</div>
        : !data ? <div className="ds-card"><EmptyState icon={<Search />} title="ค้นหาข้อมูลจากทุกไฟล์" description="พิมพ์คำที่ต้องการ ระบบจะแสดงทุกแถวในทุกชีตที่มีคำนั้น พร้อมบอกว่าอยู่ไฟล์ไหน โฟลเดอร์ไหน" /></div>
        : !data.groups.length ? <div className="ds-card"><EmptyState icon={<Search />} title={`ไม่พบ “${data.q}”`} description="ลองพิมพ์คำให้สั้นลง หรือตรวจตัวสะกด" /></div>
        : (
          <>
            <p className="text-sm text-muted">
              พบ <b className="text-ink">{data.total}</b> แถว ใน {data.groups.length} ชีต{data.truncated ? ' (แสดง 200 แถวล่าสุด — พิมพ์คำให้เจาะจงขึ้นเพื่อดูส่วนที่เหลือ)' : ''}{busy ? ' · กำลังค้นหา…' : ''}
            </p>
            <div className="space-y-3">{data.groups.map((g) => <Group key={g.sheetId} g={g} q={data.q} />)}</div>
          </>
        )}
    </div>
  );
}
