import { loadMainFont } from './fonts';

export type ComponentKey = 'sidebar' | 'topbar' | 'card' | 'button' | 'input' | 'tableHeader' | 'tableCell' | 'modal' | 'widget';
export type ShadowLevel = 'none' | 'sm' | 'md' | 'lg';
export interface ComponentStyle { bg?: string; text?: string; border?: string; borderWidth?: number; radius?: number; padding?: number; shadow?: ShadowLevel }
export interface ThemeColors {
  primary: string; accent: string; bg: string; surface: string; text: string; muted: string; border: string;
  success: string; warning: string; danger: string; sidebar: string; sidebarText: string;
}
export interface Theme {
  version: 1; mode: 'light' | 'dark'; colors: ThemeColors; radius: number; gap: number; fontFamily: string; fontSize: number;
  sidebarWidth: number; components: Partial<Record<ComponentKey, ComponentStyle>>;
}

export const LIGHT: ThemeColors = {
  primary: '#1552F0', accent: '#16A34A', bg: '#F1F4FB', surface: '#FFFFFF', text: '#1B2333', muted: '#6B7489', border: '#E3E8F2',
  success: '#16A34A', warning: '#F59E0B', danger: '#E5484D', sidebar: '#1552F0', sidebarText: '#FFFFFF',
};
export const DARK: ThemeColors = {
  primary: '#4C7DFF', accent: '#22C55E', bg: '#0E1320', surface: '#161C2C', text: '#E6EAF2', muted: '#8D97AD', border: '#26304A',
  success: '#22C55E', warning: '#FBBF24', danger: '#F87171', sidebar: '#10193A', sidebarText: '#E6EAF2',
};
export const DEFAULT_THEME: Theme = {
  version: 1, mode: 'light', colors: LIGHT, radius: 14, gap: 16, fontFamily: 'Prompt', fontSize: 14, sidebarWidth: 256, components: {},
};

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  sidebar: 'แถบเมนูด้านข้าง', topbar: 'แถบด้านบน', card: 'การ์ด / กล่องเนื้อหา', button: 'ปุ่ม', input: 'ช่องกรอกข้อมูล',
  tableHeader: 'หัวตาราง', tableCell: 'เซลล์ตาราง', modal: 'หน้าต่างป๊อปอัป', widget: 'วิดเจ็ตแดชบอร์ด (ค่าเริ่มต้น)',
};

export const SHADOWS: Record<ShadowLevel, string> = {
  none: 'none',
  sm: '0 1px 2px rgb(16 24 40 / .05), 0 1px 3px rgb(16 24 40 / .07)',
  md: '0 4px 12px -2px rgb(16 24 40 / .10), 0 2px 4px -2px rgb(16 24 40 / .06)',
  lg: '0 20px 40px -8px rgb(16 24 40 / .22), 0 8px 16px -8px rgb(16 24 40 / .12)',
};

export function hexToRgb(hex: string): string {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return '0 0 0';
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
/** Mix two hex colors (t = 0..1 of b) */
export function mix(a: string, b: string, t: number) {
  const [r1, g1, b1] = hexToRgb(a).split(' ').map(Number);
  const [r2, g2, b2] = hexToRgb(b).split(' ').map(Number);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

export function mergeTheme(base: Theme, patch?: Partial<Theme> | null): Theme {
  if (!patch) return base;
  return {
    ...base, ...patch, version: 1,
    colors: { ...base.colors, ...(patch.colors ?? {}) },
    components: { ...base.components, ...(patch.components ?? {}) },
  };
}

/** Resolved style of every component: user override → derived default */
export function resolveComponents(t: Theme): Record<ComponentKey, Required<ComponentStyle>> {
  const c = t.colors;
  const headerBg = mix(c.surface, c.bg, t.mode === 'dark' ? 0.5 : 0.7);
  const defaults: Record<ComponentKey, Required<ComponentStyle>> = {
    sidebar: { bg: c.sidebar, text: c.sidebarText, border: 'transparent', borderWidth: 0, radius: 0, padding: 16, shadow: 'none' },
    topbar: { bg: c.bg, text: c.text, border: 'transparent', borderWidth: 0, radius: 0, padding: 16, shadow: 'none' },
    card: { bg: c.surface, text: c.text, border: c.border, borderWidth: 1, radius: t.radius, padding: t.gap, shadow: 'sm' },
    button: { bg: c.primary, text: '#FFFFFF', border: 'transparent', borderWidth: 0, radius: Math.max(6, t.radius - 4), padding: 14, shadow: 'none' },
    input: { bg: c.surface, text: c.text, border: c.border, borderWidth: 1, radius: Math.max(6, t.radius - 4), padding: 12, shadow: 'none' },
    tableHeader: { bg: headerBg, text: c.muted, border: c.border, borderWidth: 1, radius: 0, padding: 8, shadow: 'none' },
    tableCell: { bg: c.surface, text: c.text, border: mix(c.border, c.surface, 0.25), borderWidth: 1, radius: 0, padding: 8, shadow: 'none' },
    modal: { bg: c.surface, text: c.text, border: c.border, borderWidth: 1, radius: t.radius + 6, padding: 24, shadow: 'lg' },
    widget: { bg: c.surface, text: c.text, border: c.border, borderWidth: 1, radius: t.radius + 2, padding: 16, shadow: 'sm' },
  };
  const out = {} as Record<ComponentKey, Required<ComponentStyle>>;
  (Object.keys(defaults) as ComponentKey[]).forEach((k) => {
    const o = t.components[k] ?? {};
    const clean = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')) as ComponentStyle;
    out[k] = { ...defaults[k], ...clean };
  });
  return out;
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  const s = root.style;
  (Object.keys(t.colors) as (keyof ThemeColors)[]).forEach((k) => s.setProperty(`--c-${k}`, hexToRgb(t.colors[k])));
  s.setProperty('--radius', `${t.radius}px`);
  s.setProperty('--gap', `${t.gap}px`);
  s.setProperty('--font', `'${t.fontFamily}'`);
  s.setProperty('--fs', `${t.fontSize}px`);
  s.setProperty('--sidebar-w', `${t.sidebarWidth}px`);
  const comps = resolveComponents(t);
  (Object.keys(comps) as ComponentKey[]).forEach((k) => {
    const c = comps[k];
    s.setProperty(`--${k}-bg`, c.bg);
    s.setProperty(`--${k}-text`, c.text);
    s.setProperty(`--${k}-border`, c.border);
    s.setProperty(`--${k}-bw`, `${c.borderWidth}px`);
    s.setProperty(`--${k}-radius`, `${c.radius}px`);
    s.setProperty(`--${k}-pad`, `${c.padding}px`);
    s.setProperty(`--${k}-shadow`, SHADOWS[c.shadow] ?? 'none');
  });
  root.classList.toggle('dark', t.mode === 'dark');
  root.style.colorScheme = t.mode;
  // the phone browser's bars / status bar take the top bar's colour, so the app reads as one full screen (not blue bands)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', comps.topbar.bg);
  loadMainFont(t.fontFamily);
}
