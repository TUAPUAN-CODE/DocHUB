"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG_ROLES = exports.PAGES = void 0;
const ALL = ['viewer', 'user', 'master', 'admin'];
const BUILDERS = ['master', 'admin'];
exports.PAGES = [
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
    { key: 'inkcodePlan', label: 'นำเข้าแผนผลิต (InkCode)', kind: 'page', defaults: BUILDERS, floor: 'master' },
    { key: 'search', label: 'Search', kind: 'page', defaults: ALL },
    { key: 'dashboards', label: 'แดชบอร์ด', kind: 'page', defaults: ALL },
    { key: 'guide', label: 'คู่มือ', kind: 'page', defaults: ALL },
    { key: 'settings', label: 'ตั้งค่า', kind: 'page', defaults: ALL, always: true },
    { key: 'permissions', label: 'จัดการสิทธิ์', kind: 'page', defaults: [], rootOnly: true },
    { key: 'ai', label: 'ผู้ช่วย AI (ไอคอน AI บนแถบด้านบน)', kind: 'feature', defaults: ['admin'] },
];
/** Roles whose pages a root sets (root itself always sees everything) */
exports.CONFIG_ROLES = ['viewer', 'user', 'master', 'admin'];
//# sourceMappingURL=registry.js.map