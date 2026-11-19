import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, Eraser, FileDown, Maximize2, Minimize2, PieChart, Send, Settings2, Sparkles, Table2, TrendingUp, X } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Inputs';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { aiApi, CatAction, ChatMsg, Provider, ProviderInfo } from './api';
import { ChatChart, RichText } from './ChatParts';
import { runAiExport } from './exportData';
import { runPresentation } from './present';
import { AI_DASH_EVENT, useAiPanel } from './useAiPanel';

export const TOOL_TH: Record<string, string> = {
  list_files: 'ดูรายการไฟล์', get_sheet_schema: 'อ่านโครงสร้างตาราง', query_rows: 'อ่านตัวอย่างข้อมูล', aggregate: 'คำนวณสรุป', list_dashboards: 'ดูแดชบอร์ด',
  create_dashboard: 'สร้างแดชบอร์ด', add_widgets: 'เพิ่มกราฟลงแดชบอร์ด', find_items: 'ค้นหาชื่อ', describe_item: 'ดูรายละเอียด', open_page: 'เปิดหน้า',
  present_dashboard: 'นำเสนอแดชบอร์ด', show_chart: 'วาดกราฟ', export_data: 'ส่งออกไฟล์',
};
type Suggest = { icon: typeof BarChart3; text: string };
const SUGGEST_FILE: Suggest[] = [
  { icon: BarChart3, text: 'สรุปข้อมูลในไฟล์นี้เป็นกราฟให้หน่อย' }, { icon: PieChart, text: 'แยกสัดส่วนตามกลุ่มเป็นกราฟวงกลม' },
  { icon: FileDown, text: 'ส่งออก PDF ข้อมูลของเดือนนี้' }, { icon: Table2, text: 'มีค่าผิดปกติหรือข้อมูลว่างตรงไหนไหม' },
];
const SUGGEST_DASH: Suggest[] = [
  { icon: TrendingUp, text: 'สรุปแนวโน้มรายวันเป็นกราฟเส้น' }, { icon: BarChart3, text: 'เพิ่ม Pareto ของสาเหตุที่เกิดบ่อยที่สุดลงแดชบอร์ด' },
  { icon: FileDown, text: 'ส่งออก PDF ข้อมูลของเมื่อวาน' },
];
const SUGGEST_NONE: Suggest[] = [{ icon: Table2, text: 'ไฟล์ไหนที่ฉันเปิดได้บ้าง' }, { icon: BarChart3, text: 'ขอดูกราฟสรุปไฟล์ล่าสุดของฉัน' }];

/**
 * Right bar: chat with the AI (user's own API key). It reads data, draws charts in the chat, builds dashboards, opens pages and makes
 * PDF / Excel files — all through DocHUB tools with the user's own permissions. Can be expanded to full screen.
 */
