import { del, get, post, put } from '@/api/client';

export interface PlanItem {
  time: string | null; product: string; lineRaw: string; line: string; size: string | null; customer: string | null; country: string; doc: string; rev: string | null; qty: number | null; shift: 'DS' | 'NS'; sourceRow: number;
  inDb: boolean | null; market: string; dbMarkets: string[]; docInDb: boolean | null; plant: string | null; otherPlant: boolean;
}
export interface PlanPreview { date: string | null; sheetName: string; warnings: string[]; knownLines: string[]; items: PlanItem[]; plant: string | null; sheetDate: string | null; fillsTime: boolean; fillsQty: boolean }
export interface PlanImportResult { date: string; total: number; created: number; duplicate: number; skippedNotInDb: number; skippedOtherPlant: number; failed: { doc: string; line: string; reason: string }[] }

const form = (file: File, sheetId: string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  if (sheetId) f.append('sheetId', sheetId);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  f.append('file', file);   // the file goes last: multer reads the text fields before it
  return f;
};

export const inkcodeApi = {
  previewPlan: (file: File, sheetId: string) => post<PlanPreview>('/inkcode/plan/preview', form(file, sheetId), { timeout: 120_000 }),
  importPlan: (file: File, sheetId: string, o: { date: string; onlyMatched: boolean; onlyPlant: boolean; allowOtherDate: boolean; lineMap: Record<string, string> }) =>
    post<PlanImportResult>('/inkcode/plan/import', form(file, sheetId, { date: o.date, onlyMatched: o.onlyMatched ? '1' : '0', onlyPlant: o.onlyPlant ? '1' : '0', allowOtherDate: o.allowOtherDate ? '1' : '0', lineMap: JSON.stringify(o.lineMap) }), { timeout: 300_000 }),
};

export interface AutoItem extends PlanItem { plant: string | null; area: string; sheet: string }
export interface AutoPreview { date: string; sheetName: string; warnings: string[]; knownLines: string[]; plants: string[]; areas: string[]; items: AutoItem[]; files: { plant: string; folderPath: string; fileName: string; exists: boolean; fileId: string | null }[] }
export interface AutoTarget { plant: string; area: string; fileId: string; fileName: string; folderPath: string; fileCreated: boolean; result: { created: number; duplicate: number; skippedNotInDb: number; skippedOtherPlant: number; failed: { doc: string; line: string; reason: string }[] } }
export interface PlanAlert { kind: string; time: string | null; line: string; doc: string; country: string; detail: string }
export interface AutoResult { date: string; total: number; skippedNoPlant: number; targets: AutoTarget[]; items?: { status: string }[]; recordFileId?: string; alerts?: PlanAlert[]; newsPostId?: string | null; qhMail?: QhMailResult | null }
export interface QhMailDraft { to: string[]; cc: string[]; subject: string; html: string; text: string }
export interface QhMailResult { matched: number; sent: boolean; to?: number; skipped?: string; error?: string; draft?: QhMailDraft }

type Vals = Record<string, string | number | null>;
export interface TraceResult {
  q: string; total: number; truncated: boolean;
  results: { fileId: string; fileName: string; sheetId: string; sheetName: string; rowId: string; row: Vals; plan: { fileId: string; fileName: string; item: Vals | null; materials: Vals[] } | null }[];
}
export const inkNewsApi = {
  get: () => get<{ tagIds: string[] }>('/inkcode/news-tags'),
  set: (tagIds: string[]) => put<{ tagIds: string[] }>('/inkcode/news-tags', { tagIds }),
};
export const inkTraceApi = { trace: (q: string) => get<TraceResult>('/inkcode/trace', { q }) };

export type DropResult = AutoResult | { needsMicrosoft: { connectorId: string; configured: boolean; message: string } };
export const inkcodeAutoApi = {
  planFolder: () => get<{ folderId: string }>('/inkcode/plan/folder'),
  dropUrl: (url: string, folderId: string) => post<DropResult>('/inkcode/plan/drop-url', { url, folderId }, { timeout: 300_000 }),
  msConnector: () => post<{ id: string; configured: boolean }>('/inkcode/plan/ms-connector', {}),
  drop: (file: File, folderId: string) => post<AutoResult>('/inkcode/plan/drop', form(file, '', { folderId }), { timeout: 300_000 }),
  preview: (file: File, o: { date?: string; lineMap: Record<string, string>; plantMap: Record<string, string> }) =>
    post<AutoPreview>('/inkcode/plan/auto/preview', form(file, '', { ...(o.date ? { date: o.date } : {}), lineMap: JSON.stringify(o.lineMap), plantMap: JSON.stringify(o.plantMap) }), { timeout: 120_000 }),
  import: (file: File, o: { date?: string; onlyMatched: boolean; lineMap: Record<string, string>; plantMap: Record<string, string> }) =>
    post<AutoResult>('/inkcode/plan/auto/import', form(file, '', { ...(o.date ? { date: o.date } : {}), onlyMatched: o.onlyMatched ? '1' : '0', lineMap: JSON.stringify(o.lineMap), plantMap: JSON.stringify(o.plantMap) }), { timeout: 300_000 }),
};

export interface QhMailConfig { enabled: boolean; channel: 'smtp' | 'outlook'; to: string[]; cc: string[]; subject: string; intro: string }
export interface OutlookStatus { configured: boolean; connected: boolean; account: string | null; name: string | null }
export interface SmtpPublic { host: string; port: number; secure: boolean; user: string; from: string; allowSelfSigned: boolean; hasPassword: boolean; configured: boolean }
export type SmtpInput = Omit<SmtpPublic, 'hasPassword' | 'configured'> & { password?: string };
export const qhMailApi = {
  get: () => get<{ config: QhMailConfig; outlook: OutlookStatus; smtp: SmtpPublic }>('/inkcode/qh-mail'),
  saveSmtp: (s: SmtpInput) => put<{ smtp: SmtpPublic }>('/inkcode/qh-mail/smtp', s),
  save: (c: QhMailConfig) => put<{ config: QhMailConfig }>('/inkcode/qh-mail', c),
  test: () => post<{ sentTo: string }>('/inkcode/qh-mail/test', {}, { timeout: 60_000 }),
  disconnect: () => del<{ outlook: OutlookStatus }>('/inkcode/qh-mail/outlook'),
  start: () => get<{ url: string }>('/connectors/mail/ms/start'),
};
