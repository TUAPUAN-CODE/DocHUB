import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BookOpen, ChevronLeft, ChevronRight, FileSpreadsheet, FolderOpen, Lightbulb, LayoutDashboard, Monitor, Printer, Rocket, Search, Share2,
  ShieldCheck, Smartphone, Sparkles, X, ZoomIn,
} from 'lucide-react';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useAuth } from '@/store/auth';
import { Annotated } from './Annotated';
import type { Guide, GuideManifest, GuideStep, GuideTopic } from './types';

const BASE = `${import.meta.env.BASE_URL}guide/`;
const ICONS: Record<string, ReactNode> = {
  rocket: <Rocket />, folder: <FolderOpen />, sheet: <FileSpreadsheet />, share: <Share2 />, sparkles: <Sparkles />,
  dashboard: <LayoutDashboard />, shield: <ShieldCheck />, phone: <Smartphone />, book: <BookOpen />,
};

let cache: GuideManifest | null = null;
function useManifest() {
  const [data, setData] = useState<GuideManifest | null>(cache);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (cache) return;
    fetch(`${BASE}manifest.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((m: GuideManifest) => { cache = m; setData(m); })
      .catch(() => setError(true));
  }, []);
  return { data, error };
}

/** topics / guides this user may see */
function useVisible(m: GuideManifest | null) {
  const role = useAuth((s) => s.user?.role) ?? 'viewer';
  return useMemo(() => (m?.topics ?? [])
    .filter((t) => !t.roles || t.roles.includes(role))
    .map((t) => ({ ...t, guides: t.guides.filter((g) => !g.roles || g.roles.includes(role)) }))
    .filter((t) => t.guides.length), [m, role]);
}

/** **bold** in guide text */
const rich = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i} className="font-semibold text-ink">{p.slice(2, -2)}</b> : p));

export default function GuidePage() {
  const { id } = useParams();
  const { data, error } = useManifest();
  const topics = useVisible(data);
  if (error) return <Page><div className="ds-card"><EmptyState icon={<BookOpen />} title="เปิดคู่มือไม่ได้" description="ไม่พบไฟล์คู่มือ (guide/manifest.json) กรุณาลองใหม่อีกครั้ง" /></div></Page>;
  if (!data) return <Page><div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-theme" />)}</div></Page>;
  if (!id) return <GuideIndex topics={topics} />;
  const flat = topics.flatMap((t) => t.guides.map((g) => ({ topic: t, guide: g })));
  const at = flat.findIndex((x) => x.guide.id === id);
  if (at < 0) return <Page><div className="ds-card"><EmptyState icon={<BookOpen />} title="ไม่พบคู่มือนี้" action={<Link to="/guide"><Button>กลับไปหน้ารวมคู่มือ</Button></Link>} /></div></Page>;
  return <GuideReader topic={flat[at].topic} guide={flat[at].guide} prev={flat[at - 1]?.guide} next={flat[at + 1]?.guide} />;
}

/* ---------------- index ---------------- */
function GuideIndex({ topics }: { topics: GuideTopic[] }) {
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const match = (g: Guide) => !s || [g.title, g.summary, ...g.steps.map((x) => `${x.title} ${x.text ?? ''}`)].join(' ').toLowerCase().includes(s);
  const shown = topics.map((t) => ({ ...t, guides: t.guides.filter(match) })).filter((t) => t.guides.length);
  const total = topics.reduce((n, t) => n + t.guides.length, 0);
  return (
    <Page>
      <PageHeader icon={<BookOpen />} title="คู่มือการใช้งาน" subtitle={`${total} เรื่อง · ทุกเรื่องมีภาพหน้าจอจริง พร้อมกรอบและลูกศรบอกว่าต้องกดตรงไหนทีละขั้นตอน`} />
      <TextInput icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาคู่มือ เช่น เพิ่มแถว, แชร์, Rev, รหัสผ่าน" className="mb-6 w-full sm:max-w-md" />
      {!shown.length && <div className="ds-card"><EmptyState icon={<Search />} title="ไม่พบคู่มือที่ตรงกับคำค้น" /></div>}
      <div className="space-y-8">
        {shown.map((t) => (
          <section key={t.id}>
            <div className="mb-3 flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&>svg]:h-5 [&>svg]:w-5">{ICONS[t.icon] ?? <BookOpen />}</span>
              <div className="min-w-0"><h2 className="text-lg font-semibold">{t.title}</h2><p className="text-sm text-muted">{t.description}</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {t.guides.map((g, i) => (
                <Link key={g.id} to={`/guide/${g.id}`} className="ds-card ds-card-pad group flex gap-3 transition-shadow hover:shadow-md">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink/5 text-sm font-semibold text-muted group-hover:bg-primary group-hover:text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium group-hover:text-primary">{g.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">{g.summary}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{g.steps.length} ขั้นตอน</span>
                      <span className="inline-flex items-center gap-1">{g.device === 'phone' ? <><Smartphone className="h-3.5 w-3.5" />มือถือ</> : <><Monitor className="h-3.5 w-3.5" />คอมพิวเตอร์</>}</span>
                      {g.roles && <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">{g.roles.includes('master') ? 'Master / Admin' : 'Admin'}</span>}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}

/* ---------------- reader ---------------- */
function GuideReader({ topic, guide, prev, next }: { topic: GuideTopic; guide: Guide; prev?: Guide; next?: Guide }) {
  const [zoom, setZoom] = useState<GuideStep | null>(null);
  const phone = guide.device === 'phone';
  useEffect(() => { document.getElementById('page-scroll')?.scrollTo({ top: 0 }); }, [guide.id]);
  const jump = (i: number) => document.getElementById(`step-${i + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="guide-doc min-h-full bg-[#E8ECF4] px-2 py-4 sm:px-6 sm:py-8 print:bg-white print:p-0">
      <div className="mx-auto flex max-w-[1200px] items-start gap-6">
        <article className="guide-paper mx-auto w-full min-w-0 max-w-[980px] rounded-2xl bg-white px-4 py-6 shadow-[0_8px_30px_rgba(15,23,42,.08)] sm:px-10 sm:py-10 print:max-w-none print:rounded-none print:px-0 print:py-0 print:shadow-none">
          <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted print:hidden">
            <Link to="/guide" className="hover:text-primary">คู่มือ</Link><ChevronRight className="h-3.5 w-3.5" /><span>{topic.title}</span>
          </nav>
          <header className="border-b-2 border-primary/20 pb-5">
            <p className="text-sm font-medium text-primary">{topic.title}</p>
            <h1 className="mt-1 text-2xl font-semibold leading-snug sm:text-3xl">{guide.title}</h1>
            <p className="mt-2 text-[15px] text-muted">{guide.summary}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className="rounded-full bg-ink/5 px-3 py-1">{guide.steps.length} ขั้นตอน</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-3 py-1">{phone ? <><Smartphone className="h-3.5 w-3.5" />ภาพจากมือถือ</> : <><Monitor className="h-3.5 w-3.5" />ภาพจากคอมพิวเตอร์</>}</span>
              {guide.roles && <span className="rounded-full bg-warning/15 px-3 py-1 font-medium text-warning">สำหรับ {guide.roles.includes('master') ? 'Master / Admin' : 'Admin'}</span>}
              <Button size="sm" variant="secondary" className="ml-auto print:hidden" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>พิมพ์ / บันทึก PDF</Button>
            </div>
          </header>

          {guide.steps.map((s, i) => (
            <section key={i} id={`step-${i + 1}`} className="guide-step scroll-mt-4 border-b border-line py-7 last:border-0">
              <div className="flex gap-3 sm:gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-[15px] font-bold text-white sm:h-10 sm:w-10">{i + 1}</span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">ขั้นตอนที่ {i + 1}</p>
                  <h2 className="mt-0.5 text-lg font-semibold leading-snug">{s.title}</h2>
                  {s.text && <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-ink/80">{rich(s.text)}</p>}
                </div>
              </div>
              {s.image && (
                <div className={phone ? 'mx-auto mt-5 max-w-[390px]' : 'mt-5'}>
                  <Annotated src={`${BASE}${s.image}`} w={s.w!} h={s.h!} marks={s.marks} phone={phone} onZoom={() => setZoom(s)} />
                  <button type="button" onClick={() => setZoom(s)} className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted hover:text-primary print:hidden"><ZoomIn className="h-3.5 w-3.5" />แตะภาพเพื่อขยาย</button>
                </div>
              )}
              {!!s.marks?.length && (
                <ol className="mt-4 space-y-2">
                  {s.marks.map((m, j) => (
                    <li key={j} className="flex gap-2.5 text-[15px] leading-relaxed">
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#E11D48] text-xs font-bold text-white">{j + 1}</span>
                      <span>{rich(m.label)}</span>
                    </li>
                  ))}
                </ol>
              )}
              {s.tip && (
                <div className="mt-4 flex gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm leading-relaxed">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><span>{rich(s.tip)}</span>
                </div>
              )}
            </section>
          ))}

          <footer className="mt-6 grid gap-3 sm:grid-cols-2 print:hidden">
            {prev ? (
              <Link to={`/guide/${prev.id}`} className="rounded-xl border border-line p-4 hover:border-primary hover:text-primary">
                <span className="flex items-center gap-1 text-xs text-muted"><ChevronLeft className="h-3.5 w-3.5" />เรื่องก่อนหน้า</span><span className="mt-1 block font-medium">{prev.title}</span>
              </Link>
            ) : <span />}
            {next ? (
              <Link to={`/guide/${next.id}`} className="rounded-xl border border-line p-4 text-right hover:border-primary hover:text-primary">
                <span className="flex items-center justify-end gap-1 text-xs text-muted">เรื่องถัดไป<ChevronRight className="h-3.5 w-3.5" /></span><span className="mt-1 block font-medium">{next.title}</span>
              </Link>
            ) : <Link to="/guide" className="rounded-xl border border-line p-4 text-right hover:border-primary hover:text-primary"><span className="text-xs text-muted">จบแล้ว</span><span className="mt-1 block font-medium">กลับไปหน้ารวมคู่มือ</span></Link>}
          </footer>
        </article>

        <aside className="sticky top-4 hidden w-60 shrink-0 2xl:block print:hidden">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">ขั้นตอน</p>
            <ol className="space-y-1">
              {guide.steps.map((s, i) => (
                <li key={i}><button type="button" onClick={() => jump(i)} className="flex w-full gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ink/5">
                  <span className="w-5 shrink-0 text-muted">{i + 1}.</span><span className="min-w-0">{s.title}</span>
                </button></li>
              ))}
            </ol>
            <Link to="/guide" className="mt-3 flex items-center gap-1 border-t border-line pt-3 text-sm text-muted hover:text-primary"><BookOpen className="h-4 w-4" />คู่มือทั้งหมด</Link>
          </div>
        </aside>
      </div>
      {zoom?.image && <Zoom step={zoom} phone={phone} onClose={() => setZoom(null)} />}
    </div>
  );
}

/** the picture at full size (pan on a phone) — closes from its ✕ only */
function Zoom({ step, phone, onClose }: { step: GuideStep; phone: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[950] flex flex-col bg-slate-900/90 print:hidden" role="dialog" aria-label="ภาพขยาย">
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <span className="min-w-0 flex-1 truncate font-medium">{step.title}</span>
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/15 hover:bg-white/25" aria-label="ปิด"><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mx-auto" style={{ width: phone ? Math.min(step.w! * 1.3, 560) : Math.max(step.w!, 0), maxWidth: phone ? '100%' : undefined }}>
          <Annotated src={`${BASE}${step.image}`} w={step.w!} h={step.h!} marks={step.marks} phone={phone} />
        </div>
      </div>
    </div>
  );
}
