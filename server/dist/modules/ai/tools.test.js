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
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const tools_1 = require("./tools");
(0, node_test_1.default)('nameScore: exact / contained / mis-heard names rank sensibly', () => {
    strict_1.default.equal((0, tools_1.nameScore)('Red Meat Bone', 'red meat bone'), 1);
    strict_1.default.ok((0, tools_1.nameScore)('InkCode', 'InkCode - ใบออกโค้ดนอกแผน') > 0.7);
    // speech-to-text heard "Let's" for "Red": still the best match, above the threshold used by find_items (0.3)
    const heard = (0, tools_1.nameScore)("Let's Meat Bone", 'Red Meat Bone');
    strict_1.default.ok(heard >= 0.5, `heard=${heard}`);
    strict_1.default.ok(heard > (0, tools_1.nameScore)("Let's Meat Bone", 'Right First Time'));
    strict_1.default.ok((0, tools_1.nameScore)('MD Record Problem', 'Quality Highlight Report') < 0.3);
});
(0, node_test_1.default)('resolveWhen: yesterday / month / explicit dates', async () => {
    const { resolveWhen } = await Promise.resolve().then(() => __importStar(require('./tools')));
    const now = new Date(2026, 10, 18, 10);
    strict_1.default.deepEqual(resolveWhen('yesterday', undefined, undefined, now), { from: '2026-11-17', to: '2026-11-17', label: 'เมื่อวาน (2026-11-17)' });
    strict_1.default.equal(resolveWhen('lastmonth', undefined, undefined, now)?.to, '2026-10-31');
    strict_1.default.equal(resolveWhen('last7days', undefined, undefined, now)?.from, '2026-11-12');
    strict_1.default.equal(resolveWhen(undefined, '2026-11-01', '2026-11-05', now)?.label, '2026-11-01 ถึง 2026-11-05');
    strict_1.default.equal(resolveWhen('nonsense'), null);
});
(0, node_test_1.default)('slicerPlan: date slicer + shift slicer, and what cannot be matched', async () => {
    const { slicerPlan, withPlan } = await Promise.resolve().then(() => __importStar(require('./tools')));
    const ds = (c) => ({ sheetId: 's1', xColumnId: c });
    const ws = [
        { id: 'd', type: 'slicer', title: 'วันที่', config: { mode: 'date' }, dataSource: ds('date') },
        { id: 'k', type: 'slicer', title: 'กะ', config: { mode: 'chips' }, dataSource: ds('shift') },
        { id: 'c', type: 'bar', title: 'x', config: {}, dataSource: ds('x') },
    ];
    const p = slicerPlan(ws, { from: '2026-11-17', to: '2026-11-17', slicers: [{ name: 'กะ', values: ['DS'] }, { name: 'โรงผลิต', values: ['A'] }] });
    strict_1.default.equal(p.filters.size, 2);
    strict_1.default.deepEqual(p.unmatched, ['โรงผลิต']);
    strict_1.default.equal(withPlan(ws, p.filters, 'c', ws[2].dataSource).filters.length, 2);
    strict_1.default.deepEqual(slicerPlan([ws[2]], { from: '2026-11-17' }).unmatched, ['วันที่']);
});
//# sourceMappingURL=tools.test.js.map