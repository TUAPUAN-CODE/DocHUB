"use strict";
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
//# sourceMappingURL=tools.test.js.map