"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const timeLink_1 = require("./timeLink");
const t = (hm) => new Date(`2026-10-01T${hm}:00Z`);
const now = t('13:00');
(0, node_test_1.default)('material 12:00–12:30 vs packaging 11:50–12:30: linked, 30 min', () => {
    const a = (0, timeLink_1.interval)(t('12:00'), t('12:30'), now);
    const b = (0, timeLink_1.interval)(t('11:50'), t('12:30'), now);
    strict_1.default.deepEqual((0, timeLink_1.overlap)(a, b), { linked: true, minutes: 30 });
});
(0, node_test_1.default)('apart in time: not linked; tolerance can bridge a small gap', () => {
    const a = (0, timeLink_1.interval)(t('12:00'), t('12:30'), now);
    const b = (0, timeLink_1.interval)(t('12:40'), t('13:10'), now);
    strict_1.default.equal((0, timeLink_1.overlap)(a, b).linked, false);
    strict_1.default.equal((0, timeLink_1.overlap)(a, b, 10).linked, true);
    strict_1.default.equal((0, timeLink_1.overlap)(a, b, 10).minutes, 0);
});
(0, node_test_1.default)('a row without an end runs until now; no start = no interval', () => {
    const a = (0, timeLink_1.interval)(t('12:00'), null, now);
    strict_1.default.equal(a.e, now.getTime());
    strict_1.default.equal((0, timeLink_1.interval)(null, t('12:00'), now), null);
    strict_1.default.equal((0, timeLink_1.overlap)(a, (0, timeLink_1.interval)(t('12:45'), t('12:50'), now)).minutes, 5);
});
//# sourceMappingURL=timeLink.test.js.map