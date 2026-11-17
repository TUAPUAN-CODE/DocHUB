"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const qhMail_1 = require("./qhMail");
(0, node_test_1.default)('cleanEmails: trims, lower-cases, de-duplicates and drops what is not an address', () => {
    strict_1.default.deepEqual((0, qhMail_1.cleanEmails)([' A@x.com ', 'a@x.com', 'not-mail', 'b@y.co.th', '', 'c@d']), ['a@x.com', 'b@y.co.th']);
});
(0, node_test_1.default)('buildMail: only plan lines whose Doc No is in Quality Highlight, subject placeholders filled, text escaped', () => {
    const qh = { fileId: 'f1', byDoc: new Map([['ab-1', [{ subDoc: 'AB-1', material: 'Tuna <fresh>', shortCode: 'S1', note: 'ระวัง\nสี', updated: '2026-01-02', by: 'QC' }]]]) };
    const lines = [
        { time: '07:00', line: 'Cup 1', product: 'P1', country: 'USA', doc: 'ab-1 ' },
        { time: '08:00', line: 'Cup 2', product: 'P2', country: 'JP', doc: 'ZZ-9' },
    ];
    const m = (0, qhMail_1.buildMail)({ ...qhMail_1.DEFAULT_CONFIG, to: ['a@x.com'] }, '2026-11-12', 'plan.xlsx', lines, qh);
    strict_1.default.equal(m.matched, 1);
    strict_1.default.equal(m.subject, 'Quality Highlight · แผนผลิตวันที่ 12/11/2026 มี 1 รายการที่ต้องแจ้ง');
    strict_1.default.ok(m.html.includes('Tuna &lt;fresh&gt;'));
    strict_1.default.ok(m.html.includes('ระวัง<br>สี'));
    strict_1.default.ok(!m.html.includes('ZZ-9'));
    strict_1.default.ok(m.text.includes('Doc No ab-1'));
    strict_1.default.ok(m.text.includes('ระวัง / สี'));
    strict_1.default.ok(!m.text.includes('ZZ-9'));
});
//# sourceMappingURL=qhMail.test.js.map