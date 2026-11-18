import { Component, ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Eraser, FileText, Folder, LayoutDashboard, Send, Settings2, X } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { aiApi, ChatMsg } from './api';
import type { CatEmotion } from './CatScene';
import { AI_DASH_EVENT, useAiPanel } from './useAiPanel';
import { AI_DRAG_MIME, AiItem, readAiItem } from './dragItem';

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
interface ModelDef { key: 'think' | 'carbon' | 'embed'; label: string; id: string; chat: boolean; hint: string }
const DEFAULT_MODELS: ModelDef[] = [
  { key: 'think', label: 'Gemini 3.8 Live Extended Thinking', id: 'gemini-3.8-flash', chat: true, hint: 'คิดละเอียด ฉลาดที่สุด' },
  { key: 'carbon', label: 'Gemini 4 Carbon', id: '', chat: true, hint: 'ต้องใส่ Model ID ก่อนใช้' },
  { key: 'embed', label: 'Embedding 2', id: '', chat: false, hint: 'ใช้ช่วยค้นหา/จับความหมาย — ยังไม่เปิดใช้ในแชต' },
];
const MODELS_KEY = 'cat:models';
const loadModels = (): ModelDef[] => {
  try { const saved = JSON.parse(localStorage.getItem(MODELS_KEY) || '{}') as Record<string, string>; return DEFAULT_MODELS.map((m) => ({ ...m, id: typeof saved[m.key] === 'string' ? saved[m.key] : m.id })); } catch { return DEFAULT_MODELS; }
};

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
  const end = useRef<HTMLDivElement>(null);
  const idle = useRef<number[]>([]);
  const histKey = `cat:chat:${user?.id}`;

  const ctx = useMemo(() => {
    const m = /^\/files\/([0-9a-f-]{36})(?:\/dashboards\/([0-9a-f-]{36}))?/i.exec(pathname);
    return { fileId: m?.[1] ?? null, dashboardId: m?.[2] ?? null, sheetId: sp.get('sheet') };
  }, [pathname, sp]);

  const feel = useCallback((e: CatEmotion, say?: string) => { setEmotion(e); setSaid(say ?? SAY[e]); }, []);
  // no activity for a while: sleepy, then asleep (any interaction wakes the cat)
  const touch = useCallback(() => {
    idle.current.forEach((t) => window.clearTimeout(t));
    idle.current = [window.setTimeout(() => feel('sleepy'), IDLE_SLEEPY_MS), window.setTimeout(() => feel('sleeping'), IDLE_SLEEP_MS)];
  }, [feel]);
  useEffect(() => { touch(); return () => idle.current.forEach((t) => window.clearTimeout(t)); }, [touch]);

  useEffect(() => { try { setMsgs(JSON.parse(localStorage.getItem(histKey) || '[]')); } catch { setMsgs([]); } }, [histKey]);
  useEffect(() => { try { localStorage.setItem(histKey, JSON.stringify(msgs.slice(-30))); } catch { /* storage full / blocked */ } end.current?.scrollIntoView({ block: 'end' }); }, [msgs, histKey]);
  useEffect(() => { if (open) aiApi.settings().then((r) => setHasKey(!!r.providers.find((p) => p.provider === 'gemini')?.hasKey)).catch(() => setHasKey(null)); }, [open]);

  const model = models.find((m) => m.key === modelKey) ?? models[0];
  const saveModelId = (key: ModelDef['key'], id: string) => {
    const next = models.map((m) => (m.key === key ? { ...m, id: id.trim() } : m));
    setModels(next);
    try { localStorage.setItem(MODELS_KEY, JSON.stringify(Object.fromEntries(next.map((m) => [m.key, m.id])))); } catch { /* private mode */ }
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
      const r = await aiApi.chat('gemini', next.slice(-20), ctx, { model: model.id, attachments: items });
      const reply = r.reply || '(ไม่มีข้อความตอบกลับ)';
      setMsgs([...next, { role: 'assistant', content: reply, steps: r.steps }]);
      for (const id of r.changedDashboards) window.dispatchEvent(new CustomEvent(AI_DASH_EVENT, { detail: { dashboardId: id } }));
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

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(false); touch();
    const it = readAiItem(e.dataTransfer);
    if (!it) return feel('surprised', 'แมวรับเฉพาะไฟล์ โฟลเดอร์ หรือแดชบอร์ดจากในเว็บนี้ครับ');
    setItems((cur) => (cur.some((x) => x.id === it.id) ? cur : [...cur.slice(-4), it]));
    setOpen(true); feel('love', `รับ “${it.name}” แล้วครับ อยากรู้อะไรเกี่ยวกับสิ่งนี้ ถามได้เลย 😻`);
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(AI_DRAG_MIME)) { e.preventDefault(); if (!over) { setOver(true); feel('surprised', 'วางลงตรงนี้ได้เลยครับ!'); } } },
    onDragLeave: () => { setOver(false); },
    onDrop,
  };

  if (!user || panelOpen) return null;
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
                </label>
              ))}
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
        className={cn('relative h-[150px] w-[130px] shrink-0 cursor-pointer rounded-3xl transition-shadow sm:h-[210px] sm:w-[180px]', over && 'ring-4 ring-violet-300/70')} aria-label="น้องแมว AI">
        <Safe fallback={<span className="grid h-full place-items-center text-6xl">🐱</span>}>
          <Suspense fallback={<span className="grid h-full place-items-center text-5xl opacity-60">🐱</span>}><CatScene emotion={emotion} /></Suspense>
        </Safe>
      </button>
    </div>
  );
}
