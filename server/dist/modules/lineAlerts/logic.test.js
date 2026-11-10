"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const logic_1 = require("./logic");
const levels = [{ atPct: 100, color: '#f00', label: 'เกินเวลา' }, { atPct: 50, color: '#ff0', label: 'ใกล้เกิน' }];
(0, node_test_1.default)('ratioPct: elapsed over the limit; unknown without a positive limit', () => {
    strict_1.default.equal((0, logic_1.ratioPct)(0, null, 30 * 60000, 60), 50);
    strict_1.default.equal((0, logic_1.ratioPct)(0, null, 90 * 60000, 60), 150);
    strict_1.default.equal((0, logic_1.ratioPct)(0, null, 1000, 0), null);
});
(0, node_test_1.default)('levelToNotify: highest reached level of the sorted list; honours the chosen levels', () => {
    strict_1.default.equal((0, logic_1.levelToNotify)(levels, 40), -1);
    strict_1.default.equal((0, logic_1.levelToNotify)(levels, 60), 0); // sorted: 50 → index 0
    strict_1.default.equal((0, logic_1.levelToNotify)(levels, 120), 1); // 100 → index 1
    strict_1.default.equal((0, logic_1.levelToNotify)(levels, 120, [0]), 0); // only the 50 % level wanted
    strict_1.default.equal((0, logic_1.levelToNotify)(levels, 60, [1]), -1);
});
(0, node_test_1.default)('buildMessage: lists rows and the link', () => {
    const t = (0, logic_1.buildMessage)('ไฟล์ › ชีต: Delay', [{ rowNo: 3, pct: 130.4, levelLabel: 'เกินเวลา', elapsedMin: 78, limitMin: 60, startedAt: '01/10 08:00', labels: ['RM-01'] }], 'http://x/files/1');
    strict_1.default.match(t, /แถว 3 \| RM-01/);
    strict_1.default.match(t, /130%/);
    strict_1.default.match(t, /1 ชม\. 18 น\./);
    strict_1.default.match(t, /http:\/\/x\/files\/1/);
});
//# sourceMappingURL=logic.test.js.map