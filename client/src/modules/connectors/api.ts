import { del, get, post, put } from '@/api/client';

export type Kind = 'http' | 'sharepoint';
export interface SourceConfig { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; format: 'auto' | 'json' | 'csv' | 'xlsx'; jsonPath?: string; sheetName?: string; headerRow?: number }
export interface Mapping { source: string; columnId: string }
export interface Connector {
  id?: string; name: string; kind: Kind; config: SourceConfig; targetSheetId: string | null; mapping: Mapping[]; keyColumnId: string | null; scheduleMin: number;
  lastRunAt?: string | null; lastStatus?: 'ok' | 'error' | 'needs_auth' | null; lastMessage?: string | null; running?: boolean; hasCredentials?: boolean;
}
export interface Credentials { type: 'none' | 'basic' | 'bearer' | 'header'; username?: string; password?: string; token?: string; headerName?: string }
export interface Preview { total: number; fields: string[]; rows: Record<string, unknown>[]; sheetNames: string[] }
export interface RunResult { read: number; created: number; updated: number; skipped: number; errors: string[] }

export const emptyConnector = (): Connector => ({ name: '', kind: 'http', config: { url: '', method: 'GET', headers: {}, format: 'auto' }, targetSheetId: null, mapping: [], keyColumnId: null, scheduleMin: 0 });

export const connectorsApi = {
  list: () => get<{ items: Connector[]; microsoft: boolean }>('/connectors'),
  create: (c: Connector) => post<{ id: string }>('/connectors', body(c)),
  update: (c: Connector) => put<{ saved: boolean; credentialsReset: boolean }>(`/connectors/${c.id}`, body(c)),
  remove: (id: string) => del(`/connectors/${id}`),
  credentials: (id: string, c: Credentials) => put(`/connectors/${id}/credentials`, c),
  preview: (c: Connector, credentials?: Credentials) => post<Preview>('/connectors/preview', { id: c.id, kind: c.kind, config: c.config, credentials }),
  run: (id: string) => post<RunResult>(`/connectors/${id}/run`),
  msStart: (id: string) => get<{ url: string }>(`/connectors/${id}/ms/start`),
};
const body = (c: Connector) => ({ name: c.name, kind: c.kind, config: c.config, targetSheetId: c.targetSheetId, mapping: c.mapping, keyColumnId: c.keyColumnId, scheduleMin: c.scheduleMin });

/** True when the server said the source needs a login */
export const needsAuth = (e: unknown) => (e as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code === 'NEEDS_AUTH';
