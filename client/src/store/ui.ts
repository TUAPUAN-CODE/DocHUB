import { create } from 'zustand';
import { apiError } from '@/api/client';

export interface Toast { id: number; type: 'success' | 'error' | 'info'; title: string; message?: string }
export interface ConfirmOpts { title: string; message?: string; confirmText?: string; cancelText?: string; danger?: boolean }
interface OpenTransition { rect: { x: number; y: number; w: number; h: number }; color: string; name: string }

interface UiState {
  toasts: Toast[];
  confirmState: (ConfirmOpts & { resolve: (v: boolean) => void }) | null;
  openTransition: OpenTransition | null;
  mobileNav: boolean;
  /** desktop left bar shows only the icons */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setOpenTransition: (t: OpenTransition | null) => void;
  setMobileNav: (v: boolean) => void;
}

let seq = 1;
export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  confirmState: null,
  openTransition: null,
  mobileNav: false,
  sidebarCollapsed: (() => { try { return localStorage.getItem('ds.sidebarCollapsed') === '1'; } catch { return false; } })(),
  setSidebarCollapsed: (sidebarCollapsed) => { try { localStorage.setItem('ds.sidebarCollapsed', sidebarCollapsed ? '1' : '0'); } catch { /* private mode: the choice just is not remembered */ } set({ sidebarCollapsed }); },
  pushToast: (t) => {
    const id = seq++;
    set({ toasts: [...get().toasts.slice(-4), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.type === 'error' ? 6500 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
  setOpenTransition: (openTransition) => set({ openTransition }),
  setMobileNav: (mobileNav) => set({ mobileNav }),
}));

export const toast = {
  success: (title: string, message?: string) => useUi.getState().pushToast({ type: 'success', title, message }),
  info: (title: string, message?: string) => useUi.getState().pushToast({ type: 'info', title, message }),
  error: (e: unknown, title = 'ทำรายการไม่สำเร็จ') =>
    useUi.getState().pushToast({ type: 'error', title, message: typeof e === 'string' ? e : apiError(e).message }),
};

export const confirmDialog = (opts: ConfirmOpts) =>
  new Promise<boolean>((resolve) => useUi.setState({ confirmState: { ...opts, resolve } }));
