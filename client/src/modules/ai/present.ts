import { aiApi, PresentFilters, PresentScript } from './api';

/**
 * Presents a dashboard: opens it full screen, walks through its widgets (scroll + highlight) while the cat says one line per widget.
 * The page itself (pages/DashboardPage.tsx) listens to the window events dash:ready / dash:focus / dash:caption.
 */
export interface PresentOptions {
  fileId: string; dashboardId: string; filters?: PresentFilters; model?: string; thinking?: 'low' | 'medium' | 'high';
  navigate: (to: string) => void;
  /** say a line aloud and resolve when it is finished (the voice session); without it the line is shown as a caption for a time that fits its length */
  speak?: (text: string) => Promise<void>;
  signal: AbortSignal;
  onStatus?: (s: string) => void;
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((ok) => { const t = window.setTimeout(ok, ms); signal.addEventListener('abort', () => { window.clearTimeout(t); ok(); }, { once: true }); });
const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export async function runPresentation(o: PresentOptions): Promise<void> {
  o.onStatus?.('กำลังเตรียมบทนำเสนอ…');
  const script: PresentScript = await aiApi.present(o.dashboardId, { model: o.model, thinking: o.thinking, filters: o.filters });
  if (o.signal.aborted) return;
  const ready = new Promise<void>((ok) => {
    const h = (e: Event) => { if ((e as CustomEvent<{ dashboardId: string }>).detail?.dashboardId === o.dashboardId) { window.removeEventListener('dash:ready', h); ok(); } };
    window.addEventListener('dash:ready', h);
    window.setTimeout(() => { window.removeEventListener('dash:ready', h); ok(); }, 20_000);
  });
  o.navigate(`/files/${o.fileId}/dashboards/${o.dashboardId}?present=1${o.filters ? `&pf=${encodeURIComponent(JSON.stringify(o.filters))}` : ''}`);
  await ready;
  const lines = script.script.filter((x) => x.say.trim());
  const n = lines.length;
  const say = async (text: string, i: number) => {
    emit('dash:caption', { text, i, n });
    if (o.speak) await o.speak(text); else await wait(Math.min(14_000, 2800 + text.length * 75), o.signal);
  };
  try {
    await say(script.intro, 0);
    for (let i = 0; i < n && !o.signal.aborted; i++) {
      emit('dash:focus', { widgetId: lines[i].widgetId });
      await wait(900, o.signal); // let the scroll settle
      if (o.signal.aborted) break;
      await say(lines[i].say, i + 1);
      await wait(500, o.signal);
    }
    if (!o.signal.aborted) { emit('dash:focus', { widgetId: '' }); await say(script.outro, n); await wait(1500, o.signal); }
  } finally {
    emit('dash:caption', null);
  }
}
