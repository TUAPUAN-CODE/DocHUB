import type { ReactNode } from 'react';
import { Activity, AppWindow, BookOpen, ClipboardCheck, Cpu, Database, FolderOpen, History, Home, LayoutDashboard, Megaphone, Search, Settings, ShieldCheck, Trash2, Users, FileSpreadsheet } from 'lucide-react';
import type { Role, User } from '@/types';

/**
 * The left bar. Which items a role sees is set by a root on "จัดการสิทธิ์" (server: modules/pageAccess/registry.ts, same keys)
 * and comes with the signed-in user (user.pages). Root sees everything.
 */
/** requests = file access + new accounts + tags waiting for me */
export type Badge = 'requests' | 'news';
export interface NavPage { key: string; to: string; label: string; icon: ReactNode; badge?: Badge; match?: (path: string) => boolean;
  /** not an item of the left bar (opened as an app of "Application"); its access is still set on จัดการสิทธิ์ */
  notInNav?: boolean }

const i = 'h-[18px] w-[18px]';
export const NAV: NavPage[] = [
  { key: 'home', to: '/', label: 'หน้าแรก', icon: <Home className={i} />, match: (p) => p === '/' },
  { key: 'news', to: '/news', label: 'ข่าวสาร', icon: <Megaphone className={i} />, badge: 'news' },
  { key: 'browse', to: '/browse', label: 'ไฟล์ทั้งหมด', icon: <FolderOpen className={i} />, match: (p) => p.startsWith('/browse') || p.startsWith('/folders') || (p.startsWith('/files') && !p.includes('/dashboards/')) },
  { key: 'apps', to: '/apps', label: 'Application', icon: <AppWindow className={i} />, match: (p) => p.startsWith('/apps') || p.startsWith('/dashboards') || p.includes('/dashboards/') || p.startsWith('/inkcode/plan') },
  { key: 'requests', to: '/requests', label: 'คำขออนุมัติ', icon: <ClipboardCheck className={i} />, badge: 'requests', match: (p) => p.startsWith('/requests') },
  { key: 'audit', to: '/audit', label: 'ประวัติการแก้ไข', icon: <History className={i} /> },
  { key: 'users', to: '/users', label: 'จัดการผู้ใช้', icon: <Users className={i} /> },
  { key: 'monitor', to: '/monitor', label: 'Monitor', icon: <Activity className={i} /> },
  { key: 'permissions', to: '/permissions', label: 'จัดการสิทธิ์', icon: <ShieldCheck className={i} /> },
  { key: 'trash', to: '/trash', label: 'ถังขยะ', icon: <Trash2 className={i} /> },
  { key: 'devices', to: '/devices', label: 'อุปกรณ์ (RFID/IoT)', icon: <Cpu className={i} /> },
  { key: 'connectors', to: '/connectors', label: 'ดึงข้อมูลจากลิงก์/API', icon: <Database className={i} /> },
  { key: 'inkcodePlan', to: '/inkcode/plan', label: 'นำเข้าแผนผลิต', icon: <FileSpreadsheet className={i} />, notInNav: true },
  { key: 'search', to: '/traceback', label: 'Search', icon: <Search className={i} /> },
  { key: 'dashboards', to: '/dashboards', label: 'แดชบอร์ด', icon: <LayoutDashboard className={i} />, notInNav: true },
  { key: 'guide', to: '/guide', label: 'คู่มือ', icon: <BookOpen className={i} /> },
  { key: 'settings', to: '/settings', label: 'ตั้งค่า', icon: <Settings className={i} /> },
];

const ALL = ['home', 'news', 'browse', 'apps', 'requests', 'trash', 'search', 'dashboards', 'guide', 'settings'];
/** used only until the server says (same defaults as the server registry) */
const DEFAULTS: Record<Role, string[]> = {
  viewer: ALL, user: ALL,
  master: [...ALL, 'audit', 'devices', 'connectors', 'inkcodePlan'],
  admin: [...ALL, 'audit', 'devices', 'connectors', 'inkcodePlan', 'users', 'monitor', 'ai', 'permissions'],
  root: [...NAV.map((n) => n.key), 'ai'],
};
const ALWAYS = ['settings'];

export function canSee(user: Pick<User, 'role' | 'pages'> | null | undefined, key: string) {
  if (!user) return false;
  if (user.role === 'root' || ALWAYS.includes(key)) return true;
  return (user.pages ?? DEFAULTS[user.role] ?? []).includes(key);
}

/** the name of a left-bar item: as renamed by an admin on จัดการสิทธิ์, else the built-in one (which is translated) */
export const navLabel = (user: Pick<User, 'pageLabels'> | null | undefined, n: Pick<NavPage, 'key' | 'label'>) => user?.pageLabels?.[n.key] || null;

/** NAV in the order an admin set on จัดการสิทธิ์ (keys not in that list keep the built-in order, after it) */
export function orderedNav(order: string[] | undefined | null): NavPage[] {
  const at = new Map((order ?? []).map((k, i) => [k, i]));
  return NAV.map((n, i) => ({ n, i })).sort((a, b) => (at.get(a.n.key) ?? 1000 + a.i) - (at.get(b.n.key) ?? 1000 + b.i)).map((x) => x.n);
}
/** The first left-bar page a user sees (where "/" goes when the home page is turned off for the role) */
export const firstPage = (user: Pick<User, 'role' | 'pages' | 'pageOrder'> | null | undefined) =>
  orderedNav(user?.pageOrder).find((n) => !n.notInNav && n.key !== 'home' && canSee(user, n.key))?.to ?? '/settings';
