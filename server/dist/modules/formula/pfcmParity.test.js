"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const index_1 = require("./index");
// ---- old implementation (ported as is, dates are epoch ms)
const diffMin = (s, e) => { if (s === null || e === null)
    return null; const d = (e - s) / 60000; return d >= 0 ? d : null; };
const fmt = (m) => { if (m === null)
    return '-'; const h = Math.floor(m / 60); const mm = Math.floor(m % 60); return [h > 0 ? `${h} h` : '', mm > 0 ? `${mm} m` : ''].filter(Boolean).join(' ') || '-'; };
const old = (r) => {
    const dbs1 = diffMin(r.A, r.in1);
    let t2 = 0, has2 = false;
    const c1 = diffMin(r.in1, r.out1);
    if (c1 !== null) {
        t2 += c1;
        has2 = true;
    }
    if (r.in2 !== null && r.out2 !== null) {
        const c = diffMin(r.in2, r.out2);
        if (c !== null) {
            t2 += c;
            has2 = true;
        }
    }
    if (r.in3 !== null && r.out3 !== null) {
        const c = diffMin(r.in3, r.out3);
        if (c !== null) {
            t2 += c;
            has2 = true;
        }
    }
    if (r.wait > 0) {
        t2 += r.wait;
        has2 = true;
    }
    const dbs2 = has2 ? t2 : null;
    let cold23 = 0;
    if (r.in2 !== null && r.out2 !== null) {
        const c = diffMin(r.in2, r.out2);
        if (c !== null)
            cold23 += c;
    }
    if (r.in3 !== null && r.out3 !== null) {
        const c = diffMin(r.in3, r.out3);
        if (c !== null)
            cold23 += c;
    }
    const fc = diffMin(r.out1, r.F);
    const dbs3 = fc === null ? null : Math.max(0, fc - cold23);
    let dbs4;
    if (dbs1 === null && dbs3 === null)
        dbs4 = diffMin(r.A, r.F);
    else if (dbs1 !== null && dbs3 !== null)
        dbs4 = dbs1 + dbs3;
    else
        dbs4 = dbs1 ?? dbs3;
    return [fmt(dbs1), fmt(dbs2), fmt(dbs3), fmt(dbs4)];
};
// ---- the same thing as formulas (this is what goes into the new sheet's columns)
const names = ['A', 'in1', 'out1', 'in2', 'out2', 'in3', 'out3', 'F', 'wait', 'DBS1m', 'DBS2m', 'DBS3m', 'DBS4m'];
const cols = names.map((n, i) => ({ id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, name: n, dataType: 'float' }));
const idOf = (n) => cols.find((c) => c.name === n).id;
const FORMULAS = {
    DBS1m: 'MINUTES([A], [in1])',
    DBS2m: 'IF(COUNT(MINUTES([in1], [out1]), MINUTES([in2], [out2]), MINUTES([in3], [out3]), IF([wait] > 0, [wait], BLANK)) = 0, BLANK, SUM(MINUTES([in1], [out1]), MINUTES([in2], [out2]), MINUTES([in3], [out3]), IF([wait] > 0, [wait], 0)))',
    DBS3m: 'IF(ISBLANK(MINUTES([out1], [F])), BLANK, MAX(0, MINUTES([out1], [F]) - SUM(MINUTES([in2], [out2]), MINUTES([in3], [out3]))))',
    DBS4m: 'IF(AND(ISBLANK([DBS1m]), ISBLANK([DBS3m])), MINUTES([A], [F]), SUM([DBS1m], [DBS3m]))',
};
const compiled = Object.fromEntries(Object.entries(FORMULAS).map(([k, f]) => [k, (0, index_1.compileFormula)(f, cols, { selfId: idOf(k) })]));
const order = (0, index_1.topoOrder)(Object.entries(compiled).map(([k, c]) => ({ id: idOf(k), deps: c.deps })));
function formulas(r) {
    const dt = (v) => (v === null ? null : { kind: 'datetime', ms: v });
    const vals = new Map([[idOf('A'), dt(r.A)], [idOf('in1'), dt(r.in1)], [idOf('out1'), dt(r.out1)], [idOf('in2'), dt(r.in2)], [idOf('out2'), dt(r.out2)],
        [idOf('in3'), dt(r.in3)], [idOf('out3'), dt(r.out3)], [idOf('F'), dt(r.F)], [idOf('wait'), r.wait]]);
    const nameById = new Map(cols.map((c) => [c.id, c.name]));
    for (const id of order) {
        const c = compiled[nameById.get(id)];
        vals.set(id, (0, index_1.evaluate)(c.ast, { get: (x) => vals.get(x) ?? null, tzOffsetMinutes: 420 }));
    }
    const show = (n) => { const d = (0, index_1.compileFormula)(`COALESCE(DURATION([${n}]), "-")`, cols); return (0, index_1.evaluate)(d.ast, { get: (x) => vals.get(x) ?? null, tzOffsetMinutes: 420 }); };
    return [show('DBS1m'), show('DBS2m'), show('DBS3m'), show('DBS4m')];
}
// deterministic pseudo-random data
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const base = Date.UTC(2026, 9, 1, 0, 0, 0);
const maybe = (p, v) => (rnd() < p ? v : null);
(0, node_test_1.test)('DBS1-4 formulas equal the old report on 400 random rows (standard groups)', () => {
    for (let i = 0; i < 400; i++) {
        const t = base + Math.floor(rnd() * 3 * 86_400_000);
        const r = {
            A: maybe(0.9, t),
            in1: maybe(0.85, t + Math.floor((rnd() * 4 - 0.5) * 3_600_000)),
            out1: maybe(0.8, t + Math.floor(rnd() * 12 * 3_600_000)),
            in2: maybe(0.4, t + Math.floor(rnd() * 20 * 3_600_000)),
            out2: maybe(0.35, t + Math.floor(rnd() * 30 * 3_600_000)),
            in3: maybe(0.15, t + Math.floor(rnd() * 40 * 3_600_000)),
            out3: maybe(0.12, t + Math.floor(rnd() * 50 * 3_600_000)),
            F: maybe(0.75, t + Math.floor(rnd() * 60 * 3_600_000)),
            wait: rnd() < 0.2 ? Math.floor(rnd() * 300) : 0,
        };
        strict_1.default.deepEqual(formulas(r), old(r), `row ${i}: ${JSON.stringify(r)}`);
    }
});
(0, node_test_1.test)('DURATION and MINUTES basics', () => {
    const e = (src, v = {}) => (0, index_1.evaluate)((0, index_1.compileFormula)(src, cols).ast, { get: (id) => v[id] ?? null, tzOffsetMinutes: 0 });
    strict_1.default.equal(e('DURATION(150)'), '2 h 30 m');
    strict_1.default.equal(e('DURATION(45)'), '45 m');
    strict_1.default.equal(e('DURATION(120)'), '2 h');
    strict_1.default.equal(e('DURATION(0)'), '-');
    strict_1.default.equal(e('COUNT(1, BLANK, 3)'), 2);
    strict_1.default.equal(e('MINUTES(DATEVALUE("2026-10-02"), DATEVALUE("2026-10-01"))'), null);
});
//# sourceMappingURL=pfcmParity.test.js.map