import { Role } from '../../middleware/auth';

/**
 * Pages of the left bar (and features) whose visibility a root sets per role on the "จัดการสิทธิ์" page.
 * - defaults: roles that see it until a root changes it (also for pages added later)
 * - floor: the lowest role that can be given the page, because its server side still checks that role (e.g. user management)
 * - always: every role sees it (cannot be turned off) · rootOnly: only root, not configurable
 * Keys are shared with the web app (client/src/lib/pages.tsx).
 */
export interface PageDef {
  key: string;
  label: string;
  kind: 'page' | 'feature';
  defaults: Role[];
  floor?: Role;
  always?: boolean;
  rootOnly?: boolean;
  /** roles that always see it and cannot have it taken away (e.g. จัดการสิทธิ์ for admin: nobody locks themselves out) */
  lockedFor?: Role[];
  /** not an item of the left bar any more (opened from another page, e.g. an app of "Application"); access is still set here */
  notInNav?: boolean;
  hint?: string;
}

const ALL: Role[] = ['viewer', 'user', 'master', 'admin'];
const BUILDERS: Role[] = ['master', 'admin'];

export const PAGES: PageDef[] = [
  { key: 'home', label: 'หน้าแรก', kind: 'page', defaults: ALL, always: true },
  { key: 'news', label: 'ข่าวสาร', kind: 'page', defaults: ALL },
  { key: 'browse', label: 'ไฟล์ทั้งหมด', kind: 'page', defaults: ALL, hint: 'ปิดแล้วยังเปิดไฟล์จากลิงก์ที่แชร์ / รายการโปรดได้' },
  { key: 'requests', label: 'คำขออนุมัติ', kind: 'page', defaults: ALL, hint: 'อนุมัติเอกสาร · คำขอสิทธิ์ไฟล์ · คำขอสร้างบัญชี (Admin) · คำขอ Tag (ขอ Tag ได้ทุกคน · Master ขึ้นไปอนุมัติและจัดการ Tag)' },
  { key: 'audit', label: 'ประวัติการแก้ไข', kind: 'page', defaults: BUILDERS, hint: 'User / Viewer เห็นเฉพาะการแก้ไขของตัวเอง' },
  { key: 'users', label: 'จัดการผู้ใช้', kind: 'page', defaults: ['admin'], floor: 'admin' },
  { key: 'monitor', label: 'Monitor', kind: 'page', defaults: ['admin'] },
  { key: 'trash', label: 'ถังขยะ', kind: 'page', defaults: ALL },
  { key: 'devices', label: 'อุปกรณ์ (RFID/IoT)', kind: 'page', defaults: BUILDERS, floor: 'master' },
  { key: 'connectors', label: 'ดึงข้อมูลจากลิงก์/API', kind: 'page', defaults: BUILDERS, floor: 'master' },
  { key: 'apps', label: 'Application', kind: 'page', defaults: ALL, hint: 'ไอคอนแอป: แดชบอร์ดทุกอัน · แผนผลิต · แอปที่ Admin เพิ่ม' },
  { key: 'inkcodePlan', label: 'นำเข้าแผนผลิต (InkCode)', kind: 'page', defaults: BUILDERS, floor: 'master', notInNav: true, hint: 'เปิดจากแอป แผนผลิต ในหน้า Application' },
  { key: 'search', label: 'Search', kind: 'page', defaults: ALL },
  { key: 'dashboards', label: 'แดชบอร์ด', kind: 'page', defaults: ALL, notInNav: true, hint: 'แดชบอร์ดแต่ละอันเป็นแอปในหน้า Application' },
  { key: 'guide', label: 'คู่มือ', kind: 'page', defaults: ALL },
  { key: 'settings', label: 'ตั้งค่า', kind: 'page', defaults: ALL, always: true },
  { key: 'permissions', label: 'จัดการสิทธิ์', kind: 'page', defaults: ['admin'], floor: 'admin', lockedFor: ['admin'] },
  { key: 'ai', label: 'ผู้ช่วย AI (ไอคอน AI บนแถบด้านบน)', kind: 'feature', defaults: ['admin'] },
];

/** Roles whose pages a root sets (root itself always sees everything) */
export const CONFIG_ROLES: Role[] = ['viewer', 'user', 'master', 'admin'];
