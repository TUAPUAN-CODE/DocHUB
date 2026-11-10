"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* Seeds demo accounts and a sample workbook + dashboard. Safe to run twice.
 *   admin  / Admin@123   (or SEED_ADMIN_PASSWORD)
 *   master / Master@123
 *   user   / User@1234 */
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("../config/db");
const cellWriter_1 = require("../services/cellWriter");
const structure_1 = require("../services/structure");
const cellValue_1 = require("../shared/cellValue");
let seed = 20260930;
const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
async function ensureUser(username, email, name, password, roleId) {
    const ex = await (0, db_1.q1)(`SELECT user_id FROM Users WHERE username = @u`, { u: username });
    if (ex)
        return ex.user_id;
    const row = await (0, db_1.q1)(`INSERT INTO Users (username, email, password_hash, display_name) OUTPUT inserted.user_id VALUES (@u, @e, @h, @n)`, { u: username, e: email, h: await bcryptjs_1.default.hash(password, 12), n: name });
    await (0, db_1.q)(`INSERT INTO UserRoles (user_id, role_id) VALUES (@u, @r)`, { u: db_1.T.uuid(row.user_id), r: roleId });
    console.log(`  + user ${username}`);
    return row.user_id;
}
async function addSheet(tx, fileId, name, order, color, cols, by) {
    const s = await (0, db_1.q1)(`INSERT INTO Sheets (file_id, sheet_name, sort_order, tab_color, created_by) OUTPUT inserted.sheet_id VALUES (@f, @n, @o, @c, @u)`, { f: db_1.T.uuid(fileId), n: name, o: db_1.T.int(order), c: color, u: db_1.T.uuid(by) }, tx);
    const defs = [];
    for (const [i, c] of cols.entries())
        defs.push((0, cellValue_1.toColumnDef)(await (0, structure_1.insertColumn)(tx, s.sheet_id, c, i, by)));
    return { sheetId: s.sheet_id, defs };
}
async function addRows(tx, sheetId, defs, rows, users) {
    for (const [i, r] of rows.entries()) {
        const by = pick(users);
        const row = await (0, db_1.q1)(`INSERT INTO Rows (sheet_id, row_order, created_by, updated_by) OUTPUT inserted.row_id VALUES (@s, @o, @u, @u)`, { s: db_1.T.uuid(sheetId), o: db_1.T.int(i + 1), u: db_1.T.uuid(by) }, tx);
        for (const d of defs) {
            const v = r[d.column_name];
            if (v !== undefined && v !== null)
                await (0, cellWriter_1.writeCell)(tx, { sheetId, rowId: row.row_id, col: d, value: v, userId: by, source: 'create' });
        }
    }
}
async function main() {
    console.log('Seeding users…');
    const admin = await ensureUser('admin', 'admin@datasheet.local', 'ผู้ดูแลระบบ', process.env.SEED_ADMIN_PASSWORD || 'Admin@123', 3);
    const master = await ensureUser('master', 'master@datasheet.local', 'สมชาย ใจดี', 'Master@123', 2);
    const user = await ensureUser('user', 'user@datasheet.local', 'สมหญิง ขยันงาน', 'User@1234', 1);
    if (await (0, db_1.q1)(`SELECT 1 AS x FROM Folders WHERE folder_name = N'Production Reports'`)) {
        console.log('Demo data already present — done.');
        return;
    }
    console.log('Seeding folders, workbook and dashboard…');
    await (0, db_1.withTx)(async (tx) => {
        const folder = (name, parent, color, by) => (0, db_1.q1)(`INSERT INTO Folders (folder_name, parent_id, color, created_by) OUTPUT inserted.folder_id VALUES (@n, @p, @c, @u)`, { n: name, p: db_1.T.uuid(parent), c: color, u: db_1.T.uuid(by) }, tx).then((r) => r.folder_id);
        const prod = await folder('Production Reports', null, '#1552F0', master);
        const qc = await folder('QC Line', prod, '#16A34A', master);
        await folder('Weekly Summary', prod, '#F59E0B', master);
        await folder('Maintenance', null, '#8B5CF6', admin);
        const f = await (0, db_1.q1)(`INSERT INTO Files (file_name, folder_id, description, color, created_by) OUTPUT inserted.file_id VALUES (@n, @f, @d, @c, @u)`, { n: 'IR LINE PF1-09', f: db_1.T.uuid(qc), d: 'บันทึกยอดผลิตและของเสียประจำวัน ไลน์ PF1', c: '#16A34A', u: db_1.T.uuid(master) }, tx);
        const fileId = f.file_id;
        await (0, db_1.q)(`INSERT INTO FileAccess (file_id, user_id, permission, granted_by) VALUES (@f, @u, 'write', @m)`, { f: db_1.T.uuid(fileId), u: db_1.T.uuid(user), m: db_1.T.uuid(master) }, tx);
        const lines = [
            { value: 'PF1-09', label: 'PF1-09', color: '#1552F0' },
            { value: 'PF1-10', label: 'PF1-10', color: '#16A34A' },
            { value: 'PF2-01', label: 'PF2-01', color: '#F59E0B' },
        ];
        const daily = await addSheet(tx, fileId, 'Daily Output', 0, '#1552F0', [
            { name: 'วันที่', dataType: 'date', isRequired: true, width: 130 },
            { name: 'ไลน์', dataType: 'select', isRequired: true, width: 120, options: lines },
            { name: 'กะ', dataType: 'select', isRequired: true, width: 100, options: [
                    { value: 'Day', label: 'กะเช้า', color: '#0EA5E9' }, { value: 'Night', label: 'กะดึก', color: '#6366F1' }
                ] },
            { name: 'ผู้บันทึก', dataType: 'varchar', isRequired: true, width: 160, validation: { maxLength: 120 } },
            { name: 'ยอดผลิต', dataType: 'int', isRequired: true, width: 120, validation: { min: 0 } },
            { name: 'ของเสีย', dataType: 'int', isRequired: false, width: 110, validation: { min: 0 }, defaultValue: 0 },
            { name: 'Yield %', dataType: 'float', isRequired: false, width: 110, validation: { min: 0, max: 100, decimals: 2 } },
            { name: 'ตรวจสอบแล้ว', dataType: 'boolean', isRequired: false, width: 120 },
            { name: 'แท็ก', dataType: 'multi_select', isRequired: false, width: 200, options: [
                    { value: 'rework', label: 'Rework', color: '#EF4444' }, { value: 'overtime', label: 'OT', color: '#F59E0B' },
                    { value: 'trial', label: 'Trial run', color: '#8B5CF6' }
                ] },
            { name: 'หมายเหตุ', dataType: 'text', isRequired: false, width: 240 },
        ], master);
        const names = ['สมหญิง', 'วิชัย', 'อรุณี', 'ธนกร', 'ปิยะ'];
        const rows = [];
        for (let d = 44; d >= 0; d--) {
            const date = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
            const out = int(800, 1500);
            const bad = int(0, 45);
            rows.push({
                'วันที่': date, 'ไลน์': pick(lines).value, 'กะ': pick(['Day', 'Night']), 'ผู้บันทึก': pick(names),
                'ยอดผลิต': out, 'ของเสีย': bad, 'Yield %': Math.round(((out - bad) / out) * 10000) / 100,
                'ตรวจสอบแล้ว': rnd() > 0.3, 'แท็ก': rnd() > 0.7 ? [pick(['rework', 'overtime', 'trial'])] : null,
                'หมายเหตุ': rnd() > 0.8 ? 'เครื่องหยุด 15 นาที เปลี่ยนแม่พิมพ์' : null,
            });
        }
        await addRows(tx, daily.sheetId, daily.defs, rows, [master, user]);
        const defects = await addSheet(tx, fileId, 'Defects', 1, '#EF4444', [
            { name: 'วันที่', dataType: 'date', isRequired: true, width: 130 },
            { name: 'ประเภทของเสีย', dataType: 'select', isRequired: true, width: 170, options: [
                    { value: 'Scratch', label: 'รอยขีดข่วน', color: '#F97316' }, { value: 'Dent', label: 'บุบ', color: '#EF4444' },
                    { value: 'Short', label: 'ฉีดไม่เต็ม', color: '#A855F7' }, { value: 'Flash', label: 'ครีบเกิน', color: '#0EA5E9' }
                ] },
            { name: 'จำนวน', dataType: 'int', isRequired: true, width: 100, validation: { min: 1 } },
            { name: 'สถานี', dataType: 'varchar', isRequired: false, width: 130 },
            { name: 'อีเมลผู้รับผิดชอบ', dataType: 'email', isRequired: false, width: 220 },
        ], master);
        const drows = [];
        for (let i = 0; i < 28; i++) {
            drows.push({
                'วันที่': new Date(Date.now() - int(0, 30) * 86400_000).toISOString().slice(0, 10),
                'ประเภทของเสีย': pick(['Scratch', 'Dent', 'Short', 'Flash']), 'จำนวน': int(1, 20),
                'สถานี': `ST-${int(1, 6)}`, 'อีเมลผู้รับผิดชอบ': rnd() > 0.5 ? 'qc.team@datasheet.local' : null,
            });
        }
        await addRows(tx, defects.sheetId, defects.defs, drows, [master, user]);
        const col = (defs, name) => defs.find((d) => d.column_name === name).column_id;
        const s = daily.sheetId;
        const card = { bg: '#FFFFFF', radius: 16, shadow: 'sm', padding: 16, showTitle: true, border: '#E6EAF2', borderWidth: 1 };
        const widgets = [
            { type: 'text', title: '', x: 40, y: 28, w: 900, h: 70, z: 5, config: { text: 'IR LINE PF1-09 · ภาพรวมการผลิต 45 วัน', fontSize: 28, fontWeight: 600, align: 'left', color: '#1B2333' }, style: { bg: 'transparent', showTitle: false, padding: 0 } },
            { type: 'kpi', title: 'ยอดผลิตรวม', x: 40, y: 120, w: 360, h: 150, z: 2, config: { suffix: ' ชิ้น', decimals: 0, color: '#1552F0' }, style: card,
                dataSource: { sheetId: s, series: [{ columnId: col(daily.defs, 'ยอดผลิต'), aggregation: 'sum' }] } },
            { type: 'kpi', title: 'Yield เฉลี่ย', x: 420, y: 120, w: 360, h: 150, z: 2, config: { suffix: ' %', decimals: 2, color: '#16A34A', target: 97 }, style: card,
                dataSource: { sheetId: s, series: [{ columnId: col(daily.defs, 'Yield %'), aggregation: 'avg' }] } },
            { type: 'kpi', title: 'ของเสียรวม', x: 800, y: 120, w: 360, h: 150, z: 2, config: { suffix: ' ชิ้น', decimals: 0, color: '#EF4444' }, style: card,
                dataSource: { sheetId: s, series: [{ columnId: col(daily.defs, 'ของเสีย'), aggregation: 'sum' }] } },
            { type: 'bar', title: 'ยอดผลิตตามไลน์', x: 40, y: 290, w: 560, h: 400, z: 2, config: { colors: ['#1552F0', '#16A34A'], legend: true, grid: true, labels: true }, style: card,
                dataSource: { sheetId: s, xColumnId: col(daily.defs, 'ไลน์'), series: [{ columnId: col(daily.defs, 'ยอดผลิต'), aggregation: 'sum', label: 'ยอดผลิต' }, { columnId: col(daily.defs, 'ของเสีย'), aggregation: 'sum', label: 'ของเสีย' }] } },
            { type: 'area', title: 'แนวโน้มยอดผลิตรายวัน', x: 620, y: 290, w: 540, h: 400, z: 2, config: { colors: ['#1552F0'], legend: false, grid: true, curve: 'monotone' }, style: card,
                dataSource: { sheetId: s, xColumnId: col(daily.defs, 'วันที่'), xBucket: 'day', series: [{ columnId: col(daily.defs, 'ยอดผลิต'), aggregation: 'sum', label: 'ยอดผลิต' }] } },
            { type: 'doughnut', title: 'ของเสียตามประเภท', x: 1180, y: 120, w: 380, h: 570, z: 2, config: { colors: ['#F97316', '#EF4444', '#A855F7', '#0EA5E9'], legend: true, labels: true }, style: card,
                dataSource: { sheetId: defects.sheetId, xColumnId: col(defects.defs, 'ประเภทของเสีย'), series: [{ columnId: col(defects.defs, 'จำนวน'), aggregation: 'sum', label: 'จำนวน' }], sort: 'value_desc' } },
            { type: 'shape', title: '', x: 40, y: 715, w: 1520, h: 6, z: 1, config: { shape: 'rect', fill: '#1552F0', stroke: 'transparent', strokeWidth: 0 }, style: { bg: 'transparent', showTitle: false, padding: 0, radius: 3 } },
        ];
        const dash = await (0, db_1.q1)(`INSERT INTO Dashboards (file_id, dashboard_name, layout_config, background, created_by) OUTPUT inserted.dashboard_id VALUES (@f, @n, @l, @b, @u)`, { f: db_1.T.uuid(fileId), n: 'ภาพรวมการผลิต', l: JSON.stringify({ width: 1600, height: 760, gridSize: 10, snap: true }),
            b: JSON.stringify({ color: '#F4F6FB', imageUrl: null, fit: 'cover' }), u: db_1.T.uuid(master) }, tx);
        for (const w of widgets) {
            await (0, db_1.q)(`INSERT INTO DashboardWidgets (dashboard_id, widget_type, title, pos_x, pos_y, width, height, z_index, config, style_config, data_source)
         VALUES (@d, @t, @ti, @x, @y, @w, @h, @z, @c, @s, @ds)`, { d: db_1.T.uuid(dash.dashboard_id), t: w.type, ti: w.title, x: db_1.T.float(w.x), y: db_1.T.float(w.y), w: db_1.T.float(w.w), h: db_1.T.float(w.h), z: db_1.T.int(w.z),
                c: JSON.stringify(w.config), s: JSON.stringify(w.style), ds: db_1.T.text(w.dataSource ? JSON.stringify(w.dataSource) : null) }, tx);
        }
        await (0, db_1.q)(`INSERT INTO AuditLog (user_id, action_type, entity_type, entity_id, file_id, new_value) VALUES (@u, 'file_create', 'file', @f, @f, @v)`, { u: db_1.T.uuid(master), f: db_1.T.uuid(fileId), v: JSON.stringify({ name: 'IR LINE PF1-09', seeded: true }) }, tx);
    });
    console.log('Seed complete. Sign in with admin / master / user.');
}
main()
    .catch((e) => {
    console.error('Seed failed:', e?.message ?? e);
    process.exitCode = 1;
})
    .finally(() => (0, db_1.closePool)());
//# sourceMappingURL=seed.js.map