import { del, get, post, put } from '@/api/client';
import type { LinesCfg, MixCfg, ScanProfile } from '@/api/endpoints';
import type { Row } from '@/types';

export type ScanResult = { action: 'created' | 'updated' | 'ignored'; stamped?: string | null; rowNo: number; profile: { id: string; name: string }; row: Row };
export const linesApi = {
  save: (sheetId: string, lines: LinesCfg | null) => put(`/sheets/${sheetId}/lines/settings`, { lines }),
  list: (sheetId: string, rowId: string) => get<{ lines: Row[] }>(`/sheets/${sheetId}/rows/${rowId}/lines`),
  add: (sheetId: string, rowId: string, b: { text?: string; lineRowId?: string; profileId?: string | null }) => post<{ rowId: string; how: string; moved?: boolean; already?: boolean }>(`/sheets/${sheetId}/rows/${rowId}/lines`, b),
  remove: (sheetId: string, rowId: string, lineRowId: string) => del(`/sheets/${sheetId}/rows/${rowId}/lines/${lineRowId}`),
  action: (sheetId: string, rowId: string, index: number) => post<{ count: number }>(`/sheets/${sheetId}/rows/${rowId}/lines/action`, { index }),
  /** header sheet: the line row ids of each row (row id lower case → line ids) */
  map: (sheetId: string, rowIds: string[]) => post<Record<string, string[]>>(`/sheets/${sheetId}/lines/map`, { rowIds }),
  /** header sheet: number of lines of these rows (row id lower case → n) */
  counts: (sheetId: string, rowIds: string[]) => post<Record<string, number>>(`/sheets/${sheetId}/lines/counts`, { rowIds }),
  /** line sheet: the sheet whose rows hold this one's rows as lines */
  headerSheet: (sheetId: string) => get<{ sheetId: string; sheetName: string } | null>(`/sheets/${sheetId}/lines/header-sheet`),
  /** line sheet: the header row of each row (row id lower case → { rowId, label }) */
  parents: (sheetId: string, headerSheetId: string, rowIds: string[]) => post<Record<string, { rowId: string; label: string }>>(`/sheets/${sheetId}/lines/parents`, { rowIds, headerSheetId }),
};
export const formLayoutApi = {
  save: (sheetId: string, layout: import('@/api/endpoints').FormLayout | null) => put(`/sheets/${sheetId}/form-layout`, { layout }),
};
export const scanApi = {
  resolve: (sheetId: string, text: string) => post<{ profile: { id: string; name: string }; values: Record<string, string> }>(`/sheets/${sheetId}/scan/resolve`, { text }),
  saveProfiles: (sheetId: string, profiles: ScanProfile[]) => put(`/sheets/${sheetId}/scan/profiles`, { profiles }),
  scan: (sheetId: string, text: string, profileId?: string | null) => post<ScanResult>(`/sheets/${sheetId}/scan`, { text, profileId: profileId || null }),
  saveMix: (sheetId: string, mix: MixCfg | null) => put(`/sheets/${sheetId}/mix/settings`, { mix }),
  findForMix: (sheetId: string, value: string) => get<{ row: Row }>(`/sheets/${sheetId}/mix/find`, { value }),
  mix: (sheetId: string, b: { inputs: { rowId: string; qty: number }[]; outputQty?: number | null }) =>
    post<{ row: Row; rowNo: number; total: number; remaining: { rowId: string; remaining: number }[] }>(`/sheets/${sheetId}/mix`, b),
};

/** same split as the server (so the editor can show the pieces while typing a sample) */
export const splitScan = (text: string, delimiter: string): string[] => {
  const d = delimiter === '\\t' ? '\t' : delimiter;
  const t = text.replace(/[\r\n]+$/g, '');
  return (d ? t.split(d) : [t]).map((s) => s.trim());
};
