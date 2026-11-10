"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const logic_1 = require("./logic");
(0, node_test_1.default)('cut: subtracts, keeps 6 decimals, refuses more than remaining', () => {
    strict_1.default.equal((0, logic_1.cut)(100, 30, 1, false), 70);
    strict_1.default.equal((0, logic_1.cut)(0.3, 0.1, 1, false), 0.2);
    strict_1.default.equal((0, logic_1.cut)(50, 50, 1, false), 0);
    strict_1.default.throws(() => (0, logic_1.cut)(10, 10.5, 4, false), /แถว 4: ใช้ 10.5 เกินคงเหลือ 10/);
    strict_1.default.throws(() => (0, logic_1.cut)(null, 1, 2, false), /ยังไม่มีค่าคงเหลือ/);
    strict_1.default.throws(() => (0, logic_1.cut)(10, 0, 2, false), /มากกว่า 0/);
    strict_1.default.throws(() => (0, logic_1.cut)(10, 1.5, 2, true), /จำนวนเต็ม/);
});
(0, node_test_1.default)('sumQty avoids float noise', () => { strict_1.default.equal((0, logic_1.sumQty)([0.1, 0.2]), 0.3); });
(0, node_test_1.default)('firstMismatch: case/space-insensitive', () => {
    strict_1.default.equal((0, logic_1.firstMismatch)([{ t: 'ไก่' }, { t: ' ไก่ ' }], ['t']), null);
    strict_1.default.equal((0, logic_1.firstMismatch)([{ t: 'ไก่' }, { t: 'ปลา' }], ['t']), 't');
});
//# sourceMappingURL=logic.test.js.map