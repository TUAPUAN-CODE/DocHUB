import { get, post, put } from '@/api/client';
import type { CellValue } from '@/types';

export interface RevMeta {
  revNo: number; note: string | null; rowCount: number; added: number; changed: number; removed: number;
  /** data = Master Data / ทั่วไป · format = a แบบฟอร์มบันทึก revision (its format only) */
  kind: 'data' | 'format'; formatChanges: number;
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
/** what changed in the sheet's format (columns, options, form layout, PDF layouts) */
export interface FormatDiff {
  columns: { added: string[]; removed: string[]; renamed: { from: string; to: string }[]; changed: { name: string; what: string[] }[]; reordered: boolean };
  settings: string[];
  pdf: { added: string[]; removed: string[]; changed: string[] };
}
export type DocType = 'master_data' | 'record' | null;
export interface RevList {
  revisions: RevMeta[]; pending: { added: number; changed: number; removed: number } | null;
  /** format changes since the latest Rev (null: that Rev kept no format) */
  pendingFormat: number | null; docType: DocType; keyColumnIds: string[]; canIssue: boolean;
}
export const formatCount = (d: FormatDiff | null | undefined) => (d
  ? d.columns.added.length + d.columns.removed.length + d.columns.renamed.length + d.columns.changed.length + (d.columns.reordered ? 1 : 0) + d.settings.length + d.pdf.added.length + d.pdf.removed.length + d.pdf.changed.length
  : 0);

export const revisionsApi = {
  list: (sheetId: string) => get<RevList>(`/sheets/${sheetId}/revisions`),
  pending: (sheetId: string) => get<{ base: RevMeta | null; diff: RevDiff | null; formatDiff: FormatDiff | null; docType: DocType }>(`/sheets/${sheetId}/revisions/pending`),
  get: (sheetId: string, rev: number | 'latest') => get<{ meta: RevMeta; diff: RevDiff | null; formatDiff: FormatDiff | null; prevRevNo: number | null }>(`/sheets/${sheetId}/revisions/${rev}`),
  create: (sheetId: string, b: { note?: string | null; firstRevNo?: number | null }) => post<{ revNo: number; rowCount: number; diff: RevDiff | null; formatDiff: FormatDiff | null; kind: 'data' | 'format' }>(`/sheets/${sheetId}/revisions`, b),
  settings: (sheetId: string, keyColumnIds: string[]) => put(`/sheets/${sheetId}/revisions/settings`, { keyColumnIds }),
};

export const pendingTotal = (p: RevList['pending']) => (p ? p.added + p.changed + p.removed : 0);

export const docTypesApi = {
  setFile: (fileId: string, docType: DocType) => put<{ docType: DocType; firstRevs: number }>(`/files/${fileId}/doc-type`, { docType }),
  setFolder: (folderId: string, b: { docType: DocType; includeSubfolders: boolean; onlyUntyped: boolean }) => put<{ files: number; firstRevs: number }>(`/folders/${folderId}/doc-type`, b),
  pdfRevisions: (fileId: string) => get<{ revNo: number; sheetName: string; createdAt: string; template: unknown }[]>(`/files/${fileId}/pdf-revisions`),
};
