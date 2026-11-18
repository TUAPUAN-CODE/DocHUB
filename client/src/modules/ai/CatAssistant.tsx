import { Component, ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Eraser, FileText, Folder, LayoutDashboard, Mic, Send, Settings2, Square, X } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { useUi } from '@/store/ui';
import { aiApi, CatAction, ChatMsg } from './api';
import { runPresentation } from './present';
import type { CatEmotion } from './CatScene';
import { AI_DASH_EVENT, useAiPanel } from './useAiPanel';
import { AI_DRAG_MIME, AiItem, readAiItem } from './dragItem';
import { startLive } from './liveVoice';

const CatScene = lazy(() => import('./CatScene'));

/** WebGL missing / the 3D model failed: the assistant still works with a plain face */
class Safe extends Component<{ fallback: ReactNode; children: ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  componentDidCatch(e: unknown) { console.error('[cat] 3D scene failed', e); }
  render() { return this.state.bad ? this.props.fallback : this.props.children; }
}

const SAY: Record<CatEmotion, string> = {
  happy: 'เหมียว~ สวัสดีครับ! มีข้อมูล QC หรือเอกสารส่วนไหนให้ช่วยไหมครับ?',
  talking: 'กำลังสรุปข้อมูลและตรวจสอบรายการให้คุณอยู่นะครับ...',
  thinking: 'อืมมม... ขอเวลาน้องแมวประมวลผลข้อมูลสักครู่นะครับ 🤔',
  excited: 'เย้! ทำเสร็จเรียบร้อยแล้วครับ! 🎉',
  love: 'ขอบคุณที่ใช้งานนะครับ มีอะไรเรียกน้องแมวได้เสมอเลยเมี๊ยว~ 💕',
  playful: 'แบร่~ ทำงานเหนื่อยแล้ว อย่าลืมพักสายตาบ้างนะครับ 😜',
  surprised: 'เหวอ!! เจอสิ่งที่ผิดปกติครับ! 🙀',
  sleepy: 'หาววว... เริ่มง่วงนิดหน่อย แต่ยังพร้อมสแตนด์บายครับ 😴',
  sleeping: 'คร่อกฟี้... zZzZ (คลิกที่ตัวน้องแมวเพื่อปลุกได้นะครับ)',
  sad: 'ขอโทษนะครับ ทำรายการนี้ไม่สำเร็จ 😿',
  angry: 'แง่ง! ข้อมูลไม่ตรงตามมาตรฐาน ต้องรีบแก้ไขด่วนเลยครับ!',
  furious: 'ฟ่อออ!! ระบบผิดพลาดซ้ำซ้อนจนหัวร้อนแล้วนะ!! 🔥',
};
const DOT: Record<CatEmotion, string> = { happy: '#10b981', talking: '#38bdf8', thinking: '#f59e0b', excited: '#10b981', love: '#ec4899', playful: '#8b5cf6', surprised: '#eab308', sleepy: '#818cf8', sleeping: '#a78bfa', sad: '#60a5fa', angry: '#f97316', furious: '#ef4444' };

/** The models the user can pick; each has a model id the user can change (ids are Google's, they change with releases) */
interface ModelDef { key: 'think' | 'carbon' | 'embed'; label: string; id: string; liveId?: string; chat: boolean; hint: string }
const DEFAULT_MODELS: ModelDef[] = [
  { key: 'think', label: 'Gemini 3.8 Live Extended Thinking', id: 'gemini-3.8-flash', liveId: 'gemini-3.8-live', chat: true, hint: 'พิมพ์คุยใช้ ID แรก, คุยด้วยเสียงใช้ Live ID (gemini-3.8-live = อ่านข้อมูลระบบได้ / gemini-3.8-live-extended-thinking = คิดลึกที่สุด แต่ยังอ่านข้อมูลระบบด้วยเสียงไม่ได้)' },
  { key: 'carbon', label: 'Gemini 4 Carbon', id: 'gemini-4-carbon', chat: true, hint: 'รุ่นใหม่ (พิมพ์คุย)' },
  { key: 'embed', label: 'Embedding 2', id: 'gemini-embedding-2', chat: false, hint: 'ใช้ช่วยค้นหา/จับความหมาย — ยังไม่เปิดใช้ในแชต' },
];
const MODELS_KEY = 'cat:models';
const loadModels = (): ModelDef[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(MODELS_KEY) || '{}') as Record<string, string>;
    return DEFAULT_MODELS.map((m) => ({ ...m, id: typeof saved[m.key] === 'string' && saved[m.key] ? saved[m.key] : m.id, liveId: m.liveId ? (saved[`${m.key}:live`] || m.liveId) : undefined }));
  } catch { return DEFAULT_MODELS; }
};
const VOICES = [['Aoede', 'Aoede (หญิง นุ่ม)'], ['Kore', 'Kore (หญิง)'], ['Leda', 'Leda (หญิง สดใส)'], ['Zephyr', 'Zephyr (สดใส)'], ['Puck', 'Puck (ชาย ร่าเริง)'], ['Charon', 'Charon (ชาย นุ่ม)'], ['Fenrir', 'Fenrir (ชาย)'], ['Orus', 'Orus (ชาย)']] as const;

