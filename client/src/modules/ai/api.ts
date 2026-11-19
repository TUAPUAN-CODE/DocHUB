import { del, get, post, put } from '@/api/client';
import type { ColumnFilter } from '@/types';

export type Provider = 'gemini' | 'anthropic' | 'openai';
export interface ProviderInfo { provider: Provider; label: string; defaultModel: string; hasKey: boolean; model: string | null; baseUrl: string | null; defaultBaseUrl: string | null }
/** a chart (or small table) drawn inside the chat by the AI (tool show_chart) */
export interface ChatChartData { type: 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'pareto' | 'table'; title: string; categories: string[]; series: { name: string; values: (number | null)[] }[]; totalRows: number }
export interface ChatMsg { role: 'user' | 'assistant'; content: string; steps?: { tool: string; ok: boolean }[]; charts?: ChatChartData[]; files?: { label: string; rows: number }[] }
export interface ChatContext { fileId?: string | null; sheetId?: string | null; dashboardId?: string | null }

export interface PresentFilters { from?: string; to?: string; label?: string; slicers?: { name: string; values: string[] }[] }
/** a file the browser makes for the user (tool export_data): PDF / Excel of a sheet, or the Delay report forms */
export interface ExportAction {
  type: 'export'; format: 'pdf' | 'xlsx' | 'delay_pdf' | 'delay_xlsx'; fileId: string; fileName: string; sheetId: string; sheetName: string; label: string;
  template?: string; title?: string; columns?: string[]; filters: ColumnFilter[]; search?: string; sorts?: { columnId: string; dir: 'asc' | 'desc' }[]; total: number;
}
export type CatAction = { type: 'open'; to: string; label: string } | { type: 'present'; fileId: string; dashboardId: string; fullscreen: boolean; label: string; filters?: PresentFilters } | ExportAction;
export interface PresentScript { name: string; intro: string; outro: string; script: { widgetId: string; say: string }[] }

export const aiApi = {
  present: (dashboardId: string, extra: { model?: string; thinking?: 'low' | 'medium' | 'high'; filters?: PresentFilters } = {}) => post<PresentScript>('/ai/present', { dashboardId, ...extra }, { timeout: 180_000 }),
  settings: () => get<{ providers: ProviderInfo[] }>('/ai/settings'),
  save: (p: Provider, b: { apiKey?: string; model?: string | null; baseUrl?: string | null }) => put(`/ai/settings/${p}`, b),
  remove: (p: Provider) => del(`/ai/settings/${p}`),
  chat: (provider: Provider, messages: ChatMsg[], context: ChatContext, extra: { model?: string; thinking?: 'low' | 'medium' | 'high'; attachments?: { kind: 'file' | 'folder' | 'dashboard'; id: string; name: string }[] } = {}) =>
    post<{ reply: string; steps: { tool: string; ok: boolean }[]; changedDashboards: string[]; actions?: CatAction[]; charts?: ChatChartData[] }>('/ai/chat', { provider, messages: messages.map(({ role, content }) => ({ role, content })), context, ...(extra.model ? { model: extra.model } : {}), ...(extra.thinking ? { thinking: extra.thinking } : {}), attachments: extra.attachments ?? [] }, { timeout: 180_000 }),
};
