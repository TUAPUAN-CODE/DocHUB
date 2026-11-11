import { del, get, post, put } from '@/api/client';
import type { Role } from '@/types';

export interface NewsTag { id: string; name: string; color: string; isSystem: boolean }
export interface NewsPost {
  id: string; title: string; body: string; images: string[]; linkUrl: string | null; pinned: boolean;
  createdAt: string; updatedAt: string; updatedByName: string | null;
  author: { id: string; displayName: string; avatarUrl: string | null; role: Role };
  tags: NewsTag[]; canEdit: boolean; isNew: boolean;
}
export interface NewsBody { title: string; body: string; tagIds: string[]; images: string[]; linkUrl: string | null; pinned: boolean }

export const newsApi = {
  list: (p: { page?: number; q?: string; tag?: string; mine?: boolean }) =>
    get<{ items: NewsPost[]; total: number; page: number; pageSize: number; canPin: boolean; canPost: boolean }>('/news', { ...p, mine: p.mine ? '1' : undefined }),
  get: (id: string) => get<NewsPost>(`/news/${id}`),
  unreadCount: () => get<{ count: number }>('/news/unread-count'),
  seen: () => post<{ count: number }>('/news/seen', {}),
  create: (b: NewsBody) => post<NewsPost>('/news', b),
  update: (id: string, b: NewsBody) => put<NewsPost>(`/news/${id}`, b),
  pin: (id: string, pinned: boolean) => post<{ pinned: boolean }>(`/news/${id}/pin`, { pinned }),
  remove: (id: string) => del(`/news/${id}`),
};
