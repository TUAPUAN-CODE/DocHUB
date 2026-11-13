import { get, put } from '@/api/client';
import type { Role } from '@/types';

export interface PageInfo { key: string; label: string; kind: 'page' | 'feature'; hint: string | null; floor: Role | null; always: boolean; rootOnly: boolean; defaults: Role[]; lockedFor?: Role[]; notInNav?: boolean }
export interface PageMatrix { roles: Role[]; pages: PageInfo[]; allowed: Record<string, string[]>; updatedAt: string | null; updatedBy: string | null; labels?: Record<string, string> }

export const pageAccessApi = {
  get: () => get<PageMatrix>('/page-access'),
  save: (allowed: Record<string, string[]>, labels?: Record<string, string>) => put<PageMatrix>('/page-access', { allowed, labels }),
};
