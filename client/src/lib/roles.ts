import type { Role } from '@/types';

export const ROLE_HINT: Record<Role, string> = {
  viewer: 'ดูข้อมูลได้อย่างเดียว กรอก/แก้ไขไม่ได้',
  user: 'กรอกข้อมูลในตารางของไฟล์ที่ได้รับสิทธิ์ แต่แก้ไขคอลัมน์/โครงสร้างไม่ได้',
  master: 'สร้างฟอร์มเอกสาร จัดการโฟลเดอร์ที่ตัวเองสร้างหรือได้รับสิทธิ์',
  admin: 'ทำได้ทุกอย่างในระบบ รวมถึงจัดการผู้ใช้',
};

export const ROLE_OPTIONS: { v: Role; label: string }[] = [
  { v: 'viewer', label: 'Viewer (ดูอย่างเดียว)' }, { v: 'user', label: 'User (กรอกข้อมูล)' }, { v: 'master', label: 'Master' }, { v: 'admin', label: 'Admin' },
];
