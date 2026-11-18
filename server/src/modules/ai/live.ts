import type http from 'http';
import jwt from 'jsonwebtoken';
import WebSocket, { WebSocketServer } from 'ws';
import { q1, T } from '../../config/db';
import { env } from '../../config/env';
import { logger } from '../../shared/logger';
import { decryptJson } from '../connectors/secret';

/**
 * Voice chat with the cat (Gemini Live API). The browser never sees the user's API key: it asks for a short-lived ticket
 * (POST /api/ai/live/ticket, same permission as the AI button), then opens a WebSocket to /api/ai/live-ws?ticket=… and this file
 * connects to Google with the stored key. Only audio / text input is passed on to Google (never a "setup" message), so the model,
 * voice and persona are the ones chosen here.
 */
export const LIVE_PATH = '/api/ai/live-ws';
const GOOGLE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const LIVE_MODEL = 'gemini-3.8-live-extended-thinking';
export const VOICES = ['Aoede', 'Kore', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'] as const;
const MAX_SESSION_MS = 10 * 60_000;
const TICKET_TTL = 60;
const active = new Set<string>();

export interface TicketInput { userId: string; name: string; model?: string; voice?: string; thinking?: string }
export const issueTicket = (t: TicketInput) => jwt.sign({ k: 'live', ...t }, env.jwt.secret, { expiresIn: TICKET_TTL });

const persona = (name: string) => `คุณคือ "น้องแมว" ผู้ช่วย AI ของระบบ Quality Sheet ในโรงงานอาหาร กำลังคุยด้วยเสียงกับคุณ ${name}.
พูดภาษาไทยเป็นธรรมชาติเหมือนคนจริง น้ำเสียงเป็นกันเอง สุภาพ ลงท้าย "ครับ/เหมียว" เป็นบางครั้งได้ ตอบสั้น กระชับ 1-3 ประโยค เว้นแต่ถูกขอให้อธิบายยาว.
ถ้าไม่รู้ข้อมูลจริงของโรงงาน ให้บอกตรงๆ ว่าไม่ทราบ ห้ามแต่งตัวเลขหรือข้อมูลขึ้นมาเอง.`;

export function attachLive(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== LIVE_PATH) return; // socket.io and others handle their own paths
    let t: any;
    try { t = jwt.verify(url.searchParams.get('ticket') ?? '', env.jwt.secret); } catch { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return void socket.destroy(); }
    if (t?.k !== 'live' || !t.userId) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return void socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => void session(ws, t as TicketInput & { k: string }));
  });
}

async function session(client: WebSocket, t: TicketInput) {
  const send = (o: unknown) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(o)); };
  if (active.has(t.userId)) { send({ proxyError: 'เปิดคุยด้วยเสียงอยู่แล้วในหน้าต่างอื่น' }); return client.close(); }
  const row = await q1(`SELECT key_enc FROM AiKeys WHERE user_id = @u AND provider = N'gemini'`, { u: T.uuid(t.userId) }).catch(() => null);
  const key = decryptJson<{ key: string }>(row?.key_enc)?.key;
  if (!key) { send({ proxyError: 'ยังไม่ได้ตั้งค่า API key ของ Gemini' }); return client.close(); }
  active.add(t.userId);
  const model = /^[\w./-]+$/.test(t.model ?? '') ? t.model! : LIVE_MODEL;
  const voice = (VOICES as readonly string[]).includes(t.voice ?? '') ? t.voice! : 'Aoede';
  const level = ['minimal', 'low', 'medium', 'high'].includes(t.thinking ?? '') ? t.thinking! : 'medium';
  const g = new WebSocket(`${GOOGLE}?key=${encodeURIComponent(key)}`);
  const timer = setTimeout(() => { send({ proxyError: 'ครบเวลาคุย 10 นาที กดไมค์เพื่อเริ่มใหม่ได้ครับ' }); client.close(); }, MAX_SESSION_MS);
  const done = () => { clearTimeout(timer); active.delete(t.userId); try { g.close(); } catch { /* closed */ } try { client.close(); } catch { /* closed */ } };

  g.on('open', () => g.send(JSON.stringify({ setup: {
    model: `models/${model}`,
    generationConfig: { thinkingConfig: { thinkingLevel: level }, responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }, languageCode: 'th-TH' } },
    systemInstruction: { parts: [{ text: persona(t.name) }] },
    inputAudioTranscription: {}, outputAudioTranscription: {},
  } })));
  g.on('message', (d) => { if (client.readyState === WebSocket.OPEN) client.send(d.toString()); });
  g.on('close', (code, reason) => { if (code !== 1000) send({ proxyError: `ผู้ให้บริการปิดการเชื่อมต่อ (${code}) ${reason.toString().slice(0, 200)}` }); done(); });
  g.on('error', (e) => { logger.error(`ai live: google ws error ${e.message}`); send({ proxyError: 'เชื่อมต่อ Gemini Live ไม่ได้' }); done(); });
  client.on('message', (d) => {
    if (g.readyState !== WebSocket.OPEN) return;
    let m: any; try { m = JSON.parse(d.toString()); } catch { return; }
    // only live input is accepted from the browser; "setup" and everything else is ignored
    if (m?.realtimeInput && typeof m.realtimeInput === 'object') g.send(JSON.stringify({ realtimeInput: m.realtimeInput }));
  });
  client.on('close', done);
  client.on('error', done);
}
