import { create } from 'zustand';
import { get, put } from '@/api/client';

/** The app's name (Quality by default) and icon — set by an admin on ตั้งค่า → ชื่อระบบ */
export const DEFAULT_APP_NAME = 'Quality';
export type AppIcons = { '512': string; '192': string; '180': string };

function apply(name: string) {
  document.title = name;
  // iPhone "Add to Home Screen" reads this; Android reads the manifest (served with the same name by the server)
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
}
/** browser tab icon: the uploaded one, or the built-in one of index.html */
let builtInIcon: string | null = null;
function applyIcon(url: string | null) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (builtInIcon === null) builtInIcon = link.href;
  link.href = url ? `${url}?v=${encodeURIComponent(url)}` : builtInIcon;
  if (url) link.type = 'image/png'; else link.removeAttribute('type');
}

export const useAppInfo = create<{
  name: string; icon: string | null;
  load: () => Promise<void>; save: (name: string) => Promise<void>; saveIcon: (icons: AppIcons | null) => Promise<void>;
}>((set) => ({
  name: DEFAULT_APP_NAME,
  icon: null,
  load: async () => {
    try {
      const r = await get<{ name: string; icon?: string | null }>('/app-info');
      set({ name: r.name, icon: r.icon ?? null });
      apply(r.name);
      applyIcon(r.icon ?? null);
    } catch { /* keep the default */ }
  },
  save: async (name) => {
    const r = await put<{ name: string }>('/app-info', { name });
    set({ name: r.name });
    apply(r.name);
  },
  saveIcon: async (icons) => {
    const r = await put<{ icon: string | null }>('/app-info/icon', { icons });
    set({ icon: r.icon });
    applyIcon(r.icon);
  },
}));
