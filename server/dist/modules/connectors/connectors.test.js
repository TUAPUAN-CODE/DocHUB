"use strict";
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
//# sourceMappingURL=connectors.test.js.map