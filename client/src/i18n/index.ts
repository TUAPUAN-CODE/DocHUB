import { useCallback } from 'react';
import { create } from 'zustand';
import { en } from './en';
import { km } from './km';
import { my } from './my';

/**
 * Interface language. The Thai text in the source IS the key: t('หน้าแรก') returns the Thai text for "th" and the
 * translation for the other languages — a text without a translation stays Thai, so a page can be translated bit by bit
 * (see docs/I18N.md). Add a translation = one more line in en.ts / my.ts / km.ts.
 */
export type Lang = 'th' | 'en' | 'my' | 'km';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'th', label: 'ไทย' }, { code: 'en', label: 'English' }, { code: 'my', label: 'မြန်မာ' }, { code: 'km', label: 'ខ្មែរ' },
];
const DICT: Record<Exclude<Lang, 'th'>, Record<string, string>> = { en, my, km };
const KEY = 'ds:lang';

const initial = (): Lang => {
  try { const v = localStorage.getItem(KEY); if (v === 'th' || v === 'en' || v === 'my' || v === 'km') return v; } catch { /* storage blocked */ }
  return 'th';
};

/** Burmese / Khmer glyphs are not in the Thai UI font: load a script font only when needed */
const fontLoaded = new Set<string>();
async function applyScriptFont(lang: Lang) {
  let style = document.getElementById('lang-font') as HTMLStyleElement | null;
  if (lang !== 'my' && lang !== 'km') { style?.remove(); return; }
  if (!style) { style = document.createElement('style'); style.id = 'lang-font'; document.head.appendChild(style); }
  style.textContent = `body, button, input, select, textarea { font-family: ${lang === 'my' ? "'Noto Sans Myanmar'" : "'Noto Sans Khmer'"}, var(--font), 'Prompt', system-ui, sans-serif; }`;
  if (fontLoaded.has(lang)) return;
  fontLoaded.add(lang);
  try {
    if (lang === 'my') { await import('@fontsource/noto-sans-myanmar/myanmar-400.css'); await import('@fontsource/noto-sans-myanmar/myanmar-600.css'); }
    else { await import('@fontsource/noto-sans-khmer/khmer-400.css'); await import('@fontsource/noto-sans-khmer/khmer-600.css'); }
  } catch (e) { console.error('Script font load error:', e); }
}

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: initial(),
  setLang: (lang) => {
    try { localStorage.setItem(KEY, lang); } catch { /* storage blocked: the choice lasts until reload */ }
    document.documentElement.lang = lang;
    void applyScriptFont(lang);
    set({ lang });
  },
}));
if (typeof document !== 'undefined') { document.documentElement.lang = useLang.getState().lang; void applyScriptFont(useLang.getState().lang); }

export const tr = (thai: string, lang: Lang = useLang.getState().lang): string => (lang === 'th' ? thai : DICT[lang][thai] ?? thai);

/** Component hook: re-renders when the language changes */
export function useT() {
  const lang = useLang((s) => s.lang);
  return useCallback((thai: string) => tr(thai, lang), [lang]);
}
