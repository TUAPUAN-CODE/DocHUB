"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const diff_1 = require("./diff");
const cols = [
    { id: 'c1', name: 'Sub Doc No.', type: 'varchar' },
    { id: 'c2', name: 'Short Code', type: 'varchar' },
    { id: 'c3', name: 'ให้Spread', type: 'text' },
    { id: 'c4', name: 'รูปภาพ', type: 'image' },
    { id: 'c5', name: 'วันที่ Update ข้อมูล', type: 'date', stamp: true },
    { id: 'c6', name: 'Updated by', type: 'varchar', stamp: true },
];
const snap = (rows, c = cols) => ({ cols: c, rows });
(0, node_test_1.test)('no change → empty diff (stamps alone are not a change)', () => {
    const a = snap([{ id: 'r1', no: 1, v: { c1: 'X001', c3: 'note', c5: '2026-01-01', c6: 'A' } }]);
    const b = snap([{ id: 'r1', no: 1, v: { c1: 'X001', c3: 'note', c5: '2026-11-10', c6: 'B' } }]);
    strict_1.default.ok((0, diff_1.diffIsEmpty)((0, diff_1.diffSnapshots)(a, b)));
});
(0, node_test_1.test)('added, removed and changed rows with old → new values, labelled by key columns', () => {
    const a = snap([
        { id: 'r1', no: 1, v: { c1: 'X001', c2: 'SC-01', c3: 'old note', c4: ['/uploads/a.png'] } },
        { id: 'r2', no: 2, v: { c1: 'X002', c3: 'gone' } },
    ]);
    const b = snap([
        { id: 'r1', no: 1, v: { c1: 'X001', c2: 'SC-01', c3: 'new note', c4: ['/uploads/a.png', '/uploads/b.png'], c5: '2026-11-10', c6: 'User A' } },
        { id: 'r3', no: 3, v: { c1: 'X003', c3: 'fresh' } },
    ]);
    const d = (0, diff_1.diffSnapshots)(a, b, ['c1', 'c2']);
    strict_1.default.deepEqual(d.added.map((r) => r.label), ['X003']);
    strict_1.default.deepEqual(d.removed.map((r) => r.label), ['X002']);
    strict_1.default.equal(d.changed.length, 1);
    strict_1.default.equal(d.changed[0].label, 'X001 · SC-01');
    strict_1.default.equal(d.changed[0].by, 'User A');
    strict_1.default.equal(d.changed[0].at, '2026-11-10');
    strict_1.default.deepEqual(d.changed[0].fields.map((f) => [f.name, f.old, f.new]), [
        ['ให้Spread', 'old note', 'new note'],
        ['รูปภาพ', ['/uploads/a.png'], ['/uploads/a.png', '/uploads/b.png']],
    ]);
});
(0, node_test_1.test)('empty string and missing cell are the same; column add / remove / rename reported', () => {
    const a = snap([{ id: 'r1', no: 1, v: { c1: 'X', c2: '' } }], cols.slice(0, 3));
    const b = snap([{ id: 'r1', no: 1, v: { c1: 'X' } }], [cols[0], { ...cols[1], name: 'Short code' }, cols[3]]);
    const d = (0, diff_1.diffSnapshots)(a, b);
    strict_1.default.equal(d.changed.length, 0);
    strict_1.default.deepEqual(d.columns, { added: ['รูปภาพ'], removed: ['ให้Spread'], renamed: [{ from: 'Short Code', to: 'Short code' }] });
    strict_1.default.ok(!(0, diff_1.diffIsEmpty)(d));
});
(0, node_test_1.test)('label falls back to the first column, then to the row number', () => {
    const a = snap([]);
    const b = snap([{ id: 'r1', no: 7, v: { c3: 'only a note' } }, { id: 'r2', no: 8, v: { c1: 'X004' } }]);
    strict_1.default.deepEqual((0, diff_1.diffSnapshots)(a, b).added.map((r) => r.label), ['แถว 7', 'X004']);
});
//# sourceMappingURL=diff.test.js.map