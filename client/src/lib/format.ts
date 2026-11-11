import type { CellValue, Column } from '@/types';

const rtf = new Intl.RelativeTimeFormat('th', { numeric: 'auto' });
export function relTime(iso?: string | null) {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'เมื่อสักครู่';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}

const pad = (n: number) => String(n).padStart(2, '0');
export function fmtDate(v?: string | null) {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}
export function fmtDateTime(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(+d)) return v;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** ISO → value for <input type="datetime-local"> in local time */
export function toLocalInput(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (s: string) => (s ? new Date(s).toISOString() : null);

export function fmtNumber(n: number | null | undefined, decimals?: number | null) {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  const d = decimals ?? (Number.isInteger(n) ? 0 : undefined);
  return n.toLocaleString('en-US', d === undefined ? { maximumFractionDigits: 6 } : { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function compactNumber(n: number | null | undefined) {
  if (n === null || n === undefined) return '–';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export const optionLabel = (col: Pick<Column, 'options'>, v: string) => col.options?.find((o) => o.value === v)?.label ?? v;

/** Plain-text representation (copy, export, search) */
export function displayValue(col: Column, v: CellValue): string {
  if (v === null || v === undefined) return '';
  switch (col.dataType) {
    case 'int':
    case 'float':
      return fmtNumber(v as number, col.validation?.decimals);
    case 'date':
      return fmtDate(String(v));
    case 'datetime':
      return fmtDateTime(String(v));
    case 'boolean':
      return v ? 'TRUE' : 'FALSE';
    case 'select':
      return optionLabel(col, String(v));
    case 'multi_select':
      return (v as string[]).map((x) => optionLabel(col, x)).join(', ');
    case 'image':
      return Array.isArray(v) ? (v as string[]).map((u) => (u.startsWith('/') ? `${window.location.origin}${u}` : u)).join(' | ') : '';
    default:
      return String(v);
  }
}

export function initials(name?: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}
const PALETTE = ['#1552F0', '#16A34A', '#F59E0B', '#E5484D', '#8B5CF6', '#0EA5E9', '#EC4899', '#14B8A6', '#F97316', '#6366F1'];
export function colorFor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
export const SWATCHES = PALETTE;

export const PERM_LABEL: Record<string, string> = { none: 'ไม่มีสิทธิ์', read: 'ดูข้อมูล', write: 'แก้ไขข้อมูล', manage: 'จัดการ' };
export const ROLE_LABEL: Record<string, string> = { viewer: 'Viewer (ดูอย่างเดียว)', user: 'User (กรอกข้อมูล)', master: 'Master', admin: 'Admin', root: 'Root' };
export const levelToPerm = (l: number) => (['none', 'read', 'write', 'manage'] as const)[Math.max(0, Math.min(3, l))];

export const ACTION_LABEL: Record<string, string> = {
  login: 'เข้าสู่ระบบ', password_change: 'เปลี่ยนรหัสผ่าน', password_reset: 'รีเซ็ตรหัสผ่าน',
  user_create: 'สร้างผู้ใช้', user_update: 'แก้ไขผู้ใช้', user_bulk_update: 'แก้ไขผู้ใช้แบบกลุ่ม',
  folder_create: 'สร้างโฟลเดอร์', folder_update: 'แก้ไขโฟลเดอร์', folder_move: 'ย้ายโฟลเดอร์', folder_delete: 'ลบโฟลเดอร์',
  folder_restore: 'กู้คืนโฟลเดอร์', folder_purge: 'ลบโฟลเดอร์ถาวร',
  file_create: 'สร้างไฟล์', file_update: 'แก้ไขไฟล์', file_move: 'ย้ายไฟล์', file_duplicate: 'ทำสำเนาไฟล์', file_delete: 'ลบไฟล์',
  file_restore: 'กู้คืนไฟล์', file_purge: 'ลบไฟล์ถาวร',
  sheet_create: 'สร้างชีต', sheet_update: 'แก้ไขชีต', sheet_delete: 'ลบชีต', sheet_rollback: 'ย้อนข้อมูลทั้งชีต',
  column_create: 'เพิ่มคอลัมน์', column_update: 'แก้ไขคอลัมน์', column_delete: 'ลบคอลัมน์', column_restore: 'กู้คืนคอลัมน์',
  row_create: 'เพิ่มแถว', row_mix: 'ผสมวัตถุดิบ', rows_import: 'นำเข้าข้อมูลจากไฟล์', row_delete: 'ลบแถว', row_restore: 'กู้คืนแถว', row_rollback: 'ย้อนข้อมูลแถว',
  cell_update: 'แก้ไขเซลล์', cell_rollback: 'ย้อนค่าเซลล์',
  access_grant: 'ให้สิทธิ์', access_revoke: 'ถอนสิทธิ์', access_request: 'ขอสิทธิ์', access_approve: 'อนุมัติสิทธิ์', access_reject: 'ปฏิเสธคำขอ',
  dashboard_create: 'สร้างแดชบอร์ด', dashboard_update: 'แก้ไขแดชบอร์ด', dashboard_delete: 'ลบแดชบอร์ด',
};
export const actionVerb = (a?: string | null) => (a ? ACTION_LABEL[a] ?? a : '');
