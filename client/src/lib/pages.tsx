import type { ReactNode } from 'react';
import { Activity, BookOpen, ClipboardCheck, Cpu, Database, FolderOpen, History, Home, LayoutDashboard, Megaphone, Search, Settings, ShieldCheck, Trash2, Users } from 'lucide-react';
import type { Role, User } from '@/types';

/**
 * The left bar. Which items a role sees is set by a root on "จัดการสิทธิ์" (server: modules/pageAccess/registry.ts, same keys)
 * and comes with the signed-in user (user.pages). Root sees everything.
 */
/** requests = file access + new accounts + tags waiting for me */
export type Badge = 'requests' | 'news';
export interface NavPage { key: string; to: string; label: string; icon: ReactNode; badge?: Badge; match?: (path: string) => boolean }

const i = 'h-[18px] w-[18px]';
export const NAV: NavPage[] = [
  { key: 'home', to: '/', label: 'หน้าแรก', icon: <Home className={i} />, match: (p) => p === '/' },
  { key: 'news', to: '/news', label: 'ข่าวสาร', icon: <Megaphone className={i} />, badge: 'news' },
  { key: 'browse', to: '/browse', label: 'ไฟล์ทั้งหมด', icon: <FolderOpen className={i} />, match: (p) => p.startsWith('/browse') || p.startsWith('/folders') || p.startsWith('/files') },
  { key: 'requests', to: '/requests', label: 'คำขออนุมัติ', icon: <ClipboardCheck className={i} />, badge: 'requests', match: (p) => p.startsWith('/requests') },
  { key: 'audit', to: '/audit', label: 'ประวัติการแก้ไข', icon: <History className={i} /> },
  { key: 'users', to: '/users', label: 'จัดการผู้ใช้', icon: <Users className={i} /> },
  { key: 'monitor', to: '/monitor', label: 'Monitor', icon: <Activity className={i} /> },
  { key: 'permissions', to: '/permissions', label: 'จัดการสิทธิ์', icon: <ShieldCheck className={i} /> },
  { key: 'trash', to: '/trash', label: 'ถังขยะ', icon: <Trash2 className={i} /> },
  { key: 'devices', to: '/devices', label: 'อุปกรณ์ (RFID/IoT)', icon: <Cpu className={i} /> },
  { key: 'connectors', to: '/connectors', label: 'ดึงข้อมูลจากลิงก์/API', icon: <Database className={i} /> },
  { key: 'search', to: '/traceback', label: 'Search', icon: <Search className={i} /> },
  { key: 'dashboards', to: '/dashboards', label: 'แดชบอร์ด', icon: <LayoutDashboard className={i} /> },
  { key: 'guide', to: '/guide', label: 'คู่มือ', icon: <BookOpen className={i} /> },
  { key: 'settings', to: '/settings', label: 'ตั้งค่า', icon: <Settings className={i} /> },
];

const ALL = ['home', 'news', 'browse', 'requests', 'trash', 'search', 'dashboards', 'guide', 'settings'];
/** used only until the server says (same defaults as the server registry) */
const DEFAULTS: Record<Role, string[]> = {
  viewer: ALL, user: ALL,
  master: [...ALL, 'audit', 'devices', 'connectors'],
  admin: [...ALL, 'audit', 'devices', 'connectors', 'users', 'monitor', 'ai'],
  root: [...NAV.map((n) => n.key), 'ai'],
};
const ALWAYS = ['home', 'settings'];

export function canSee(user: Pick<User, 'role' | 'pages'> | null | undefined, key: string) {
  if (!user) return false;
  if (user.role === 'root' || ALWAYS.includes(key)) return true;
  return (user.pages ?? DEFAULTS[user.role] ?? []).includes(key);
}
