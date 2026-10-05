import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Bot, Eraser, Send, Settings2, Sparkles, X } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Inputs';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { aiApi, ChatMsg, Provider, ProviderInfo } from './api';
import { AI_DASH_EVENT, useAiPanel } from './useAiPanel';

const TOOL_TH: Record<string, string> = { list_files: 'ดูรายการไฟล์', get_sheet_schema: 'อ่านโครงสร้างตาราง', query_rows: 'อ่านตัวอย่างข้อมูล', aggregate: 'คำนวณสรุป', list_dashboards: 'ดูแดชบอร์ด', create_dashboard: 'สร้างแดชบอร์ด', add_widgets: 'เพิ่มกราฟ' };
const SUGGEST_FILE = ['สรุปข้อมูลในไฟล์นี้ให้หน่อย', 'มีค่าผิดปกติหรือข้อมูลว่างตรงไหนไหม'];
const SUGGEST_DASH = ['สร้างกราฟสรุปยอดรวมรายวัน พร้อม KPI ยอดรวม', 'เพิ่ม Pareto ของสาเหตุที่เกิดบ่อยที่สุด'];

/** Right bar: chat with the AI (user's own API key). It reads data and builds dashboards through DocHUB tools, with the user's permissions. */
export function AiPanel() {
  const { open, setOpen } = useAiPanel();
  const user = useAuth((s) => s.user);
  const { pathname } = useLocation();
  const [sp] = useSearchParams();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [provider, setProvider] = useState<Provider>(() => (localStorage.getItem('ai:provider') as Provider) || 'gemini');
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const histKey = `ai:chat:${user?.id}`;

  const ctx = useMemo(() => {
    const m = /^\/files\/([0-9a-f-]{36})(?:\/dashboards\/([0-9a-f-]{36}))?/i.exec(pathname);
    return { fileId: m?.[1] ?? null, dashboardId: m?.[2] ?? null, sheetId: sp.get('sheet') };
  }, [pathname, sp]);

  const loadSettings = useCallback(async () => { try { setProviders((await aiApi.settings()).providers); } catch { /* panel still usable; the send reports the error */ } }, []);
  useEffect(() => { if (open) void loadSettings(); }, [open, loadSettings]);
  useEffect(() => { try { setMsgs(JSON.parse(localStorage.getItem(histKey) || '[]')); } catch { setMsgs([]); } }, [histKey]);
  useEffect(() => { try { localStorage.setItem(histKey, JSON.stringify(msgs.slice(-30))); } catch { /* storage full / blocked */ } end.current?.scrollIntoView({ block: 'end' }); }, [msgs, histKey]);

  const cur = providers.find((p) => p.provider === provider);
  const send = async (t = text) => {
    const content = t.trim();
    if (!content || busy) return;
    if (cur && !cur.hasKey) { setCfg(true); return toast.error('ใส่ API key ก่อนใช้งาน'); }
    const next: ChatMsg[] = [...msgs, { role: 'user', content }];
    setMsgs(next); setText(''); setBusy(true);
    try {
      const r = await aiApi.chat(provider, next.slice(-20), ctx);
      setMsgs([...next, { role: 'assistant', content: r.reply || '(ไม่มีข้อความตอบกลับ)', steps: r.steps }]);
      for (const id of r.changedDashboards) window.dispatchEvent(new CustomEvent(AI_DASH_EVENT, { detail: { dashboardId: id } }));
    } catch (e) { setMsgs([...next, { role: 'assistant', content: `⚠ ${apiError(e).message}` }]); } finally { setBusy(false); }
  };

  if (!open) return null;
  const suggestions = ctx.dashboardId ? SUGGEST_DASH : ctx.fileId ? SUGGEST_FILE : ['ไฟล์ไหนที่ฉันเปิดได้บ้าง'];
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-2xl sm:w-[400px] lg:static lg:z-auto lg:shadow-none" aria-label="ผู้ช่วย AI">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-3">
        <Sparkles className="h-5 w-5 text-primary" /><h2 className="flex-1 text-[15px] font-semibold">ผู้ช่วย AI</h2>
        <Select value={provider} onChange={(e) => { setProvider(e.target.value as Provider); localStorage.setItem('ai:provider', e.target.value); }} className="!h-8 max-w-[9.5rem] !text-xs">
          {providers.map((p) => <option key={p.provider} value={p.provider}>{p.provider === 'gemini' ? 'Gemini' : p.provider === 'anthropic' ? 'Claude' : 'OpenAI-compat'}{p.hasKey ? '' : ' (ยังไม่ตั้งค่า)'}</option>)}
        </Select>
        <IconButton label="ตั้งค่า API key" onClick={() => setCfg((v) => !v)}><Settings2 className="h-4 w-4" /></IconButton>
        <IconButton label="ล้างแชต" onClick={() => setMsgs([])}><Eraser className="h-4 w-4" /></IconButton>
        <IconButton label="ปิด" onClick={() => setOpen(false)}><X className="h-4 w-4" /></IconButton>
      </header>
      {cfg && cur && <KeyForm info={cur} onDone={() => { setCfg(false); void loadSettings(); }} />}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!msgs.length && (
          <div className="space-y-3 text-sm text-muted">
            <div className="flex items-center gap-2 text-ink"><Bot className="h-5 w-5" />ถามเรื่องข้อมูล หรือสั่งสร้างแดชบอร์ดได้เลย</div>
            <p className="text-xs">AI อ่านข้อมูลผ่านเครื่องมือของระบบด้วยสิทธิ์ของคุณเท่านั้น — เฉพาะข้อมูลที่ AI ขอดู (ตัวอย่างแถว / ตัวเลขสรุป) จะถูกส่งไปยังผู้ให้บริการที่คุณเลือก</p>
            {suggestions.map((s) => <button key={s} type="button" onClick={() => void send(s)} className="block w-full rounded-xl border border-line px-3 py-2 text-left text-sm text-ink hover:border-primary/40">{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn('max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm', m.role === 'user' ? 'ml-auto bg-primary text-white' : 'bg-ink/[.05]')}>
            {m.steps?.length ? <p className="mb-1 text-[11px] opacity-60">{m.steps.map((s) => `${s.ok ? '✓' : '✗'} ${TOOL_TH[s.tool] ?? s.tool}`).join(' · ')}</p> : null}
            {m.content}
          </div>
        ))}
        {busy && <div className="w-fit rounded-2xl bg-ink/[.05] px-3 py-2 text-sm text-muted">กำลังคิด / ทำงาน…</div>}
        <div ref={end} />
      </div>
      <footer className="shrink-0 border-t border-line p-3">
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2">
          <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder={ctx.dashboardId ? 'บอกว่าต้องการกราฟอะไร…' : 'พิมพ์คำถาม / คำสั่ง…'} disabled={busy} />
          <Button type="submit" disabled={!text.trim()} loading={busy} aria-label="ส่ง"><Send className="h-4 w-4" /></Button>
        </form>
      </footer>
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
    <div className="space-y-2 border-b border-line bg-ink/[.03] p-3">
      <p className="text-xs font-medium">{info.label}</p>
      <Field label={info.hasKey ? 'API key (ว่าง = ใช้ตัวเดิม)' : 'API key'}><TextInput type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder={info.hasKey ? '•••••••• บันทึกไว้แล้ว' : 'วาง API key'} /></Field>
      <Field label={`โมเดล (ว่าง = ${info.defaultModel})`}><TextInput value={model} onChange={(e) => setModel(e.target.value)} /></Field>
      {info.provider === 'openai' && <Field label={`Base URL (ว่าง = ${info.defaultBaseUrl})`}><TextInput value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.groq.com/openai/v1" /></Field>}
      <div className="flex gap-2"><Button size="sm" onClick={() => void save()} loading={busy} disabled={!key && !info.hasKey}>บันทึก</Button>{info.hasKey && <Button size="sm" variant="secondary" onClick={() => void del()}>ลบ key</Button>}</div>
      <p className="text-[11px] text-muted">key เก็บแบบเข้ารหัสบนเซิร์ฟเวอร์ ไม่ส่งกลับมาที่เบราว์เซอร์ ใช้ได้เฉพาะบัญชีคุณ</p>
    </div>
  );
}
