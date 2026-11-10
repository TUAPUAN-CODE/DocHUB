"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const formula_1 = require("../formula");
const model_1 = require("./model");
const dataDir = node_path_1.default.resolve(__dirname, '../../../../scripts/inkcode/data');
const have = node_fs_1.default.existsSync(node_path_1.default.join(dataDir, 'products.json'));
const load = (f) => JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(dataDir, f), 'utf8'));
// ---- in-memory DocHUB: every sheet = columns (id/name) + rows (id → value)
const ID = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const sheets = new Map();
let seq = 1;
const mk = (name, defs) => {
    const s = { id: ID(1000 + seq++), cols: defs.map((d) => ({ id: ID(seq++ * 7), name: d.name, dataType: d.type === 'float' ? 'float' : d.type })), rows: [] };
    sheets.set(name, s);
    return s;
};
const col = (s, name) => s.cols.find((c) => c.name === name);
const date = (iso) => ({ kind: 'date', ms: Date.parse(`${iso}T00:00:00Z`) });
const keyOf = (v) => (v === null ? '' : typeof v === 'object' ? String(v.ms) : String(v)).trim().toLowerCase();
const lookup = (sheetId, result, keyCol, key) => {
    const s = [...sheets.values()].find((x) => x.id === sheetId);
    if (key === null)
        return null;
    const k = keyOf(key);
    const hit = s.rows.find((r) => keyOf(r[keyCol]) === k);
    return hit ? hit[result] ?? null : null;
};
function addFormulaCols(s, defs) {
    for (const d of defs)
        s.cols.push({ id: ID(seq++ * 7), name: d.name, dataType: d.type });
}
function computeRow(s, defs, values) {
    for (const d of defs) {
        const others = s.cols.filter((c) => c.name !== d.name);
        const sources = d.formula.sources.map((x) => ({ alias: x.alias, sheetId: sheets.get(x.sheet).id }));
        const sourceColumns = new Map(sources.map((x) => [x.sheetId, [...sheets.values()].find((y) => y.id === x.sheetId).cols]));
        const c = (0, formula_1.compileFormula)(d.formula.expr, others, { sources, sourceColumns });
        values[col(s, d.name).id] = (0, formula_1.evaluate)(c.ast, { get: (id) => values[id] ?? null, tzOffsetMinutes: 420, lookup });
    }
}
(0, node_test_1.default)('InkCode formulas compile and render the same codes as the Excel rules', { skip: !have }, () => {
    const ref = load('ref.json');
    const products = load('products.json');
    const tokens = Object.keys(load('tokens.json').tokens);
    for (const def of model_1.REF_SHEETS)
        mk(def.name, def.columns);
    const fill = (name, rows) => { const s = sheets.get(name); for (const r of rows)
        s.rows.push(Object.fromEntries(Object.entries(r).map(([k, v]) => [col(s, k).id, k === 'วันที่ผลิต' && typeof v === 'string' ? date(v) : v]))); };
    fill(model_1.SHEETS.year, ref.years.map((y) => ({ ปี: y['ปี'], ปี_พศ: y['ปี_พศ'], รหัสปี: y['รหัสปี'], รหัสปี2: y['รหัสปี2'] })));
    fill(model_1.SHEETS.month, ref.months);
    fill(model_1.SHEETS.day, ref.days);
    fill(model_1.SHEETS.line, ref.lines);
    fill(model_1.SHEETS.shift, ref.shifts);
    fill(model_1.SHEETS.calendar, ref.calendar);
    // database
    const dbDefs = [...model_1.DB_PLAIN, ...model_1.DB_FORMULAS];
    const db = mk(model_1.SHEETS.db, dbDefs);
    db.cols = db.cols.filter((c) => !model_1.DB_FORMULAS.some((f) => f.name === c.name));
    addFormulaCols(db, model_1.DB_FORMULAS);
    const sample = products.filter((p) => p['แบบโค้ดแถว 1'] && p['Short Product Code'] && p['Product Code (SAP)']).slice(0, 400);
    for (const p of sample) {
        const values = {};
        for (const [k, val] of Object.entries(p)) {
            const name = model_1.DB_KEY_MAP[k] ?? k;
            const c = db.cols.find((x) => x.name === name);
            if (c)
                values[c.id] = val ?? null;
        }
        computeRow(db, model_1.DB_FORMULAS, values);
        db.rows.push(Object.fromEntries(Object.entries(values)));
    }
    // MID formula = Excel's =MID(R,2,1)&MID(R,12,5)&" "&MID(R,3,9)
    const sap = 'Product Code SAP';
    const r0 = db.rows[0];
    const s0 = String(r0[col(db, sap).id]);
    const chars = [...s0];
    strict_1.default.equal(r0[col(db, 'Code ฝน').id], chars.slice(1, 2).join('') + chars.slice(11, 16).join('') + ' ' + chars.slice(2, 11).join(''));
    // worksheet
    const wsFormulas = (0, model_1.worksheetFormulas)(tokens);
    const ws = mk(model_1.SHEETS.ws, model_1.WS_INPUTS);
    addFormulaCols(ws, wsFormulas);
    const yc = (y) => String(ref.years.find((x) => x['ปี'] === String(y))['รหัสปี']);
    const mc = (m) => String(ref.months.find((x) => x['เดือน'] === String(m))['ตัวอักษร']);
    const dc = (d) => String(ref.days.find((x) => x['วัน'] === String(d))['รหัสวัน']);
    const lcOf = (l) => String(ref.lines.find((x) => x['ไลน์'] === l)['รหัสไลน์']);
    let checked = 0;
    for (const p of sample) {
        const tpl = p['แบบโค้ดแถว 1'];
        if (!/^\{P\} ?S\{YC\}\{MC\}\{DC\}S\{LC\}$/.test(tpl))
            continue;
        const values = {
            [col(ws, 'วันที่ผลิต').id]: date('2026-03-17'), [col(ws, 'ไลน์').id]: 'Can R', [col(ws, 'กะ').id]: 'DS', [col(ws, 'รหัสเอกสาร').id]: p['รหัสเอกสาร'], [col(ws, 'Market').id]: p['Market'] ?? null,
        };
        computeRow(ws, wsFormulas, values);
        const expected = String(p['Short Product Code']) + (tpl.includes(' S') ? ' ' : '') + 'S' + yc(2026) + mc(3) + dc(17) + 'S' + lcOf('Can R');
        strict_1.default.equal(values[col(ws, 'Code Format แถว 1').id], expected, `${p['รหัสเอกสาร']} ${tpl}`);
        strict_1.default.equal(values[col(ws, 'พบในฐานข้อมูล').id], '1');
        if (++checked >= 5)
            break;
    }
    strict_1.default.ok(checked > 0, 'no sample with the standard template');
    // best-before template: "BBE:{DD} {MON} {Y+3}"
    const bb = sample.find((p) => [1, 2, 3, 4].some((n) => /BBE:\{DD\} \{MON\} \{Y\+3\}/.test(p[`แบบโค้ดแถว ${n}`] ?? '')));
    if (bb) {
        const n = [1, 2, 3, 4].find((i) => /BBE:\{DD\} \{MON\} \{Y\+3\}/.test(bb[`แบบโค้ดแถว ${i}`] ?? ''));
        const values = { [col(ws, 'วันที่ผลิต').id]: date('2026-03-07'), [col(ws, 'ไลน์').id]: 'Cup 1', [col(ws, 'รหัสเอกสาร').id]: bb['รหัสเอกสาร'], [col(ws, 'Market').id]: bb['Market'] ?? null };
        computeRow(ws, wsFormulas, values);
        strict_1.default.equal(values[col(ws, `Code Format แถว ${n}`).id], 'BBE:07 MAR 2029');
    }
    // not in database → X; no date → empty code
    const miss = { [col(ws, 'วันที่ผลิต').id]: null, [col(ws, 'รหัสเอกสาร').id]: 'NOPE', [col(ws, 'Market').id]: 'XX' };
    computeRow(ws, wsFormulas, miss);
    strict_1.default.equal(miss[col(ws, 'พบในฐานข้อมูล').id], 'X');
    strict_1.default.equal(miss[col(ws, 'Code Format แถว 1').id], '');
    for (const d of wsFormulas)
        strict_1.default.ok(d.formula.expr.length <= 2000, `${d.name} expression too long (${d.formula.expr.length})`);
});
//# sourceMappingURL=inkcode.test.js.map