import { safeFetch } from '../connectors/safeFetch';

export type Provider = 'gemini' | 'anthropic' | 'openai';
export const PROVIDERS: Record<Provider, { label: string; model: string; baseUrl?: string }> = {
  gemini: { label: 'Google Gemini (มีโควตาฟรี)', model: 'gemini-2.0-flash' },
  anthropic: { label: 'Anthropic Claude', model: 'claude-sonnet-5-5' },
  openai: { label: 'OpenAI / เข้ากันได้กับ OpenAI (Groq, OpenRouter, Ollama…)', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
};

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
/** Provider-neutral conversation */
export type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls?: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: { id: string; name: string; content: string }[] };
export interface Turn { text: string; calls: ToolCall[]; raw?: unknown }
export interface Conn { provider: Provider; key: string; model: string; baseUrl?: string }

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const r = await safeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = r.body.toString('utf8');
  let j: any; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  if (r.status >= 400) {
    const m = j?.error?.message || j?.error?.type || j?.message || j?.raw || `HTTP ${r.status}`;
    throw new Error(`ผู้ให้บริการ AI ตอบกลับ ${r.status}: ${String(m).slice(0, 300)}`);
  }
  return j;
}

/* ---------- Gemini ---------- */
async function gemini(c: Conn, system: string, msgs: Msg[], tools: ToolDef[]): Promise<Turn> {
  const contents: any[] = [];
  for (const m of msgs) {
    if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.text }] });
    else if (m.role === 'assistant') contents.push(m.raw ? (m.raw as any) : { role: 'model', parts: [{ text: m.text || ' ' }] });
    else contents.push({ role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { result: r.content } } })) });
  }
  const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, { 'x-goog-api-key': c.key },
    { systemInstruction: { parts: [{ text: system }] }, contents, tools: tools.length ? [{ functionDeclarations: tools }] : undefined });
  const cand = j.candidates?.[0];
  if (!cand?.content) throw new Error(j.promptFeedback?.blockReason ? `Gemini ปฏิเสธคำขอ (${j.promptFeedback.blockReason})` : 'Gemini ไม่ส่งคำตอบกลับมา');
  const parts: any[] = cand.content.parts ?? [];
  return {
    text: parts.map((p) => p.text ?? '').join(''),
    calls: parts.filter((p) => p.functionCall).map((p, i) => ({ id: `g${Date.now()}${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} })),
    raw: cand.content,
  };
}

/* ---------- Anthropic ---------- */
async function anthropic(c: Conn, system: string, msgs: Msg[], tools: ToolDef[]): Promise<Turn> {
  const messages: any[] = [];
  for (const m of msgs) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content: [...(m.text ? [{ type: 'text', text: m.text }] : []), ...(m.calls ?? []).map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.args }))] });
    else messages.push({ role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })) });
  }
  const j = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': c.key, 'anthropic-version': '2023-06-01' },
    { model: c.model, max_tokens: 4096, system, messages, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) });
  const blocks: any[] = j.content ?? [];
  return { text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''), calls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })) };
}

/* ---------- OpenAI-compatible ---------- */
async function openai(c: Conn, system: string, msgs: Msg[], tools: ToolDef[]): Promise<Turn> {
  const messages: any[] = [{ role: 'system', content: system }];
  for (const m of msgs) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') messages.push({ role: 'assistant', content: m.text || null, ...(m.calls?.length ? { tool_calls: m.calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}) });
    else for (const r of m.results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }
  const base = (c.baseUrl || PROVIDERS.openai.baseUrl!).replace(/\/+$/, '');
  const j = await post(`${base}/chat/completions`, { Authorization: `Bearer ${c.key}` },
    { model: c.model, messages, tools: tools.length ? tools.map((t) => ({ type: 'function', function: t })) : undefined });
  const msg = j.choices?.[0]?.message;
  if (!msg) throw new Error('ผู้ให้บริการไม่ส่งคำตอบกลับมา');
  return {
    text: msg.content ?? '',
    calls: (msg.tool_calls ?? []).map((t: any) => { let args = {}; try { args = JSON.parse(t.function.arguments || '{}'); } catch { /* model sent bad JSON: run with no args and let validation explain */ } return { id: t.id, name: t.function.name, args }; }),
  };
}

export const callModel = (c: Conn, system: string, msgs: Msg[], tools: ToolDef[]): Promise<Turn> =>
  c.provider === 'gemini' ? gemini(c, system, msgs, tools) : c.provider === 'anthropic' ? anthropic(c, system, msgs, tools) : openai(c, system, msgs, tools);
