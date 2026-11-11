import { create } from 'zustand';
import { get, put } from '@/api/client';

/** The app's name (Quality by default) — set by an admin on ตั้งค่า → ชื่อระบบ */
export const DEFAULT_APP_NAME = 'Quality';

function apply(name: string) {
  document.title = name;
  // iPhone "Add to Home Screen" reads this; Android reads the manifest (served with the same name by the server)
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', name);
}

export const useAppInfo = create<{ name: string; load: () => Promise<void>; save: (name: string) => Promise<void> }>((set) => ({
  name: DEFAULT_APP_NAME,
  load: async () => {
    try {
      const r = await get<{ name: string }>('/app-info');
      set({ name: r.name });
      apply(r.name);
    } catch { /* keep the default */ }
  },
  save: async (name) => {
    const r = await put<{ name: string }>('/app-info', { name });
    set({ name: r.name });
    apply(r.name);
  },
}));
