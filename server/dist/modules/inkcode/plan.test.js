"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const XLSX = __importStar(require("xlsx"));
const plan_1 = require("./plan");
const sheet = (rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Sheet2'); return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); };
(0, node_test_1.default)('plan: one item per product block, line/shift/date resolved', () => {
    const t = (h, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const buf = sheet([
        [null, null, null, null, null, null, null, null, null, null, 'แผนผลิต Petfood ประจำวันที่', new Date(2026, 9, 3)],
        ['Time', 'Product', 'Line', 'Size', 'Customer', 'Country', 'Complementary', 'Code', 'Doc.No', 'Rev.', 'ยอดผลิต'],
        [null, 'Cup 1 (วาง cap 10500)'],
        [t(7), 'Cup', 1, 'ส้ม', 'Smucker', 'USA', 'NO', 'JAPPMM X', 'M252', 3, 'ครบยอดอย่างน้อย'],
        [t(7), 'Cup', 1, 'ส้ม', 'Smucker', 'USA', 'NO', 'JAPPMM X', 'M252', 3, 47334],
        [t(7), 'Cup', 1, 'ส้ม', 'Smucker', 'USA', 'NO', 'JAPPMM X', 'M252', 3, 'ถ้วย'],
        [t(7), 'Cup', 2, 'Soup', 'Mars', 'USA', 'NO', 'QAHPMA B', 'P342', 10, 'ครบยอด'],
        [t(7), 'Cup', 2, 'Soup', 'Mars', 'USA', 'NO', 'QAHPMA B', 'MRDPF184/26', 1, 139],
        [t(7), 'Cup', 2, 'Soup', 'Mars', 'USA', 'NO', 'QAHPMA B', 'P342', 10, 'ถ้วย'],
        [t(19, 30), 'Pouch', 'Spout 2', 'x', 'Almo', 'Italy', 'NO', 'C', 'J111', 1, 500],
        [null, null, null, null, null, null, null, null, '(หัวหน้าแผนกวางแผนการผลิตและควบคุมเอกสาร)'],
    ]);
    const r = (0, plan_1.parsePlan)(buf, ['Cup 1', 'Spout', 'Auto A']);
    strict_1.default.equal(r.date, '2026-10-03');
    strict_1.default.equal(r.items.length, 3);
    strict_1.default.deepEqual(r.items.map((i) => [i.line, i.doc, i.country, i.shift, i.qty, i.time]), [['Cup 1', 'M252', 'USA', 'DS', 47334, '07:00'], ['Cup 2', 'P342', 'USA', 'DS', 139, '07:00'], ['Spout', 'J111', 'Italy', 'NS', 500, '19:30']]);
});
(0, node_test_1.default)('plan: helpers', () => {
    strict_1.default.equal((0, plan_1.shiftOf)('06:00'), 'DS');
    strict_1.default.equal((0, plan_1.shiftOf)('18:59'), 'DS');
    strict_1.default.equal((0, plan_1.shiftOf)('19:00'), 'NS');
    strict_1.default.equal((0, plan_1.shiftOf)('02:00'), 'NS');
    strict_1.default.equal((0, plan_1.timeText)(0.5), '12:00');
    strict_1.default.equal((0, plan_1.timeText)('7.30'), '07:30');
    strict_1.default.deepEqual((0, plan_1.resolveLine)('Can', 'U', ['Can U']), { line: 'Can U', known: true });
    strict_1.default.deepEqual((0, plan_1.resolveLine)('Pouch', 'Auto A', ['Auto A']), { line: 'Auto A', known: true });
    strict_1.default.equal((0, plan_1.resolveLine)('Pouch', 'ไม่รู้จัก', ['Auto A']).known, false);
    strict_1.default.throws(() => (0, plan_1.parsePlan)(sheet([['a', 'b']])), /ไม่พบตารางแผนผลิต/);
});
(0, node_test_1.default)('Date cells built a few seconds early by SheetJS keep their day (server in a UTC+7 zone)', () => {
    strict_1.default.equal((0, plan_1.isoDate)(new Date(2026, 9, 2, 23, 59, 56)), '2026-10-03'); // local 23:59:56 of the 2nd = 00:00 of the 3rd
    strict_1.default.equal((0, plan_1.isoDate)(new Date(2026, 9, 3, 0, 0, 0)), '2026-10-03');
    strict_1.default.equal((0, plan_1.timeText)(new Date(1899, 11, 30, 6, 59, 56)), '07:00');
});
(0, node_test_1.default)('plan: everything else about a run is kept as written (raw-material rows, notes, block title, other documents)', () => {
    const buf = sheet([
        [null, 'มี OT', null, null, null, null, null, null, null, null, 'แผนผลิต Petfood ประจำวันที่', new Date(2026, 10, 12)],
        ['Time', 'Product', 'Line', 'Size', 'Customer', 'Country', 'Complementary', 'Code', 'Doc.No', 'Rev.', 'ยอดผลิต', 'Rawmat', 'Material', 'น.น/ชุดผสม (kg.)', 'Yield (Manager)', 'หมายเหตุ'],
        [null, 'Cup 2 (วาง cap 6480 ถ้วย/ชม.)'],
        ['07:00', 'Cup', 2, '103x27.5', 'Mars', 'EU', 'NO', 'QAGEMB X', 'P570', 11, 'ครบยอดอย่างน้อย', '- สันในไก่โม่', '2XP10BCK0002', 3.63, 65, 'DS 38x9 ชุด'],
        ['07:00', 'Cup', 2, '103x27.5', 'Mars', 'EU', 'NO', 'QAGEMB X', 'MRDPF184/26', 1, 189130, '- ชั้งยัด D011', '2XP10CCK0142', 2.1, '-', null],
        ['07:00', 'Cup', 2, '103x27.5', 'Mars', 'EU', 'NO', 'QAGEMB X', 'P570', 11, 'ถ้วย', null, null, '#DIV/0!', null, 'ชุดผสมละ 15 กก.'],
    ]);
    const r = (0, plan_1.parsePlan)(buf, ['Cup 2']);
    strict_1.default.equal(r.items.length, 1);
    const it = r.items[0];
    strict_1.default.equal(it.doc, 'P570');
    strict_1.default.equal(it.qty, 189130);
    strict_1.default.deepEqual(it.extra.otherDocs, [{ doc: 'MRDPF184/26', rev: '1' }]);
    strict_1.default.deepEqual(it.extra.qtyNotes, ['ครบยอดอย่างน้อย', 'ถ้วย']);
    strict_1.default.equal(it.extra.block, 'Cup 2 (วาง cap 6480 ถ้วย/ชม.)');
    strict_1.default.deepEqual(it.extra.rows, [4, 5, 6]);
    strict_1.default.deepEqual(r.detailHeaders, ['Rawmat', 'Material', 'น.น/ชุดผสม (kg.)', 'Yield (Manager)', 'หมายเหตุ']);
    strict_1.default.deepEqual(it.extra.details.map((d) => d.values['น.น/ชุดผสม (kg.)']), [3.63, 2.1, null]); // #DIV/0! is not data
    strict_1.default.deepEqual(it.extra.details.map((d) => d.values['Yield (Manager)']), [65, '-', null]); // text stays text
    strict_1.default.ok(r.headerNotes.includes('มี OT'));
    strict_1.default.equal(r.warnings.filter((w) => w.includes('Doc.No')).length, 0); // a raw-material document is not a warning
});
//# sourceMappingURL=plan.test.js.map