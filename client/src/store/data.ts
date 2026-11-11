import { create } from 'zustand';
import { accountRequestsApi, FavoriteItem, favoritesApi, foldersApi, requestsApi } from '@/api/endpoints';
import { newsApi } from '@/modules/news/api';
import { tagRequestsApi } from '@/modules/tags/api';
import { isAdminRole, type FolderItem } from '@/types';
import { toast } from './ui';

interface DataState {
  favorites: FavoriteItem[];
  tree: FolderItem[];
  pendingReviews: number;
  /** admin: requests for a new account waiting for approval */
  pendingAccounts: number;
  /** master / admin: tag requests sent to me */
  pendingTagRequests: number;
  /** news posts I have not seen yet */
  newsUnread: number;
  loadNews: () => Promise<void>;
  setNewsUnread: (n: number) => void;
  loadFavorites: () => Promise<void>;
  loadTree: () => Promise<void>;
  loadPending: () => Promise<void>;
  toggleFavorite: (type: 'file' | 'folder', id: string) => Promise<boolean | null>;
  isFavorite: (type: 'file' | 'folder', id: string) => boolean;
}

export const useData = create<DataState>((set, get) => ({
  favorites: [],
  tree: [],
  pendingReviews: 0,
  pendingAccounts: 0,
  pendingTagRequests: 0,
  newsUnread: 0,
  loadNews: async () => {
    try {
      const { useAuth } = await import('./auth');
      const { canSee } = await import('@/lib/pages');
      set({ newsUnread: canSee(useAuth.getState().user, 'news') ? (await newsApi.unreadCount()).count : 0 });
    } catch { /* ignore */ }
  },
  setNewsUnread: (n) => set({ newsUnread: n }),
  loadFavorites: async () => {
    try {
      set({ favorites: await favoritesApi.list() });
    } catch { /* ignore */ }
  },
  loadTree: async () => {
    try {
      set({ tree: await foldersApi.tree() });
    } catch { /* ignore */ }
  },
  loadPending: async () => {
    try {
      set({ pendingReviews: (await requestsApi.pendingCount()).count });
    } catch { /* ignore */ }
    try {
      const { useAuth } = await import('./auth'); // (auth imports this store)
      set({ pendingAccounts: isAdminRole(useAuth.getState().user?.role) ? (await accountRequestsApi.pendingCount()).count : 0 });
    } catch { /* ignore */ }
    try {
      set({ pendingTagRequests: (await tagRequestsApi.pendingCount()).count });
    } catch { /* ignore */ }
  },
  toggleFavorite: async (type, id) => {
    try {
      const r = await favoritesApi.toggle(type, id);
      void get().loadFavorites();
      set({ tree: get().tree.map((f) => (type === 'folder' && f.id === id ? { ...f, favorite: r.favorite } : f)) });
      return r.favorite;
    } catch (e) {
      toast.error(e);
      return null;
    }
  },
  isFavorite: (type, id) => get().favorites.some((f) => f.type === type && f.id === id),
}));
