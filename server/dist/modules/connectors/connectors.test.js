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
const parse_1 = require("./parse");
const secret_1 = require("./secret");
const safeFetch_1 = require("./safeFetch");
(0, node_test_1.default)('parses nested JSON by path and flattens objects', () => {
    const body = Buffer.from(JSON.stringify({ data: { items: [{ a: 1, b: { c: 'x' } }] } }));
    strict_1.default.deepEqual((0, parse_1.parseRecords)(body, { format: 'json', jsonPath: 'data.items' }), [{ a: 1, 'b.c': 'x' }]);
});
(0, node_test_1.default)('parses CSV with header row', () => {
    strict_1.default.deepEqual((0, parse_1.parseRecords)(Buffer.from('a,b\n1,2\n3,4\n'), { format: 'csv' }).map((r) => ({ ...r })), [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});
(0, node_test_1.default)('encrypts and decrypts, rejects tampering', () => {
    const s = (0, secret_1.encryptJson)({ p: 'secret' });
    strict_1.default.ok(!s.includes('secret'));
    strict_1.default.deepEqual((0, secret_1.decryptJson)(s), { p: 'secret' });
    strict_1.default.equal((0, secret_1.decryptJson)(s.slice(0, -2) + 'AA'), null);
});
(0, node_test_1.default)('blocks loopback, metadata and credentials in URL', async () => {
    await strict_1.default.rejects((0, safeFetch_1.assertAllowedUrl)('http://127.0.0.1/x'));
    await strict_1.default.rejects((0, safeFetch_1.assertAllowedUrl)('http://169.254.169.254/latest'));
    await strict_1.default.rejects((0, safeFetch_1.assertAllowedUrl)('http://localhost:4000'));
    await strict_1.default.rejects((0, safeFetch_1.assertAllowedUrl)('https://user:pw@example.com'));
    await strict_1.default.rejects((0, safeFetch_1.assertAllowedUrl)('ftp://example.com'));
});
(0, node_test_1.default)('daily connector: due once after its clock time (Thai time)', async () => {
    const { dailyDue } = await Promise.resolve().then(() => __importStar(require('./runner')));
    const th = (d, h, mi) => new Date(Date.UTC(2026, 10, d, h - 7, mi)); // Thai wall clock → instant
    const now = th(19, 5, 1);
    strict_1.default.equal(dailyDue('05:00', null, now, 420), true);
    strict_1.default.equal(dailyDue('05:00', th(18, 5, 0), now, 420), true); // ran yesterday
    strict_1.default.equal(dailyDue('05:00', th(19, 5, 0), now, 420), false); // already ran today
    strict_1.default.equal(dailyDue('05:00', null, th(19, 4, 59), 420), false); // not yet
    strict_1.default.equal(dailyDue('05:00', th(18, 23, 0), th(19, 0, 30), 420), false); // just after midnight: today's 05:00 has not come yet
    strict_1.default.equal(dailyDue('bad', null, now, 420), false);
});
//# sourceMappingURL=connectors.test.js.map