"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueTicket = exports.VOICES = exports.LIVE_MODEL = exports.LIVE_PATH = void 0;
exports.attachLive = attachLive;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const ws_1 = __importStar(require("ws"));
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const logger_1 = require("../../shared/logger");
const secret_1 = require("../connectors/secret");
/**
 * Voice chat with the cat (Gemini Live API). The browser never sees the user's API key: it asks for a short-lived ticket
 * (POST /api/ai/live/ticket, same permission as the AI button), then opens a WebSocket to /api/ai/live-ws?ticket=… and this file
 * connects to Google with the stored key. Only audio / text input is passed on to Google (never a "setup" message), so the model,
 * voice and persona are the ones chosen here.
 */
exports.LIVE_PATH = '/api/ai/live-ws';
const GOOGLE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
exports.LIVE_MODEL = 'gemini-3.8-live-extended-thinking';
exports.VOICES = ['Aoede', 'Kore', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus'];
const MAX_SESSION_MS = 10 * 60_000;
const TICKET_TTL = 60;
const active = new Set();
const issueTicket = (t) => jsonwebtoken_1.default.sign({ k: 'live', ...t }, env_1.env.jwt.secret, { expiresIn: TICKET_TTL });
exports.issueTicket = issueTicket;
const persona = (name) => `คุณคือ "น้องแมว" ผู้ช่วย AI ของระบบ Quality Sheet ในโรงงานอาหาร กำลังคุยด้วยเสียงกับคุณ ${name}.
พูดภาษาไทยเป็นธรรมชาติเหมือนคนจริง น้ำเสียงเป็นกันเอง สุภาพ ลงท้าย "ครับ/เหมียว" เป็นบางครั้งได้ ตอบสั้น กระชับ 1-3 ประโยค เว้นแต่ถูกขอให้อธิบายยาว.
ถ้าไม่รู้ข้อมูลจริงของโรงงาน ให้บอกตรงๆ ว่าไม่ทราบ ห้ามแต่งตัวเลขหรือข้อมูลขึ้นมาเอง.`;
function attachLive(server) {
    const wss = new ws_1.WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname !== exports.LIVE_PATH)
            return; // socket.io and others handle their own paths
        let t;
        try {
            t = jsonwebtoken_1.default.verify(url.searchParams.get('ticket') ?? '', env_1.env.jwt.secret);
        }
        catch {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            return void socket.destroy();
        }
        if (t?.k !== 'live' || !t.userId) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            return void socket.destroy();
        }
        wss.handleUpgrade(req, socket, head, (ws) => void session(ws, t));
    });
}
async function session(client, t) {
    const send = (o) => { if (client.readyState === ws_1.default.OPEN)
        client.send(JSON.stringify(o)); };
    if (active.has(t.userId)) {
        send({ proxyError: 'เปิดคุยด้วยเสียงอยู่แล้วในหน้าต่างอื่น' });
        return client.close();
    }
    const row = await (0, db_1.q1)(`SELECT key_enc FROM AiKeys WHERE user_id = @u AND provider = N'gemini'`, { u: db_1.T.uuid(t.userId) }).catch(() => null);
    const key = (0, secret_1.decryptJson)(row?.key_enc)?.key;
    if (!key) {
        send({ proxyError: 'ยังไม่ได้ตั้งค่า API key ของ Gemini' });
        return client.close();
    }
    active.add(t.userId);
    const model = /^[\w./-]+$/.test(t.model ?? '') ? t.model : exports.LIVE_MODEL;
    const voice = exports.VOICES.includes(t.voice ?? '') ? t.voice : 'Aoede';
    const level = ['minimal', 'low', 'medium', 'high'].includes(t.thinking ?? '') ? t.thinking : 'medium';
    const g = new ws_1.default(`${GOOGLE}?key=${encodeURIComponent(key)}`);
    const timer = setTimeout(() => { send({ proxyError: 'ครบเวลาคุย 10 นาที กดไมค์เพื่อเริ่มใหม่ได้ครับ' }); client.close(); }, MAX_SESSION_MS);
    const done = () => { clearTimeout(timer); active.delete(t.userId); try {
        g.close();
    }
    catch { /* closed */ } try {
        client.close();
    }
    catch { /* closed */ } };
    g.on('open', () => g.send(JSON.stringify({ setup: {
            model: `models/${model}`,
            generationConfig: { thinkingConfig: { thinkingLevel: level }, responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }, languageCode: 'th-TH' } },
            systemInstruction: { parts: [{ text: persona(t.name) }] },
            inputAudioTranscription: {}, outputAudioTranscription: {},
        } })));
    g.on('message', (d) => { if (client.readyState === ws_1.default.OPEN)
        client.send(d.toString()); });
    g.on('close', (code, reason) => { if (code !== 1000)
        send({ proxyError: `ผู้ให้บริการปิดการเชื่อมต่อ (${code}) ${reason.toString().slice(0, 200)}` }); done(); });
    g.on('error', (e) => { logger_1.logger.error(`ai live: google ws error ${e.message}`); send({ proxyError: 'เชื่อมต่อ Gemini Live ไม่ได้' }); done(); });
    client.on('message', (d) => {
        if (g.readyState !== ws_1.default.OPEN)
            return;
        let m;
        try {
            m = JSON.parse(d.toString());
        }
        catch {
            return;
        }
        // only live input is accepted from the browser; "setup" and everything else is ignored
        if (m?.realtimeInput && typeof m.realtimeInput === 'object')
            g.send(JSON.stringify({ realtimeInput: m.realtimeInput }));
    });
    client.on('close', done);
    client.on('error', done);
}
//# sourceMappingURL=live.js.map