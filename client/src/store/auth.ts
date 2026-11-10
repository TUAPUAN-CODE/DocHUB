import { create } from 'zustand';
import { refreshAccessToken, setAccessToken, setAuthLostHandler } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import type { Role, User } from '@/types';
import { useData } from './data';
import { useNotifications } from './notifications';
import { resetThemeToDefault, useTheme } from './theme';
import { toast } from './ui';

interface AuthState {
  user: User | null;
  status: 'loading' | 'authed' | 'guest';
  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}

function afterSignIn(token: string) {
  const s = connectSocket(token);
  s.off('notification');
  s.on('notification', (n) => {
    useNotifications.getState().push(n);
    toast.info(n.title, n.message);
    if (n.type === 'access_request' || n.type === 'account_request') void useData.getState().loadPending();
    if (n.type === 'access_approved' || n.type === 'access_granted') void useData.getState().loadTree();
  });
  void useTheme.getState().load();
  void useData.getState().loadFavorites();
  void useData.getState().loadTree();
  void useData.getState().loadPending();
  void useNotifications.getState().load();
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  bootstrap: async () => {
    const token = await refreshAccessToken();
    if (!token) return set({ status: 'guest', user: null });
    try {
      const user = await authApi.me();
      set({ user, status: 'authed' });
      afterSignIn(token);
    } catch {
      set({ status: 'guest', user: null });
    }
  },
  login: async (username, password) => {
    const r = await authApi.login(username, password);
    setAccessToken(r.accessToken);
    set({ user: r.user, status: 'authed' });
    afterSignIn(r.accessToken);
  },
  logout: async () => {
    await authApi.logout().catch(() => undefined);
    setAccessToken(null);
    disconnectSocket();
    resetThemeToDefault();
    set({ user: null, status: 'guest' });
  },
  setUser: (user) => set({ user }),
}));

setAuthLostHandler(() => {
  setAccessToken(null);
  disconnectSocket();
  useAuth.setState({ user: null, status: 'guest' });
});

const RANK: Record<Role, number> = { viewer: 0, user: 1, master: 2, admin: 3 };
export const useIsAtLeast = (role: Role) => useAuth((s) => (s.user ? RANK[s.user.role] >= RANK[role] : false));