export function AiPanel() {
  const { open, setOpen } = useAiPanel();
  const user = useAuth((s) => s.user);
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [sp] = useSearchParams();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<Provider>(() => (localStorage.getItem('ai:provider') as Provider) || 'gemini');
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState(false);
  const [full, setFull] = useState(() => { try { return localStorage.getItem('ai:full') === '1'; } catch { return false; } });
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const presentAbort = useRef<AbortController | null>(null);
  const histKey = `ai:chat:${user?.id}`;

  const ctx = useMemo(() => {
    const m = /^\/files\/([0-9a-f-]{36})(?:\/dashboards\/([0-9a-f-]{36}))?/i.exec(pathname);
    return { fileId: m?.[1] ?? null, dashboardId: m?.[2] ?? null, sheetId: sp.get('sheet') };
  }, [pathname, sp]);

  const toggleFull = () => setFull((v) => { const n = !v; try { localStorage.setItem('ai:full', n ? '1' : '0'); } catch { /* private mode */ } return n; });
  useEffect(() => { if (!open || !full) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, full]);

  const loadSettings = useCallback(async () => { try { setProviders((await aiApi.settings()).providers); } catch { /* panel still usable; the send reports the error */ } }, []);
  useEffect(() => { if (open) void loadSettings(); }, [open, loadSettings]);
  useEffect(() => { try { setMsgs(JSON.parse(localStorage.getItem(histKey) || '[]')); } catch { setMsgs([]); } }, [histKey]);
  useEffect(() => { try { localStorage.setItem(histKey, JSON.stringify(msgs.slice(-30))); } catch { /* storage full / blocked */ } end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs, histKey]);
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; }, [text, open, full]);

  /** things the AI asked the browser to do: open a page, start a presentation, make a PDF / Excel file */
  const doAction = useCallback((a: CatAction): ChatMsg['files'] | undefined => {
    if (a.type === 'open') { nav(a.to); toast.info(`เปิด “${a.label}” ให้แล้ว`); return undefined; }
    if (a.type === 'present') {
      presentAbort.current?.abort();
      const ac = new AbortController(); presentAbort.current = ac;
      const stop = () => ac.abort();
      window.addEventListener('cat:present-stop', stop);
      toast.info(`เริ่มนำเสนอ “${a.label}”`, 'กด Esc หรือปุ่ม “หยุด” เพื่อหยุด');
      void runPresentation({ fileId: a.fileId, dashboardId: a.dashboardId, filters: a.filters, navigate: nav, signal: ac.signal })
        .catch((e) => toast.error(apiError(e).message))
        .finally(() => window.removeEventListener('cat:present-stop', stop));
      return undefined;
    }
    toast.info(`กำลังสร้าง ${a.label}…`, `${a.total.toLocaleString()} แถว`);
    void runAiExport(a, user?.displayName ?? '').then((d) => toast.success('ไฟล์พร้อมแล้ว', d)).catch((e) => toast.error(apiError(e).message || (e as Error).message));
    return [{ label: a.label, rows: a.total }];
  }, [nav, user?.displayName]);

  const cur = providers.find((p) => p.provider === provider);
  const send = async (t = text) => {
    const content = t.trim();
    if (!content || busy) return;
    if (cur && !cur.hasKey) { setCfg(true); return toast.error('ใส่ API key ก่อนใช้งาน'); }
    const next: ChatMsg[] = [...msgs, { role: 'user', content }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await aiApi.chat(provider, next.slice(-20), ctx);
      const files = (r.actions ?? []).flatMap((a) => doAction(a) ?? []);
      setMsgs([...next, { role: 'assistant', content: r.reply || '(ไม่มีข้อความตอบกลับ)', steps: r.steps, charts: r.charts?.length ? r.charts : undefined, files: files.length ? files : undefined }]);
      for (const id of r.changedDashboards) window.dispatchEvent(new CustomEvent(AI_DASH_EVENT, { detail: { dashboardId: id } }));
    } catch (e) { setMsgs([...next, { role: 'assistant', content: `⚠ ${apiError(e).message}` }]); } finally { setBusy(false); }
  };

  if (!open) return null;
  const suggestions = ctx.dashboardId ? SUGGEST_DASH : ctx.fileId ? SUGGEST_FILE : SUGGEST_NONE;
  const first = (user?.displayName ?? '').split(' ')[0];
  return (
    <aside
      className={cn(full ? 'fixed inset-0 z-[80] bg-black/25 p-2 backdrop-blur-sm sm:p-6' : 'fixed inset-y-0 right-0 z-40 w-full p-2 sm:w-[430px] lg:static lg:z-auto lg:shrink-0 lg:p-3 lg:pl-0')}
      aria-label="ผู้ช่วย AI"
    >
      <div className={cn('ds-modal flex h-full min-h-0 flex-col overflow-hidden', full && 'mx-auto w-full max-w-5xl')}>
        <header className="flex shrink-0 items-center gap-2.5 px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white shadow-lg" style={{ background: 'linear-gradient(135deg, rgb(var(--c-primary)), #8B5CF6)' }}><Sparkles className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1 leading-tight">
            <h2 className="truncate text-[15px] font-semibold">ผู้ช่วย AI</h2>
            <p className="truncate text-[11.5px] text-muted">{ctx.dashboardId ? 'กำลังดูแดชบอร์ด' : ctx.fileId ? 'กำลังดูไฟล์นี้' : 'ถามข้อมูล · วาดกราฟ · ส่งออก PDF'}</p>
          </div>
          <IconButton label={full ? 'ย่อกลับ' : 'ขยายเต็มจอ'} onClick={toggleFull}>{full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</IconButton>
          <IconButton label="ปิด" onClick={() => { setOpen(false); setFull(false); }}><X className="h-4 w-4" /></IconButton>
        </header>
        <div className="flex shrink-0 items-center gap-1.5 px-4 pb-2">
          <Select value={provider} onChange={(e) => { setProvider(e.target.value as Provider); localStorage.setItem('ai:provider', e.target.value); }} className="!h-8 !w-auto max-w-[11rem] flex-1 !rounded-full !text-xs" aria-label="ผู้ให้บริการ AI">
            {providers.map((p) => <option key={p.provider} value={p.provider}>{p.provider === 'gemini' ? 'Gemini' : p.provider === 'anthropic' ? 'Claude' : 'OpenAI'}{p.hasKey ? '' : ' (ยังไม่ตั้งค่า)'}</option>)}
          </Select>
          <IconButton label="ตั้งค่า API key" onClick={() => setCfg((v) => !v)}><Settings2 className="h-4 w-4" /></IconButton>
          <IconButton label="ล้างแชต" onClick={() => setMsgs([])}><Eraser className="h-4 w-4" /></IconButton>
        </div>
        {cfg && cur && <KeyForm info={cur} onDone={() => { setCfg(false); void loadSettings(); }} />}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <div className={cn('mx-auto space-y-3.5', full ? 'max-w-3xl' : 'max-w-full')}>
            {!msgs.length && (
              <div className="flex flex-col items-center gap-4 pb-2 pt-8 text-center">
                <span className="grid h-16 w-16 place-items-center rounded-[22px] text-white shadow-xl" style={{ background: 'linear-gradient(135deg, rgb(var(--c-primary)), #8B5CF6)' }}><Sparkles className="h-8 w-8" /></span>
                <div>
                  <p className="text-lg font-semibold">{first ? `สวัสดี คุณ${first}` : 'สวัสดี'} 👋</p>
                  <p className="mt-1 text-sm text-muted">ถามเรื่องข้อมูล ขอกราฟสรุปในแชต สั่งสร้างแดชบอร์ด หรือขอไฟล์ PDF / Excel ได้เลย</p>
                </div>
                <div className={cn('grid w-full gap-2', full ? 'sm:grid-cols-2' : '')}>
                  {suggestions.map(({ icon: Ic, text: s }) => (
                    <button key={s} type="button" onClick={() => void send(s)} className="ds-card flex items-center gap-3 !rounded-2xl px-3.5 py-2.5 text-left text-sm transition hover:-translate-y-px hover:border-primary/50">
                      <Ic className="h-4 w-4 shrink-0 text-primary" /><span>{s}</span>
                    </button>
                  ))}
                </div>
                <p className="max-w-sm text-[11.5px] leading-relaxed text-muted">AI อ่านข้อมูลผ่านเครื่องมือของระบบด้วยสิทธิ์ของคุณเท่านั้น — เฉพาะข้อมูลที่ AI ขอดู (ตัวอย่างแถว / ตัวเลขสรุป) จะถูกส่งไปยังผู้ให้บริการที่คุณเลือก</p>
              </div>
            )}
            {msgs.map((m, i) => (m.role === 'user'
              ? <div key={i} className="flex justify-end"><div className="max-w-[88%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg px-4 py-2.5 text-sm text-white shadow-md" style={{ background: 'linear-gradient(135deg, rgb(var(--c-primary)), #6D5BF0)' }}>{m.content}</div></div>
              : (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary"><Sparkles className="h-4 w-4" /></span>
                  <div className="ds-card min-w-0 max-w-[calc(100%-2.5rem)] flex-1 !rounded-3xl !rounded-tl-lg px-4 py-3 text-sm">
                    {m.steps?.length ? <div className="mb-2 flex flex-wrap gap-1">{m.steps.map((s, k) => <span key={k} className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', s.ok ? 'bg-emerald-500/12 text-emerald-700' : 'bg-red-500/12 text-red-700')}>{s.ok ? '✓' : '✗'} {TOOL_TH[s.tool] ?? s.tool}</span>)}</div> : null}
                    <RichText text={m.content} />
                    {m.charts?.map((c, k) => <ChatChart key={k} c={c} tall={full} />)}
                    {m.files?.map((f, k) => <p key={k} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><FileDown className="h-3.5 w-3.5" />{f.label} · {f.rows.toLocaleString()} แถว — ดาวน์โหลดอัตโนมัติ</p>)}
                  </div>
                </div>
              )))}
            {busy && (
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary"><Sparkles className="h-4 w-4 animate-pulse" /></span>
                <div className="ds-card flex items-center gap-1.5 !rounded-3xl px-4 py-3" aria-label="กำลังคิด">{[0, 1, 2].map((d) => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-primary/70" style={{ animationDelay: `${d * 0.15}s` }} />)}</div>
              </div>
            )}
            <div ref={end} />
          </div>
        </div>

        <footer className="shrink-0 px-4 pb-4 pt-1">
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className={cn('mx-auto flex items-end gap-2', full && 'max-w-3xl')}>
            <textarea
              ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
              placeholder={ctx.dashboardId ? 'บอกว่าต้องการกราฟอะไร / ให้นำเสนอ…' : 'พิมพ์คำถาม / คำสั่ง เช่น “สรุปเป็นกราฟ”, “ส่งออก PDF”…'}
              className="ds-input min-h-[44px] flex-1 resize-none !rounded-3xl px-4 py-2.5 text-[16px] sm:text-sm" aria-label="ข้อความถึง AI"
            />
            <Button type="submit" disabled={!text.trim()} loading={busy} aria-label="ส่ง" className="!h-11 !w-11 shrink-0 !rounded-full !p-0"><Send className="h-4 w-4" /></Button>
          </form>
          <p className="mx-auto mt-1.5 max-w-3xl px-2 text-center text-[10.5px] text-muted">Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่{full ? ' · Esc ย่อกลับ' : ''}</p>
        </footer>
      </div>
    </aside>
  );
}

function KeyForm({ info, onDone }: { info: ProviderInfo; onDone: () => void }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(info.model ?? '');
  const [base, setBase] = useState(info.baseUrl ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setKey(''); setModel(info.model ?? ''); setBase(info.baseUrl ?? ''); }, [info]);
  const save = async () => {
    setBusy(true);
    try { await aiApi.save(info.provider, { apiKey: key || undefined, model: model || null, baseUrl: info.provider === 'openai' ? base || null : null }); toast.success('บันทึก API key แล้ว'); onDone(); }
    catch (e) { toast.error(apiError(e).message); } finally { setBusy(false); }
  };
  const del = async () => { await aiApi.remove(info.provider).catch((e) => toast.error(apiError(e).message)); onDone(); };
  return (
    <div className="mx-4 mb-2 space-y-2 rounded-2xl border border-line bg-ink/[.03] p-3">
      <p className="text-xs font-medium">{info.label}</p>
      <Field label={info.hasKey ? 'API key (ว่าง = ใช้ตัวเดิม)' : 'API key'}><TextInput type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder={info.hasKey ? '•••••••• บันทึกไว้แล้ว' : 'วาง API key'} /></Field>
      <Field label={`โมเดล (ว่าง = ใช้ค่าเริ่มต้น ${info.defaultModel} แนะนำให้เว้นว่าง)`}><TextInput value={model} onChange={(e) => setModel(e.target.value)} /></Field>
      {info.provider === 'openai' && <Field label={`Base URL (ว่าง = ${info.defaultBaseUrl})`}><TextInput value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.groq.com/openai/v1" /></Field>}
      <div className="flex gap-2"><Button size="sm" onClick={() => void save()} loading={busy} disabled={!key && !info.hasKey}>บันทึก</Button>{info.hasKey && <Button size="sm" variant="secondary" onClick={() => void del()}>ลบ key</Button>}</div>
      <p className="text-[11px] text-muted">key เก็บแบบเข้ารหัสบนเซิร์ฟเวอร์ ไม่ส่งกลับมาที่เบราว์เซอร์ ใช้ได้เฉพาะบัญชีคุณ</p>
    </div>
  );
}
