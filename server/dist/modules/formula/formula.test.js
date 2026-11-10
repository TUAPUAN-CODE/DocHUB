"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const index_1 = require("./index");
const ID = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const cols = [
    { id: ID(1), name: 'น้ำหนัก', dataType: 'float' },
    { id: ID(2), name: 'จำนวนถาด', dataType: 'int' },
    { id: ID(3), name: 'เข้าห้องเย็น', dataType: 'datetime' },
    { id: ID(4), name: 'ออกห้องเย็น', dataType: 'datetime' },
    { id: ID(5), name: 'ชื่อ', dataType: 'varchar' },
];
const dt = (iso) => ({ kind: 'datetime', ms: Date.parse(iso) });
function run(src, values = {}, tz = 420) {
    const c = (0, index_1.compileFormula)(src, cols);
    return (0, index_1.evaluate)(c.ast, { get: (id) => (id in values ? values[id] : null), tzOffsetMinutes: tz });
}
const v = (n, x) => ({ [ID(n)]: x });
(0, node_test_1.test)('arithmetic, precedence and null propagation', () => {
    strict_1.default.equal(run('1 + 2 * 3'), 7);
    strict_1.default.equal(run('(1 + 2) * 3'), 9);
    strict_1.default.equal(run('10 / 4'), 2.5);
    strict_1.default.equal(run('10 / 0'), null);
    strict_1.default.equal(run('-[น้ำหนัก] + 1', v(1, 5)), -4);
    strict_1.default.equal(run('[น้ำหนัก] + 1', {}), null);
    strict_1.default.equal(run('[น้ำหนัก] / [จำนวนถาด]', { ...v(1, 30), ...v(2, 4) }), 7.5);
});
(0, node_test_1.test)('references by name become [#id] and display names follow renames', () => {
    const c = (0, index_1.compileFormula)('[น้ำหนัก] * 2', cols);
    strict_1.default.equal(c.canonical, `[#${ID(1)}] * 2`);
    strict_1.default.deepEqual(c.deps, [ID(1)]);
    const renamed = cols.map((x) => (x.id === ID(1) ? { ...x, name: 'Weight' } : x));
    strict_1.default.equal((0, index_1.displayFormula)(c.canonical, renamed), '[Weight] * 2');
    strict_1.default.equal((0, index_1.compileFormula)(c.canonical, renamed).deps[0], ID(1));
});
(0, node_test_1.test)('IF is lazy and AND/OR/NOT work', () => {
    strict_1.default.equal(run('IF([น้ำหนัก] > 100, "หนัก", "ปกติ")', v(1, 150)), 'หนัก');
    strict_1.default.equal(run('IF([น้ำหนัก] > 100, "หนัก", "ปกติ")', v(1, 50)), 'ปกติ');
    strict_1.default.equal(run('IF(1 = 1, 7, 1 / 0)'), 7);
    strict_1.default.equal(run('AND(1 < 2, 2 < 3)'), true);
    strict_1.default.equal(run('OR(1 > 2, NOT(FALSE))'), true);
    strict_1.default.equal(run('COALESCE([ชื่อ], "ไม่มี")'), 'ไม่มี');
});
(0, node_test_1.test)('text functions and concatenation', () => {
    strict_1.default.equal(run('[ชื่อ] & "-" & UPPER("ab")', v(5, 'x')), 'x-AB');
    strict_1.default.equal(run('LEFT("PFCM-01", 4)'), 'PFCM');
    strict_1.default.equal(run('RIGHT("PFCM-01", 2)'), '01');
    strict_1.default.equal(run('LEN("สวัสดี")'), 6);
    strict_1.default.equal(run('CONTAINS("Cold Room 1", "room")'), true);
    strict_1.default.equal(run('FORMATNUM(1234.5, 1)'), '1,234.5');
});
(0, node_test_1.test)('dates: DATEDIFF, DATEADD, HOUR (time zone aware) and shift', () => {
    const a = dt('2026-10-01T02:00:00Z'); // 09:00 in UTC+7
    const b = dt('2026-10-01T05:30:00Z');
    strict_1.default.equal(run('DATEDIFF("minute", [เข้าห้องเย็น], [ออกห้องเย็น])', { ...v(3, a), ...v(4, b) }), 210);
    strict_1.default.equal(run('ROUND(DATEDIFF("hour", [เข้าห้องเย็น], [ออกห้องเย็น]), 2)', { ...v(3, a), ...v(4, b) }), 3.5);
    strict_1.default.equal(run('HOUR([เข้าห้องเย็น])', v(3, a), 420), 9);
    strict_1.default.equal(run('HOUR([เข้าห้องเย็น])', v(3, a), 0), 2);
    const shift = 'IF(AND(HOUR([เข้าห้องเย็น]) >= 6, HOUR([เข้าห้องเย็น]) < 18), "DS", "NS")';
    strict_1.default.equal(run(shift, v(3, a)), 'DS');
    strict_1.default.equal(run(shift, v(3, dt('2026-10-01T16:00:00Z'))), 'NS'); // 23:00 local
    const added = run('DATEADD("hour", [เข้าห้องเย็น], 4)', v(3, a));
    strict_1.default.equal(added.ms, a.ms + 4 * 3_600_000);
    strict_1.default.equal(run('FORMATDATE([เข้าห้องเย็น], "dd/MM/BBBB HH:mm")', v(3, a)), '01/10/2569 09:00');
    strict_1.default.equal(run('DATEDIFF("hour", [เข้าห้องเย็น], [ออกห้องเย็น])', v(3, a)), null);
});
(0, node_test_1.test)('comparisons treat empty values sensibly', () => {
    strict_1.default.equal(run('[ชื่อ] = ""'), true);
    strict_1.default.equal(run('ISBLANK([ชื่อ])'), true);
    strict_1.default.equal(run('[น้ำหนัก] > 5', {}), false);
    strict_1.default.equal(run('"A" = "a"'), true);
});
(0, node_test_1.test)('errors are reported at save time', () => {
    const bad = (src, re) => strict_1.default.throws(() => (0, index_1.compileFormula)(src, cols), (e) => e instanceof index_1.FormulaSyntaxError && re.test(e.message));
    bad('', /กรุณาใส่สูตร/);
    bad('1 +', /ไม่สมบูรณ์/);
    bad('[ไม่มีคอลัมน์] + 1', /ไม่พบคอลัมน์/);
    bad('NOPE(1)', /ไม่มีฟังก์ชัน/);
    bad('ROUND()', /ต้องมี/);
    bad('IF(1)', /ต้องมี/);
    bad('abc + 1', /ไม่ใช่ฟังก์ชัน/);
    bad('"abc', /ไม่ครบ/);
    bad('1 + #', /ที่ใช้ไม่ได้/);
    strict_1.default.throws(() => (0, index_1.compileFormula)(`[#${ID(1)}] + 1`, cols, { selfId: ID(1) }), /ตัวเอง/);
});
(0, node_test_1.test)('topological order and cycles', () => {
    strict_1.default.deepEqual((0, index_1.topoOrder)([{ id: 'b', deps: ['a'] }, { id: 'a', deps: [] }, { id: 'c', deps: ['b', 'a'] }]), ['a', 'b', 'c']);
    strict_1.default.throws(() => (0, index_1.topoOrder)([{ id: 'a', deps: ['b'] }, { id: 'b', deps: ['a'] }]), /วงกลม/);
});
//# sourceMappingURL=formula.test.js.map