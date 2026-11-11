"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const format_1 = require("./format");
const col = (id, name, extra = {}) => ({
    id, name, type: 'varchar', order: 0, required: false, options: [], validation: {}, defaultValue: null, placeholder: null, description: null, ...extra,
});
const base = { cols: [col('a', 'ผล', { order: 0 }), col('b', 'เวลา', { order: 1 })], settings: { formLayout: { perRow: 2 } }, pdf: [{ id: 't', name: 'ใบตรวจ', json: '{"x":1}' }] };
(0, node_test_1.test)('no change → empty diff', () => {
    strict_1.default.equal((0, format_1.formatChangeCount)((0, format_1.diffFormats)(base, structuredClone(base))), 0);
});
(0, node_test_1.test)('options, rename, new column, settings and pdf layout are found', () => {
    const cur = structuredClone(base);
    cur.cols[0].options = [{ value: 'OK' }];
    cur.cols[1].name = 'เวลาตรวจ';
    cur.cols.push(col('c', 'หมายเหตุ', { order: 2 }));
    cur.settings.formLayout = { perRow: 3 };
    cur.pdf[0].json = '{"x":2}';
    const d = (0, format_1.diffFormats)(base, cur);
    strict_1.default.deepEqual(d.columns.added, ['หมายเหตุ']);
    strict_1.default.deepEqual(d.columns.renamed, [{ from: 'เวลา', to: 'เวลาตรวจ' }]);
    strict_1.default.deepEqual(d.columns.changed, [{ name: 'ผล', what: ['ตัวเลือก'] }]);
    strict_1.default.equal(d.settings.length, 1);
    strict_1.default.deepEqual(d.pdf.changed, ['ใบตรวจ']);
    strict_1.default.equal((0, format_1.formatChangeCount)(d), 5);
});
(0, node_test_1.test)('key order inside settings does not count as a change', () => {
    const a = { ...base, settings: { lines: { a: 1, b: 2 } } };
    const b = { ...base, settings: { lines: { b: 2, a: 1 } } };
    strict_1.default.equal((0, format_1.formatChangeCount)((0, format_1.diffFormats)(a, b)), 0);
});
//# sourceMappingURL=format.test.js.map