import { del, get, post, put } from '@/api/client';

export interface AppItem {
  key: string; kind: 'dashboard' | 'page' | 'file' | 'folder' | 'url'; name: string; defaultName: string; iconUrl: string | null; color: string;
  description: string | null; to: string | null; external: string | null; hidden: boolean; roles: string[]; tagIds: string[]; source: string;
  sortOrder: number | null; custom: boolean;
}
export interface AppDetails {
  app: AppItem;
  source: { kind: string; path: string; link: string | null; fileId: string | null; folderId: string | null };
  access: {
    note: string;
    users: { name: string; role: string; permission: string; via: string }[];
    tags: { name: string; color: string; permission: string; via: string }[];
    limitRoles: string[]; limitTags: { name: string; color: string }[];
  };
}
export interface AppEdit { name?: string | null; iconUrl?: string | null; color?: string | null; description?: string | null; roles: string[]; tagIds: string[]; hidden: boolean; sortOrder?: number | null }

export const appsApi = {
  list: () => get<AppItem[]>('/apps'),
  details: (key: string) => get<AppDetails>('/apps/details', { key }),
  update: (key: string, b: AppEdit) => put<AppItem>(`/apps/item?key=${encodeURIComponent(key)}`, b),
  add: (b: AppEdit & { kind: 'file' | 'folder' | 'dashboard' | 'url'; refId?: string | null; url?: string | null }) => post<{ key: string }>('/apps', b),
  remove: (key: string) => del(`/apps/item?key=${encodeURIComponent(key)}`),
};
