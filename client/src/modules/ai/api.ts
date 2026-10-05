import { del, get, post, put } from '@/api/client';

export type Provider = 'gemini' | 'anthropic' | 'openai';
export interface ProviderInfo { provider: Provider; label: string; defaultModel: string; hasKey: boolean; model: string | null; baseUrl: string | null; defaultBaseUrl: string | null }
export interface ChatMsg { role: 'user' | 'assistant'; content: string; steps?: { tool: string; ok: boolean }[] }
export interface ChatContext { fileId?: string | null; sheetId?: string | null; dashboardId?: string | null }

export const aiApi = {
  settings: () => get<{ providers: ProviderInfo[] }>('/ai/settings'),
  save: (p: Provider, b: { apiKey?: string; model?: string | null; baseUrl?: string | null }) => put(`/ai/settings/${p}`, b),
  remove: (p: Provider) => del(`/ai/settings/${p}`),
  chat: (provider: Provider, messages: ChatMsg[], context: ChatContext) =>
    post<{ reply: string; steps: { tool: string; ok: boolean }[]; changedDashboards: string[] }>('/ai/chat', { provider, messages: messages.map(({ role, content }) => ({ role, content })), context }, { timeout: 180_000 }),
};
