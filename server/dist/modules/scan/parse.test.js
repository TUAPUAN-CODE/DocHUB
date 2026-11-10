"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const parse_1 = require("./parse");
const A = { id: 'a', name: 'ถาด', delimiter: '|', fields: [{ index: 1, columnId: 'code' }, { index: 2, columnId: 'batch' }, { index: 3, columnId: 'map' }, { index: 4, columnId: 'qty' }, { index: 5, columnId: 'unit' }], action: 'create' };
const B = { id: 'b', name: 'สลีป', delimiter: ' | ', match: { prefix: '14M', fieldCount: 7 }, fields: [{ index: 4, columnId: 'map' }], action: 'update', keyColumnId: 'map' };
(0, node_test_1.default)('split by a custom delimiter and trim the pieces', () => {
    strict_1.default.deepEqual((0, parse_1.splitScan)('14L11DFF | BATCH123 | 12345 | 25 | KG.\r\n', '|'), ['14L11DFF', 'BATCH123', '12345', '25', 'KG.']);
    strict_1.default.deepEqual((0, parse_1.splitScan)('a;b;c', ';'), ['a', 'b', 'c']);
    strict_1.default.deepEqual((0, parse_1.splitScan)('a\tb', '\\t'), ['a', 'b']);
    strict_1.default.deepEqual((0, parse_1.splitScan)('abc', ''), ['abc']);
});
(0, node_test_1.default)('map pieces to columns; skip empty / missing pieces', () => {
    strict_1.default.deepEqual((0, parse_1.parseScan)('14L11DFF | BATCH123 | 12345 | 25 | KG.', A).values, { code: '14L11DFF', batch: 'BATCH123', map: '12345', qty: '25', unit: 'KG.' });
    strict_1.default.deepEqual((0, parse_1.parseScan)('X||7', { ...A, fields: [{ index: 1, columnId: 'code' }, { index: 2, columnId: 'batch' }, { index: 3, columnId: 'map' }] }).values, { code: 'X', map: '7' });
});
(0, node_test_1.default)('detect the profile: most criteria wins, a profile needing missing pieces does not fit', () => {
    const slip = '14M230000001 | LCMTP019AP | LCMTP019AP | 695089 | 245 | kg | PFCM';
    strict_1.default.equal((0, parse_1.detectProfile)(slip, [A, B])?.id, 'b');
    strict_1.default.equal((0, parse_1.detectProfile)('14L11DFF | BATCH123 | 12345 | 25 | KG.', [A, B])?.id, 'a');
    strict_1.default.equal((0, parse_1.detectProfile)('only one', [A, B]), null);
    strict_1.default.equal((0, parse_1.detectProfile)('x | y | z | 1 | 2', [{ ...A, match: { regex: '^Q' } }]), null);
});
(0, node_test_1.default)('stamps go to the first empty column in order', () => {
    strict_1.default.equal((0, parse_1.firstEmptyStamp)([false, false]), 0);
    strict_1.default.equal((0, parse_1.firstEmptyStamp)([true, false]), 1);
    strict_1.default.equal((0, parse_1.firstEmptyStamp)([true, true]), -1);
    strict_1.default.equal((0, parse_1.firstEmptyStamp)([false, true]), 0);
});
(0, node_test_1.default)('mergeFill copies from the other sheet but keeps what was scanned', () => {
    const fill = [{ fromColumnId: 'r_tro', toColumnId: 'tro' }, { fromColumnId: 'r_mat', toColumnId: 'mat' }];
    strict_1.default.deepEqual((0, parse_1.mergeFill)({ epc: 'E1' }, fill, { r_tro: '1234', r_mat: null }), { epc: 'E1', tro: '1234' });
    strict_1.default.deepEqual((0, parse_1.mergeFill)({ epc: 'E1', tro: '9' }, fill, { r_tro: '1234', r_mat: 'ไก่' }), { epc: 'E1', tro: '9', mat: 'ไก่' });
});
//# sourceMappingURL=parse.test.js.map