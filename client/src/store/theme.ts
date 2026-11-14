import { create } from 'zustand';
import { themesApi } from '@/api/endpoints';
import { applyTheme, DARK, DEFAULT_THEME, LIGHT, mergeTheme, Theme } from '@/lib/theme';

interface ThemeState {
  saved: Theme;
  draft: Theme;
  orgDefault: Theme | null;
  hasPersonal: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  update: (fn: (t: Theme) => Theme) => void;
  setMode: (mode: 'light' | 'dark') => void;
  save: () => Promise<void>;
  revert: () => void;
  resetPersonal: () => Promise<void>;
  saveAsOrg: () => Promise<void>;
  resetOrg: () => Promise<void>;
}

const CACHE = 'dsp_theme_cache';
const cached = (): Theme | null => {
  try {
    const s = localStorage.getItem(CACHE);
    return s ? mergeTheme(DEFAULT_THEME, JSON.parse(s)) : null;
  } catch {
    return null;
  }
};
const initial = cached() ?? DEFAULT_THEME;
applyTheme(initial);

export const useTheme = create<ThemeState>((set, get) => ({
  saved: initial,
  draft: initial,
  orgDefault: null,
  hasPersonal: false,
  loaded: false,
  load: async () => {
    try {
      const r = await themesApi.me();
      const org = r.orgDefault ? mergeTheme(DEFAULT_THEME, r.orgDefault) : null;
      const t = mergeTheme(org ?? DEFAULT_THEME, r.theme);
      applyTheme(t);
      localStorage.setItem(CACHE, JSON.stringify(t));
      set({ saved: t, draft: t, orgDefault: org, hasPersonal: !!r.theme, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  update: (fn) => {
    const t = fn(get().draft);
    applyTheme(t);
    set({ draft: t });
  },
  setMode: (mode) => get().update((t) => ({ ...t, mode, colors: { ...(mode === 'dark' ? DARK : LIGHT), primary: t.colors.primary } })),
  save: async () => {
    const t = get().draft;
    await themesApi.save(t);
    localStorage.setItem(CACHE, JSON.stringify(t));
    set({ saved: t, hasPersonal: true });
  },
  revert: () => {
    applyTheme(get().saved);
    set({ draft: get().saved });
  },
  resetPersonal: async () => {
    await themesApi.reset();
    const t = get().orgDefault ?? DEFAULT_THEME;
    applyTheme(t);
    localStorage.setItem(CACHE, JSON.stringify(t));
    set({ saved: t, draft: t, hasPersonal: false });
  },
  saveAsOrg: async () => {
    await themesApi.saveOrg(get().draft);
    set({ orgDefault: get().draft });
  },
  resetOrg: async () => {
    await themesApi.resetOrg();
    set({ orgDefault: null });
  },
}));

export const resetThemeToDefault = () => {
  localStorage.removeItem(CACHE);
  applyTheme(DEFAULT_THEME);
  useTheme.setState({ saved: DEFAULT_THEME, draft: DEFAULT_THEME, loaded: false });
};

/** aurora shell (white floating menu, glass top bar) or classic (coloured left bar); dark mode is always classic */
export const useShell = () => useTheme((s) => (s.draft.mode === 'light' && (s.draft.shell ?? 'aurora') === 'aurora' ? 'aurora' : 'classic'));
