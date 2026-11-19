"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DELAY_CONNECTOR_NAME = exports.DELAY_NAMES = exports.DELAY_COLS = void 0;
const times = [
    ['เตรียมเสร็จ (A)', 'time_a'], ['เข้าห้องเย็น 1 (B)', 'time_b'], ['ออกห้องเย็น 1 (C)', 'time_c'],
    ['เข้าห้องเย็น 2 (D)', 'time_d'], ['ออกห้องเย็น 2 (E)', 'time_e'], ['บรรจุเสร็จ (F)', 'time_f'],
].map(([name, field]) => ({ name, field, dataType: 'datetime', width: 150 }));
const periods = [1, 2, 3, 4];
const PERIOD = ['เตรียมเสร็จ - เข้าห้องเย็น (B-A)', 'เข้าห้องเย็น - ออกห้องเย็น (C-B)', 'ออกห้องเย็น - บรรจุเสร็จ (F-C)', 'เตรียมเสร็จ - บรรจุเสร็จ'];
exports.DELAY_COLS = [
    { name: 'mapping_id', field: 'mapping_id', dataType: 'int', width: 100, description: 'รหัสแถวใน DelayHUB (คีย์ของการดึงข้อมูล)' },
    { name: 'วันที่', field: 'work_day', dataType: 'date', width: 110, description: 'วันทำงานตามเวลาบรรจุเสร็จ (กะดึกหลังเที่ยงคืนนับเป็นวันก่อน)' },
    { name: 'กะ', field: 'shift', dataType: 'select', width: 70, options: ['DS', 'NS'], description: 'DS 06:00–17:30 · NS 17:30–06:00 (ตามเวลาบรรจุเสร็จ)' },
    { name: 'ไลน์', field: 'line', dataType: 'varchar', width: 110 },
    { name: 'Code', field: 'code', dataType: 'varchar', width: 150, description: 'แผน (ไลน์)' },
    { name: 'โค้ด (Product Code)', field: 'production', dataType: 'varchar', width: 110 },
    { name: 'วัตถุดิบ (Raw Mat.)', field: 'mat_name', dataType: 'varchar', width: 220 },
    { name: 'Mat', field: 'mat', dataType: 'varchar', width: 110 },
    { name: 'Batch', field: 'batch', dataType: 'varchar', width: 130 },
    { name: 'น้ำหนัก (kgs.)', field: 'weight', dataType: 'float', width: 100 },
    { name: 'ชุดที่', field: 'group_no', dataType: 'varchar', width: 70 },
    { name: 'วันที่-เวลาเตรียม', field: 'prep_date', dataType: 'datetime', width: 150 },
    { name: 'Hist./Viscosity/Temp', field: 'hist', dataType: 'varchar', width: 130 },
    { name: 'สี', field: 'color', dataType: 'varchar', width: 70 },
    { name: 'กลิ่น', field: 'odor', dataType: 'varchar', width: 70 },
    { name: 'เนื้อสัมผัส', field: 'texture', dataType: 'varchar', width: 80 },
    ...times,
    ...periods.map((n) => ({ name: `ช่วงที่ ${n}`, field: `dbs${n}`, dataType: 'varchar', width: 100, description: PERIOD[n - 1] })),
    ...periods.map((n) => ({ name: `ช่วงที่ ${n} (ชม.)`, field: `dbs${n}_h`, dataType: 'float', width: 100 })),
    ...periods.map((n) => ({ name: `มาตรฐานช่วงที่ ${n} (ชม.)`, field: `std${n}_h`, dataType: 'float', width: 120 })),
    ...periods.map((n) => ({ name: `เกินมาตรฐานช่วงที่ ${n}`, field: `over${n}`, dataType: 'boolean', width: 120 })),
    { name: 'เกินมาตรฐาน', field: 'over_any', dataType: 'boolean', width: 110, description: 'เกินมาตรฐานอย่างน้อย 1 ช่วง' },
    { name: 'กลุ่มพิเศษ', field: 'special', dataType: 'boolean', width: 100, description: 'กลุ่มที่ไม่นับช่วงที่ 2 / 3 (ห้องเย็น 2 พิมพ์ "-")' },
    { name: 'หมายเหตุ (Remark)', field: 'remark', dataType: 'text', width: 260 },
];
exports.DELAY_NAMES = { folder: 'Delay HUB', file: 'รายงาน Delay F3PFPF67', sheet: 'Delay', dashboard: 'Delay F3PFPF67' };
exports.DELAY_CONNECTOR_NAME = 'DelayHUB → รายงาน Delay F3PFPF67';
//# sourceMappingURL=columns.js.map