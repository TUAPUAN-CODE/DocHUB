import { rowsApi } from '@/api/endpoints';
import { loadCols } from '@/lib/dashCols';
import type { Column, ColumnFilter, Row, SortSpec } from '@/types';
import { sampleRow } from './sample';
import type { Block, FieldsBlock, PdfTemplate, TableBlock, TableCol } from './types';

export interface SheetData { sheetId: string; columns: Column[]; rows: Row[]; total: number; truncated: boolean }
export interface CurrentView { sheetId: string; sheetName?: string; filters: ColumnFilter[]; sorts: SortSpec[]; search?: string; selectedRowIds?: string[] }

/**
 * A layout with `followSheet` is saved once and printed from any sheet: the sheet it was designed on is swapped for the sheet being
 * exported. Columns are found by name (see resolveColumns), so every daily sheet with the same columns works.
 */
export function bindToCurrent(t: PdfTemplate, cur: CurrentView | null): PdfTemplate {
  if (!t.followSheet || !cur) return t;
  const from = t.mode === 'perRow' ? t.perRow?.sheetId : tableBlocks(t)[0]?.sheetId;
  if (!from || from === cur.sheetId) return t;
  const name = cur.sheetName ?? '';
  return {
    ...t,
    perRow: t.perRow && t.perRow.sheetId === from ? { ...t.perRow, sheetId: cur.sheetId, sheetName: name || t.perRow.sheetName } : t.perRow,
    blocks: t.blocks.map((b) => (b.type === 'table' && b.sheetId === from ? { ...b, sheetId: cur.sheetId, sheetName: name || b.sheetName } : b)),
  };
}

export const resolveColumns = (refs: TableCol[], cols: Column[]) =>
  refs.map((r) => ({ ref: r, col: cols.find((c) => c.id === r.columnId) ?? cols.find((c) => c.name.trim().toLowerCase() === r.columnName?.trim().toLowerCase()) })).filter((x): x is { ref: TableCol; col: Column } => !!x.col);

const allBlocks = (t: PdfTemplate): Block[] => [...t.blocks, ...t.header.blocks, ...t.footer.blocks];
export const tableBlocks = (t: PdfTemplate) => t.blocks.filter((b): b is TableBlock => b.type === 'table');
export const fieldBlocks = (t: PdfTemplate) => t.blocks.filter((b): b is FieldsBlock => b.type === 'fields');

/** Loads the rows each table needs. `limit` caps the rows per table (small for the live preview). */
export async function collectData(t: PdfTemplate, cur: CurrentView | null, opts: { limit?: number; onProgress?: (msg: string) => void; sample?: boolean } = {}): Promise<Map<string, SheetData>> {
  const out = new Map<string, SheetData>();
  const jobs: { sheetId: string; limit: number | null; useCurrent: boolean; key: string }[] = [];
  if (t.mode === 'perRow' && t.perRow?.sheetId) jobs.push({ sheetId: t.perRow.sheetId, limit: null, useCurrent: true, key: t.perRow.sheetId });
  for (const b of tableBlocks(t)) if (b.sheetId) jobs.push({ sheetId: b.sheetId, limit: b.limit, useCurrent: b.useCurrentFilters, key: `${b.id}` });
  void allBlocks;
  for (const j of jobs) {
    const cols = await loadCols(j.sheetId);
    const useCur = j.useCurrent && cur?.sheetId === j.sheetId;
    const cap = Math.min(j.limit ?? 50_000, opts.limit ?? 50_000);
    const rows: Row[] = [];
    let total = 0;
    for (let p = 1; p <= 100 && rows.length < cap; p++) {
      opts.onProgress?.(`กำลังโหลดข้อมูล ${rows.length.toLocaleString()} แถว…`);
      const r = await rowsApi.query(j.sheetId, { page: p, pageSize: 1000, sorts: useCur ? cur!.sorts : [], filters: useCur ? cur!.filters : [], search: useCur ? cur!.search || undefined : undefined });
      total = r.total;
      rows.push(...r.rows);
      if (rows.length >= r.total) break;
    }
    let use = rows.slice(0, cap);
    if (t.mode === 'perRow' && j.sheetId === t.perRow?.sheetId && t.perRow.onlySelected && cur?.selectedRowIds?.length) use = rows.filter((r) => cur.selectedRowIds!.includes(r.id));
    // designer preview of a sheet without rows: one example row, so the layout can be seen
    if (opts.sample && !use.length && t.mode === 'perRow' && j.sheetId === t.perRow?.sheetId) use = [sampleRow(cols)];
    out.set(j.key, { sheetId: j.sheetId, columns: cols, rows: use, total: Math.min(total, cap), truncated: total > cap });
  }
  return out;
}
