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
  /** a sheet shown with its tools hidden: the app's top bar steps aside too, so a phone shows as many rows as possible */
  focusMode: boolean;
  /** desktop left bar: full · icons only · hidden (remembered in this browser) */
  navMode: NavMode;
  /** whole-app zoom in % (remembered in this browser) */
  uiZoom: number;
  setNavMode: (m: NavMode) => void;
  setUiZoom: (z: number) => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setOpenTransition: (t: OpenTransition | null) => void;
  setMobileNav: (v: boolean) => void;
  setFocusMode: (v: boolean) => void;
}

export type NavMode = 'full' | 'icons' | 'hidden';
export const ZOOM_STEPS = [70, 80, 90, 100, 110, 125, 150];
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const applyZoom = (z: number) => { document.documentElement.style.zoom = z === 100 ? '' : String(z / 100); };
const savedNav = read('dsp.navMode');
const savedZoom = Number(read('dsp.uiZoom')) || 100;
applyZoom(savedZoom);

let seq = 1;
export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  confirmState: null,
  openTransition: null,
  mobileNav: false,
  focusMode: false,
  navMode: savedNav === 'icons' || savedNav === 'hidden' ? savedNav : 'full',
  uiZoom: savedZoom,
  setNavMode: (navMode) => { write('dsp.navMode', navMode); set({ navMode }); },
  setUiZoom: (uiZoom) => { write('dsp.uiZoom', String(uiZoom)); applyZoom(uiZoom); set({ uiZoom }); },
  pushToast: (t) => {
    const id = seq++;
    set({ toasts: [...get().toasts.slice(-4), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.type === 'error' ? 6500 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
  setOpenTransition: (openTransition) => set({ openTransition }),
  setMobileNav: (mobileNav) => set({ mobileNav }),
  setFocusMode: (focusMode) => set({ focusMode }),
}));

export const toast = {
  success: (title: string, message?: string) => useUi.getState().pushToast({ type: 'success', title, message }),
  info: (title: string, message?: string) => useUi.getState().pushToast({ type: 'info', title, message }),
  error: (e: unknown, title = 'ทำรายการไม่สำเร็จ') =>
    useUi.getState().pushToast({ type: 'error', title, message: typeof e === 'string' ? e : apiError(e).message }),
};

export const confirmDialog = (opts: ConfirmOpts) =>
  new Promise<boolean>((resolve) => useUi.setState({ confirmState: { ...opts, resolve } }));