const KIND_ICON = { file: FileText, folder: Folder, dashboard: LayoutDashboard } as const;
const IDLE_SLEEPY_MS = 90_000, IDLE_SLEEP_MS = 240_000;

/**
 * The AI assistant: a 3D cat at the bottom right (only for the roles that may use AI — จัดการสิทธิ์ › ผู้ช่วย AI).
 * Click the cat to chat; drag a file / folder / dashboard card from the web onto it to ask about it. The face follows what happens.
 */
export function CatAssistant() {
  const user = useAuth((s) => s.user);
  const panelOpen = useAiPanel((s) => s.open);
  const setPanel = useAiPanel((s) => s.setOpen);
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [emotion, setEmotion] = useState<CatEmotion>('happy');
  const [said, setSaid] = useState(SAY.happy);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelDef[]>(loadModels);
  const [modelKey, setModelKey] = useState<ModelDef['key']>(() => (localStorage.getItem('cat:model') as ModelDef['key']) || 'think');
  const [cfg, setCfg] = useState(false);
  const [items, setItems] = useState<AiItem[]>([]);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [over, setOver] = useState(false);
  const catVisible = useUi((s) => s.catVisible);
  const [voice, setVoice] = useState(() => localStorage.getItem('cat:voice') || 'Aoede');
  const [thinking, setThinking] = useState(() => localStorage.getItem('cat:thinking') || 'low');
  const [live, setLive] = useState<'off' | 'connecting' | 'listening' | 'speaking'>('off');
  const [liveErr, setLiveErr] = useState('');
  const [scale, setScale] = useState(() => { const v = Number(localStorage.getItem('cat:scale')); return v >= 0.6 && v <= 2.2 ? v : 1; });
  const changeScale = (v: number) => { const n = Math.min(2.2, Math.max(0.6, Math.round(v * 10) / 10)); setScale(n); try { localStorage.setItem('cat:scale', String(n)); } catch { /* private mode */ } };
  const session = useRef<Awaited<ReturnType<typeof startLive>> | null>(null);
  const turn = useRef({ user: '', cat: '' });
  const [presenting, setPresenting] = useState<string | null>(null);
  const presentAbort = useRef<AbortController | null>(null);
  const turnWaiter = useRef<(() => void) | null>(null);
  const presentingRef = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const idle = useRef<number[]>([]);
  const histKey = `cat:chat:${user?.id}`;

  const ctx = useMemo(() => {
    const m = /^\/files\/([0-9a-f-]{36})(?:\/dashboards\/([0-9a-f-]{36}))?/i.exec(pathname);
    return { fileId: m?.[1] ?? null, dashboardId: m?.[2] ?? null, sheetId: sp.get('sheet') };
  }, [pathname, sp]);

  const feel = useCallback((e: CatEmotion, say?: string) => { setEmotion(e); setSaid(say ?? SAY[e]); }, []);
  // other parts of the app can make the cat react: window.dispatchEvent(new CustomEvent('cat:emotion', { detail: { emotion: 'excited', say: '…' } }))
  useEffect(() => {
    let back = 0;
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ emotion: CatEmotion; say?: string }>).detail;
      if (!d?.emotion || !(d.emotion in SAY)) return;
      feel(d.emotion, d.say); touchRef.current();
      window.clearTimeout(back); back = window.setTimeout(() => setEmotion((c) => (c === d.emotion ? 'happy' : c)), 7000);
    };
    window.addEventListener('cat:emotion', h);
    return () => { window.removeEventListener('cat:emotion', h); window.clearTimeout(back); };
  }, [feel]);
  // no activity for a while: sleepy, then asleep (any interaction wakes the cat)
  const touchRef = useRef<() => void>(() => undefined);
  const touch = useCallback(() => {
    idle.current.forEach((t) => window.clearTimeout(t));
    idle.current = [window.setTimeout(() => feel('sleepy'), IDLE_SLEEPY_MS), window.setTimeout(() => feel('sleeping'), IDLE_SLEEP_MS)];
  }, [feel]);
  touchRef.current = touch;
  useEffect(() => { touch(); return () => idle.current.forEach((t) => window.clearTimeout(t)); }, [touch]);

  useEffect(() => { try { setMsgs(JSON.parse(localStorage.getItem(histKey) || '[]')); } catch { setMsgs([]); } }, [histKey]);
  useEffect(() => { try { localStorage.setItem(histKey, JSON.stringify(msgs.slice(-30))); } catch { /* storage full / blocked */ } end.current?.scrollIntoView({ block: 'end' }); }, [msgs, histKey]);
  useEffect(() => { if (open) aiApi.settings().then((r) => setHasKey(!!r.providers.find((p) => p.provider === 'gemini')?.hasKey)).catch(() => setHasKey(null)); }, [open]);

  const model = models.find((m) => m.key === modelKey) ?? models[0];
  const saveModelId = (key: ModelDef['key'], id: string, live = false) => {
    const next = models.map((m) => (m.key === key ? (live ? { ...m, liveId: id.trim() } : { ...m, id: id.trim() }) : m));
    setModels(next);
    try { localStorage.setItem(MODELS_KEY, JSON.stringify(Object.fromEntries(next.flatMap((m) => [[m.key, m.id], ...(m.liveId ? [[`${m.key}:live`, m.liveId]] : [])])))); } catch { /* private mode */ }
  };

  const send = async (t = text) => {
    const content = t.trim();
    if (!content || busy) return;
    if (!model.chat) return feel('surprised', 'โมเดลนี้ใช้แชตไม่ได้ครับ เลือก Gemini ตัวอื่นก่อนนะ');
    if (!model.id) { setCfg(true); return feel('surprised', 'ยังไม่ได้ใส่ Model ID ของโมเดลนี้ครับ — กดฟันเฟืองเพื่อใส่'); }
    touch();
    const next: ChatMsg[] = [...msgs, { role: 'user', content }];
    setMsgs(next); setText(''); setBusy(true); feel('thinking');
    try {
      const r = await aiApi.chat('gemini', next.slice(-20), ctx, { model: model.id, thinking: thinking as 'low' | 'medium' | 'high', attachments: items });
      const reply = r.reply || '(ไม่มีข้อความตอบกลับ)';
      setMsgs([...next, { role: 'assistant', content: reply, steps: r.steps }]);
      for (const id of r.changedDashboards) window.dispatchEvent(new CustomEvent(AI_DASH_EVENT, { detail: { dashboardId: id } }));
      for (const a of r.actions ?? []) doAction(a);
      const allFailed = r.steps.length > 0 && r.steps.every((s) => !s.ok);
      if (allFailed) feel('surprised', reply.slice(0, 160));
      else if (r.changedDashboards.length) feel('excited', reply.slice(0, 160));
      else feel('talking', reply.slice(0, 160));
      window.setTimeout(() => setEmotion((e) => (e === 'talking' || e === 'excited' || e === 'surprised' ? 'happy' : e)), Math.min(9000, 1800 + reply.length * 35));
    } catch (e) {
      const m = apiError(e).message;
      setMsgs([...next, { role: 'assistant', content: `⚠ ${m}` }]);
      feel(/429|503|หนาแน่น|ถี่เกินไป/.test(m) ? 'sleepy' : 'sad', m.slice(0, 160));
    } finally { setBusy(false); }
  };

  const stopPresent = useCallback(() => { presentAbort.current?.abort(); presentAbort.current = null; presentingRef.current = false; setPresenting(null); turnWaiter.current?.(); }, []);
  useEffect(() => { window.addEventListener('cat:present-stop', stopPresent); return () => window.removeEventListener('cat:present-stop', stopPresent); }, [stopPresent]);
  // Esc stops a presentation too
  useEffect(() => { if (!presenting) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') stopPresent(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [presenting, stopPresent]);

  /** things the AI asked the browser to do: open a page, present a dashboard */
  const doAction = useCallback((a: CatAction) => {
    if (a.type === 'open') { nav(a.to); feel('happy', `เปิด “${a.label}” ให้แล้วนะ`); return; }
    if (a.type !== 'present') return;
    stopPresent();
    const ac = new AbortController(); presentAbort.current = ac; presentingRef.current = true; setPresenting(a.label); feel('excited', `เริ่มนำเสนอ “${a.label}” นะ`);
    const m = models.find((x) => x.key === modelKey) ?? models[0];
    const speak = session.current
      ? (text: string) => new Promise<void>((ok) => {
          const s = session.current; if (!s) { ok(); return; }
          const before = s.played(), t0 = Date.now();
          let fell = false;
          const finish = () => { window.clearInterval(iv); ok(); };
          const iv = window.setInterval(() => {
            if (ac.signal.aborted) { window.speechSynthesis?.cancel(); finish(); return; }
            const started = s.played() > before;
            if (started && s.quiet()) { finish(); return; }
            if (!started && !fell && Date.now() - t0 > 8000) { // the voice model stayed silent: read the line with the browser's own voice
              fell = true;
              try {
                const u = new SpeechSynthesisUtterance(text); u.lang = 'th-TH'; u.onend = finish; u.onerror = finish;
                window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
              } catch (e) { console.error('speechSynthesis error:', e); finish(); }
            }
            if (Date.now() - t0 > 60_000) finish();
          }, 250);
          s.sendText(`[ระบบ] อ่านออกเสียงข้อความนี้ตามที่เขียน ไม่ต้องเพิ่มหรือเปลี่ยนคำ และไม่ต้องถามต่อ: ${text}`);
        })
      : undefined;
    void runPresentation({ fileId: a.fileId, dashboardId: a.dashboardId, filters: a.filters, model: m.id, thinking: thinking as 'low' | 'medium' | 'high', navigate: nav, speak, signal: ac.signal })
      .catch((e) => { feel('sad', apiError(e).message.slice(0, 160)); setMsgs((cur) => [...cur, { role: 'assistant', content: `⚠ นำเสนอไม่สำเร็จ: ${apiError(e).message}` }]); })
      .finally(() => { if (presentAbort.current === ac) { presentAbort.current = null; presentingRef.current = false; setPresenting(null); feel('happy'); } });
  }, [feel, models, modelKey, nav, stopPresent, thinking]);

  const stopLive = useCallback(() => { session.current?.stop(); session.current = null; setLive('off'); setEmotion((e) => (e === 'talking' || e === 'thinking' ? 'happy' : e)); }, []);
  useEffect(() => () => session.current?.stop(), []);
  const toggleLive = async () => {
    if (session.current) return stopLive();
    const liveId = (models.find((m) => m.liveId) ?? models[0]).liveId;
    setLiveErr(''); setOpen(true); touch();
    try {
      setLive('connecting'); feel('thinking', 'กำลังต่อสัญญาณเสียง...');
      session.current = await startLive({
        onState: (st) => { if (st === 'idle') { setLive('off'); session.current = null; feel('happy', SAY.happy); } else { setLive(st); if (st === 'listening') feel('happy', 'ฟังอยู่ครับ พูดได้เลย 🎤'); if (st === 'speaking') feel('talking'); } },
        onUserText: (t) => { turn.current.user = t; feel('thinking', t.slice(0, 160)); },
        onCatText: (t) => { turn.current.cat = t; setSaid(t.slice(-160)); },
        onAction: (a) => doAction(a as CatAction),
        onTurn: () => { const { user, cat } = turn.current; turn.current = { user: '', cat: '' }; turnWaiter.current?.(); if (presentingRef.current) return; if (user || cat) setMsgs((cur) => [...cur, ...(user ? [{ role: 'user' as const, content: user }] : []), ...(cat ? [{ role: 'assistant' as const, content: cat }] : [])]); },
        onError: (m) => { setLiveErr(m); feel('sad', m.slice(0, 160)); },
      }, { model: liveId, voice, thinking });
      // what is already attached / the page the user is on is told to the voice session
      if (items.length) session.current.attach(items);
      if (ctx.dashboardId) session.current.sendText('[ระบบ] ผู้ใช้กำลังเปิดหน้าแดชบอร์ด id=' + ctx.dashboardId + ' ของไฟล์ id=' + ctx.fileId + ' (ถ้าสั่งให้นำเสนอ/พรีเซนต์ "อันนี้" ให้ใช้ id นี้)');
    } catch (e) {
      session.current = null; setLive('off');
      const m = apiError(e).message || (e as Error).message; setLiveErr(m); feel('sad', m.slice(0, 160));
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(false); touch();
    const it = readAiItem(e.dataTransfer);
    if (!it) return feel('surprised', 'แมวรับเฉพาะไฟล์ โฟลเดอร์ หรือแดชบอร์ดจากในเว็บนี้ครับ');
    setItems((cur) => (cur.some((x) => x.id === it.id) ? cur : [...cur.slice(-4), it]));
    session.current?.attach([it]);
    setOpen(true); feel('love', `รับ “${it.name}” แล้วครับ อยากรู้อะไรเกี่ยวกับสิ่งนี้ ถามได้เลย 😻`);
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(AI_DRAG_MIME)) { e.preventDefault(); if (!over) { setOver(true); feel('surprised', 'วางลงตรงนี้ได้เลยครับ!'); } } },
    onDragLeave: () => { setOver(false); },
    onDrop,
  };

  if (!user || panelOpen || !catVisible) return null;
  return (
    <div className="fixed bottom-2 right-2 z-[60] flex flex-col items-end gap-2 print:hidden sm:bottom-4 sm:right-4" {...dropProps}>
      {open && (
        <section className="cat-chat flex max-h-[min(70vh,560px)] w-[min(390px,calc(100vw-1rem))] flex-col overflow-hidden" aria-label="แชตกับน้องแมว AI">
          <header className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[emotion], boxShadow: `0 0 8px ${DOT[emotion]}` }} />
            <select value={modelKey} onChange={(e) => { setModelKey(e.target.value as ModelDef['key']); localStorage.setItem('cat:model', e.target.value); }}
              className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface/70 px-2 py-1 text-xs" aria-label="เลือกโมเดล">
              {models.map((m) => <option key={m.key} value={m.key} disabled={!m.chat}>{m.label}{!m.chat ? ' (ยังไม่เปิดใช้)' : !m.id ? ' (ใส่ ID)' : ''}</option>)}
            </select>
            <IconButton label={live === 'off' ? 'คุยด้วยเสียง' : 'หยุดคุยด้วยเสียง'} onClick={() => void toggleLive()}>{live === 'off' ? <Mic className="h-4 w-4" /> : <Square className="h-4 w-4 text-danger" />}</IconButton>
            <IconButton label="ตั้งค่าโมเดลและ API key" onClick={() => setCfg((v) => !v)}><Settings2 className="h-4 w-4" /></IconButton>
            <IconButton label="ล้างแชต" onClick={() => setMsgs([])}><Eraser className="h-4 w-4" /></IconButton>
            <IconButton label="ปิดแชต" onClick={() => setOpen(false)}><X className="h-4 w-4" /></IconButton>
          </header>
          {cfg && (
            <div className="space-y-2 border-b border-line bg-ink/[.03] p-3 text-xs">
              <p className="font-medium">Model ID ของแต่ละโมเดล (แก้ได้ — ดูชื่อที่ถูกต้องใน Google AI Studio)</p>
              {models.map((m) => (
                <label key={m.key} className="block">
                  <span className="text-muted">{m.label} — {m.hint}</span>
                  <TextInput value={m.id} onChange={(e) => saveModelId(m.key, e.target.value)} placeholder="เช่น gemini-3.8-flash" className="!h-8 !text-xs" />
                  {m.liveId !== undefined && <><span className="mt-1 block text-muted">Live ID (คุยด้วยเสียง)</span><TextInput value={m.liveId} onChange={(e) => saveModelId(m.key, e.target.value, true)} className="!h-8 !text-xs" /></>}
                </label>
              ))}
              <label className="block"><span className="flex items-center justify-between text-muted"><span>ขนาดน้องแมว</span><span className="tabular-nums">{Math.round(scale * 100)}%</span></span>
                <input type="range" min={0.6} max={2.2} step={0.1} value={scale} onChange={(e) => changeScale(Number(e.target.value))} className="w-full accent-[rgb(var(--c-primary))]" aria-label="ขนาดน้องแมว" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="text-muted">เสียงของแมว</span>
                  <select value={voice} onChange={(e) => { setVoice(e.target.value); localStorage.setItem('cat:voice', e.target.value); }} className="h-8 w-full rounded-lg border border-line bg-surface/70 px-2 text-xs">{VOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label className="block"><span className="text-muted">ระดับการคิด (ยิ่งลึกยิ่งช้า)</span>
                  <select value={thinking} onChange={(e) => { setThinking(e.target.value); localStorage.setItem('cat:thinking', e.target.value); }} className="h-8 w-full rounded-lg border border-line bg-surface/70 px-2 text-xs"><option value="low">เร็ว</option><option value="medium">ปานกลาง</option><option value="high">ลึกที่สุด (ช้ากว่า)</option></select></label>
              </div>
              <button type="button" className="text-primary hover:underline" onClick={() => setPanel(true)}>ตั้งค่า API key ของ Gemini (เปิดแผง AI)</button>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {hasKey === false && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">ยังไม่ได้ตั้งค่า API key ของ Gemini — <button type="button" className="font-medium underline" onClick={() => setPanel(true)}>ตั้งค่าที่นี่</button></p>}
            {!msgs.length && <p className="text-xs text-muted">ถามเรื่องข้อมูลได้เลย หรือ <b>ลากไฟล์ / โฟลเดอร์ / แดชบอร์ด</b> จากหน้าเว็บมาวางที่ตัวน้องแมว แล้วถามเกี่ยวกับสิ่งนั้น — น้องแมวอ่านด้วยสิทธิ์ของคุณเท่านั้น</p>}
            {msgs.map((m, i) => (
              <div key={i} className={cn('max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm', m.role === 'user' ? 'ml-auto bg-primary text-white' : 'bg-ink/[.06]')}>{m.content}</div>
            ))}
            {busy && <div className="w-fit rounded-2xl bg-ink/[.06] px-3 py-2 text-sm text-muted">กำลังคิด / ทำงาน…</div>}
            <div ref={end} />
          </div>
          <footer className="shrink-0 space-y-2 border-t border-line p-3">
            {!!items.length && (
              <div className="flex flex-wrap gap-1.5">
                {items.map((it) => { const Ic = KIND_ICON[it.kind]; return (
                  <span key={it.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    <Ic className="h-3 w-3 shrink-0" /><span className="truncate">{it.name}</span>
                    <button type="button" aria-label="เอาออก" onClick={() => setItems((c) => c.filter((x) => x.id !== it.id))}><X className="h-3 w-3" /></button>
                  </span>); })}
              </div>
            )}
            {live !== 'off' && <p className="flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-1.5 text-xs text-violet-700"><span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />{live === 'connecting' ? 'กำลังเชื่อมต่อ…' : live === 'speaking' ? 'แมวกำลังพูด… (พูดแทรกได้)' : 'ฟังอยู่ — พูดได้เลย'}</p>}
            {presenting && <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /><span className="min-w-0 flex-1 truncate">กำลังนำเสนอ: {presenting}</span><button type="button" className="rounded-full bg-ink/80 px-2 py-0.5 text-white" onClick={stopPresent}>หยุด</button></p>}
            {liveErr && <p className="rounded-xl bg-red-50 px-3 py-1.5 text-xs text-red-700">{liveErr}</p>}
            <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2">
              <TextInput value={text} onChange={(e) => { setText(e.target.value); touch(); }} placeholder="พิมพ์คำถาม / คำสั่ง…" />
              <Button type="submit" disabled={!text.trim()} loading={busy} aria-label="ส่ง"><Send className="h-4 w-4" /></Button>
            </form>
          </footer>
        </section>
      )}

      {!open && (
        <div className="cat-bubble pointer-events-none max-w-[min(260px,70vw)] text-xs sm:text-sm" role="status">
          <p className="mb-0.5 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-violet-600"><span className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[emotion], boxShadow: `0 0 8px ${DOT[emotion]}` }} />Quality Cat AI</p>
          <p className="line-clamp-4">{said}</p>
        </div>
      )}

      <button type="button" onClick={() => { touch(); if (emotion === 'sleeping' || emotion === 'sleepy') feel('surprised', 'เมี๊ยวว!! ตื่นแล้วครับ! มีอะไรให้ช่วยไหมครับ? 🙀'); else if (!open) feel('love', 'เหมียว~ ว่าไงครับ? 😻'); setOpen((v) => !v); }}
        style={{ '--cs': scale } as React.CSSProperties}
        className={cn('relative h-[calc(var(--cs)*150px)] w-[calc(var(--cs)*130px)] max-h-[70vh] max-w-[80vw] shrink-0 cursor-pointer rounded-3xl transition-shadow sm:h-[calc(var(--cs)*210px)] sm:w-[calc(var(--cs)*180px)]', over && 'ring-4 ring-violet-300/70')} aria-label="น้องแมว AI">
        <Safe fallback={<span className="grid h-full place-items-center text-6xl">🐱</span>}>
          <Suspense fallback={<span className="grid h-full place-items-center text-5xl opacity-60">🐱</span>}><CatScene emotion={emotion} /></Suspense>
        </Safe>
      </button>
    </div>
  );
}
