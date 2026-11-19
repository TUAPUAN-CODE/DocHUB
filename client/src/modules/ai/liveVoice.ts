import { post } from '@/api/client';

/**
 * Voice chat with the cat (Gemini Live via the server's WebSocket proxy, server/src/modules/ai/live.ts).
 * Mic: 16 kHz PCM16 in, voice: 24 kHz PCM16 out. Needs a secure page (https or localhost) for the microphone.
 */
export interface LiveHandlers {
  onState: (s: 'connecting' | 'listening' | 'speaking' | 'idle') => void;
  onUserText: (t: string) => void;       // what the user said (transcript, grows)
  onCatText: (t: string) => void;        // what the cat says (transcript, grows)
  onTurn: () => void;                    // the cat finished a turn
  onError: (m: string) => void;
  onChart?: (c: unknown) => void;        // the model drew a chart for the chat (tool show_chart)
  onAction?: (a: unknown) => void;       // the model asked the browser to do something (open a page / present a dashboard)
  onLevel?: (v: number) => void;         // output loudness 0..1 (mouth)
}
export interface LiveOptions { model?: string; voice?: string; thinking?: string }

const b64 = (buf: ArrayBuffer) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

const WORKLET = `class Pcm extends AudioWorkletProcessor { process(inputs){ const c = inputs[0] && inputs[0][0]; if (c) { const o = new Int16Array(c.length); for (let i=0;i<c.length;i++){ const v = Math.max(-1, Math.min(1, c[i])); o[i] = v < 0 ? v*0x8000 : v*0x7fff; } this.port.postMessage(o.buffer, [o.buffer]); } return true; } } registerProcessor('pcm', Pcm);`;

export async function startLive(h: LiveHandlers, opt: LiveOptions = {}) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('ไมโครโฟนใช้ได้เฉพาะหน้าที่เปิดด้วย https (หรือ localhost) — เปิดเว็บผ่านที่อยู่แบบ https ก่อนครับ');
  h.onState('connecting');
  const { ticket, path } = await post<{ ticket: string; path: string }>('/ai/live/ticket', opt);
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const inCtx = new AudioContext({ sampleRate: 16000 });
  const outCtx = new AudioContext({ sampleRate: 24000 });
  await inCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}${path}?ticket=${encodeURIComponent(ticket)}`);

  let played = 0, lastAudio = 0, closed = false, ready = false, playAt = 0, userText = '', catText = '';
  const sources = new Set<AudioBufferSourceNode>();
  const analyser = outCtx.createAnalyser(); analyser.fftSize = 256; analyser.connect(outCtx.destination);
  const lvl = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const loop = () => { if (closed) return; analyser.getByteTimeDomainData(lvl); let m = 0; for (const v of lvl) m = Math.max(m, Math.abs(v - 128)); h.onLevel?.(Math.min(1, m / 60)); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  const stop = () => {
    if (closed) return; closed = true; cancelAnimationFrame(raf);
    try { ws.close(); } catch { /* closed */ }
    mic.getTracks().forEach((t) => t.stop());
    sources.forEach((s) => { try { s.stop(); } catch { /* ended */ } });
    void inCtx.close().catch(() => undefined); void outCtx.close().catch(() => undefined);
    h.onLevel?.(0); h.onState('idle');
  };

  const node = new AudioWorkletNode(inCtx, 'pcm');
  inCtx.createMediaStreamSource(mic).connect(node);
  node.port.onmessage = (e) => { if (ready && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: b64(e.data) } } })); };

  const play = (pcm: Uint8Array) => {
    const n = Math.floor(pcm.length / 2); if (!n) return;
    const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
    const buf = outCtx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
    played++; lastAudio = Date.now(); void outCtx.resume().catch(() => undefined);
    const src = outCtx.createBufferSource(); src.buffer = buf; src.connect(analyser);
    const at = Math.max(outCtx.currentTime + 0.03, playAt); src.start(at); playAt = at + buf.duration;
    sources.add(src); src.onended = () => { sources.delete(src); if (!sources.size && !closed) h.onState('listening'); };
    h.onState('speaking');
  };

  ws.onmessage = (ev) => {
    let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.proxyError) { h.onError(m.proxyError); stop(); return; }
    if (m.action) { h.onAction?.(m.action); return; }
    if (m.chart) { h.onChart?.(m.chart); return; }
    if (m.tool) return;
    if (m.setupComplete) { ready = true; h.onState('listening'); return; }
    const sc = m.serverContent; if (!sc) return;
    if (sc.interrupted) { sources.forEach((s) => { try { s.stop(); } catch { /* ended */ } }); sources.clear(); playAt = 0; h.onState('listening'); }
    for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) play(unb64(p.inlineData.data));
    if (sc.inputTranscription?.text) { if (catText) { userText = ''; catText = ''; } userText += sc.inputTranscription.text; h.onUserText(userText); }
    if (sc.outputTranscription?.text) { catText += sc.outputTranscription.text; h.onCatText(catText); }
    if (sc.turnComplete) { h.onTurn(); userText = ''; catText = ''; }
  };
  ws.onerror = () => { h.onError('เชื่อมต่อเสียงไม่สำเร็จ'); stop(); };
  ws.onclose = () => stop();
  return { stop, played: () => played, quiet: () => !sources.size && Date.now() - lastAudio > 1200, attach: (items: { kind: string; id: string }[]) => { if (ready && ws.readyState === WebSocket.OPEN && items.length) ws.send(JSON.stringify({ attach: items.map(({ kind, id }) => ({ kind, id })) })); }, sendText: (text: string) => { if (ready && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ realtimeInput: { text } })); } };
}
