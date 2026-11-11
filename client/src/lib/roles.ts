import type { Role } from '@/types';

export const ROLE_HINT: Record<Role, string> = {
  viewer: 'ดูข้อมูลได้อย่างเดียว กรอก/แก้ไขไม่ได้',
  user: 'กรอกข้อมูลในตารางของไฟล์ที่ได้รับสิทธิ์ แต่แก้ไขคอลัมน์/โครงสร้างไม่ได้',
  master: 'สร้างฟอร์มเอกสาร จัดการโฟลเดอร์ที่ตัวเองสร้างหรือได้รับสิทธิ์',
  admin: 'ทำได้ทุกอย่างในระบบ รวมถึงจัดการผู้ใช้',
  root: 'ทำได้ทุกอย่างเหมือน Admin และกำหนดว่าแต่ละบทบาทเห็นหน้าไหนในเมนู (หน้า จัดการสิทธิ์)',
};

export const ROLE_OPTIONS: { v: Role; label: string }[] = [
  { v: 'viewer', label: 'Viewer (ดูอย่างเดียว)' }, { v: 'user', label: 'User (กรอกข้อมูล)' }, { v: 'master', label: 'Master' }, { v: 'admin', label: 'Admin' },
];

/** + Root: only a root may give it (users page) */
export const ROLE_OPTIONS_ROOT: { v: Role; label: string }[] = [...ROLE_OPTIONS, { v: 'root', label: 'Root (ผู้ดูแลระบบสูงสุด)' }];
