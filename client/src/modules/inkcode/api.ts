import { post } from '@/api/client';

export interface PlanItem {
  time: string | null; product: string; lineRaw: string; line: string; size: string | null; customer: string | null; country: string; doc: string; rev: string | null; qty: number | null; shift: 'DS' | 'NS'; sourceRow: number;
  inDb: boolean | null; market: string; dbMarkets: string[]; docInDb: boolean | null;
}
export interface PlanPreview { date: string | null; sheetName: string; warnings: string[]; knownLines: string[]; items: PlanItem[]; fillsTime: boolean; fillsQty: boolean }
export interface PlanImportResult { date: string; total: number; created: number; duplicate: number; skippedNotInDb: number; failed: { doc: string; line: string; reason: string }[] }

const form = (file: File, sheetId: string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.append('sheetId', sheetId);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  f.append('file', file);   // the file goes last: multer reads the text fields before it
  return f;
};

export const inkcodeApi = {
  previewPlan: (file: File, sheetId: string) => post<PlanPreview>('/inkcode/plan/preview', form(file, sheetId), { timeout: 120_000 }),
  importPlan: (file: File, sheetId: string, o: { date: string; onlyMatched: boolean; lineMap: Record<string, string> }) =>
    post<PlanImportResult>('/inkcode/plan/import', form(file, sheetId, { date: o.date, onlyMatched: o.onlyMatched ? '1' : '0', lineMap: JSON.stringify(o.lineMap) }), { timeout: 300_000 }),
};
