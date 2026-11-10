import { get } from '@/api/client';
import type { CellValue, Column, UsersDict } from '@/types';

export interface DataHitRow { id: string; order: number; updatedAt: string; values: Record<string, CellValue>; matched: string[] }
export interface DataHitGroup { fileId: string; fileName: string; color: string; path: string; sheetId: string; sheetName: string; columns: Column[]; rows: DataHitRow[] }
export interface DataSearchResult { q: string; groups: DataHitGroup[]; total: number; truncated: boolean; users?: UsersDict }

export const dataSearchApi = {
  search: (q: string) => get<DataSearchResult>('/search/data', { q }),
};
