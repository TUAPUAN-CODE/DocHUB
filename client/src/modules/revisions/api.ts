import { get, post, put } from '@/api/client';
import type { CellValue } from '@/types';

export interface RevMeta {
  revNo: number; note: string | null; rowCount: number; added: number; changed: number; removed: number;
  createdAt: string; createdBy: string; createdByName: string | null;
}
export interface RowRef { id: string; no: number; label: string; by?: CellValue; at?: CellValue }
export interface FieldValue { columnId: string; name: string; type: string; value: CellValue }
export interface FieldChange { columnId: string; name: string; type: string; old: CellValue; new: CellValue }
export interface RevDiff {
  added: (RowRef & { values: FieldValue[] })[];
  removed: (RowRef & { values: FieldValue[] })[];
  changed: (RowRef & { fields: FieldChange[] })[];
  columns: { added: string[]; removed: string[]; renamed: { from: string; to: string }[] };
}
export interface RevList { revisions: RevMeta[]; pending: { added: number; changed: number; removed: number } | null; keyColumnIds: string[]; canIssue: boolean }

export const revisionsApi = {
  list: (sheetId: string) => get<RevList>(`/sheets/${sheetId}/revisions`),
  pending: (sheetId: string) => get<{ base: RevMeta | null; diff: RevDiff | null }>(`/sheets/${sheetId}/revisions/pending`),
  get: (sheetId: string, rev: number | 'latest') => get<{ meta: RevMeta; diff: RevDiff | null; prevRevNo: number | null }>(`/sheets/${sheetId}/revisions/${rev}`),
  create: (sheetId: string, b: { note?: string | null; firstRevNo?: number | null }) => post<{ revNo: number; rowCount: number; diff: RevDiff | null }>(`/sheets/${sheetId}/revisions`, b),
  settings: (sheetId: string, keyColumnIds: string[]) => put(`/sheets/${sheetId}/revisions/settings`, { keyColumnIds }),
};

export const pendingTotal = (p: RevList['pending']) => (p ? p.added + p.changed + p.removed : 0);
