"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const db_1 = require("./db");
(0, node_test_1.default)('failover errors are recognised; ordinary SQL errors are not retried', () => {
    strict_1.default.equal((0, db_1.isTransient)({ code: 'ECONNCLOSED' }), true);
    strict_1.default.equal((0, db_1.isTransient)({ code: 'ELOGIN' }), true);
    strict_1.default.equal((0, db_1.isTransient)({ number: 983 }), true); // availability replica not accessible
    strict_1.default.equal((0, db_1.isTransient)({ originalError: { info: { number: 40613 } } }), true);
    strict_1.default.equal((0, db_1.isTransient)({ number: 2627 }), false); // duplicate key: a real error
    strict_1.default.equal((0, db_1.isTransient)({ code: 'EREQUEST', number: 547 }), false);
});
(0, node_test_1.default)('only reads are retried blindly', () => {
    strict_1.default.equal((0, db_1.isRead)('  SELECT 1'), true);
    strict_1.default.equal((0, db_1.isRead)('WITH t AS (SELECT 1) SELECT * FROM t'), true);
    strict_1.default.equal((0, db_1.isRead)('UPDATE x SET a = 1'), false);
});
//# sourceMappingURL=db.test.js.map