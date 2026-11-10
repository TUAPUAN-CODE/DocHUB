"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const rfidFrame_1 = require("./rfidFrame");
const frame = (epc) => Buffer.concat([Buffer.from('CCFFFF20', 'hex'), Buffer.from('000E', 'hex'), Buffer.from('000000', 'hex'), Buffer.from(epc, 'hex')]);
(0, node_test_1.default)('one frame, two frames in one chunk, and a frame cut in two', () => {
    const a = 'E2801160600002054D3C9A01', b = 'E28011606000020A3B2C1D02';
    const p = (0, rfidFrame_1.createFrameParser)();
    strict_1.default.deepEqual(p.push(frame(a)), [a]);
    strict_1.default.deepEqual(p.push(Buffer.concat([frame(a), frame(b)])), [a, b]);
    const f = frame(b);
    strict_1.default.deepEqual(p.push(f.subarray(0, 10)), []);
    strict_1.default.deepEqual(p.push(f.subarray(10)), [b]);
});
(0, node_test_1.default)('noise is filtered', () => {
    strict_1.default.equal((0, rfidFrame_1.isValidEpc)('E2801160600002054D3C9A01'), true);
    strict_1.default.equal((0, rfidFrame_1.isValidEpc)('000000000000000000000000'), false);
    strict_1.default.equal((0, rfidFrame_1.isValidEpc)('E280'), false);
});
(0, node_test_1.default)('reader commands: checksum makes the byte sum 0 (mod 256); hex is validated', () => {
    const c = (0, rfidFrame_1.withChecksum)(rfidFrame_1.DEFAULT_INIT_HEX);
    strict_1.default.equal(c.length, 8);
    strict_1.default.equal(c.reduce((a, b) => a + b, 0) & 0xff, 0);
    strict_1.default.equal((0, rfidFrame_1.isHex)('7CFFFF20'), true);
    strict_1.default.equal((0, rfidFrame_1.isHex)('7CF'), false);
    strict_1.default.equal((0, rfidFrame_1.isHex)('zz'), false);
});
//# sourceMappingURL=rfidFrame.test.js.map