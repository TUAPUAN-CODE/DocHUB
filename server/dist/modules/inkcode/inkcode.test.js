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
    fill(model_1.SHEETS.sample, [model_1.SAMPLE_ROW]);
    // database
    const dbFormulas = [...model_1.DB_FORMULAS, ...(0, model_1.dbPreviewFormulas)(tokens)];
    const db = mk(model_1.SHEETS.db, model_1.DB_PLAIN);
    addFormulaCols(db, dbFormulas);
    const sample = products.filter((p) => p['แบบโค้ดแถว 1'] && p['Short Product Code'] && p['Product Code (SAP)']).slice(0, 400);
    for (const p of sample) {
        const values = {};
        for (const [k, val] of Object.entries(p)) {
            const name = model_1.DB_KEY_MAP[k] ?? k;
            const c = db.cols.find((x) => x.name === name);
            if (c)
                values[c.id] = val ?? null;
        }
        computeRow(db, dbFormulas, values);
        db.rows.push(Object.fromEntries(Object.entries(values)));
    }
    // MID formula = Excel's =MID(R,2,1)&MID(R,12,5)&" "&MID(R,3,9)
    const sap = 'Product Code SAP';
    const r0 = db.rows[0];
    const s0 = String(r0[col(db, sap).id]);
    const chars = [...s0];
    strict_1.default.equal(r0[col(db, 'Code ฝน').id], chars.slice(1, 2).join('') + chars.slice(11, 16).join('') + ' ' + chars.slice(2, 11).join(''));
    // the database previews the codes for the sample date (2026-03-17) and line (Can R) — same rule as the worksheet
    const stdIdx = sample.findIndex((p) => /^\{P\} ?S\{YC\}\{MC\}\{DC\}S\{LC\}$/.test(p['แบบโค้ดแถว 1']));
    strict_1.default.ok(stdIdx >= 0);
    const pv = db.rows[stdIdx];
    const short0 = String(sample[stdIdx]['Short Product Code']);
    strict_1.default.match(String(pv[col(db, 'ตัวอย่างโค้ดแถว 1').id]), new RegExp('^' + short0.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ?S\\w+S\\w+$'));
    strict_1.default.equal(pv[col(db, 'วันที่ตัวอย่าง').id] !== null, true);
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
(0, node_test_1.default)('worksheet drop-down columns are valid DocHUB column definitions', () => {
    const { columnInput, checkColumnInput } = require('../../shared/schemas');
    const fake = '00000000-0000-0000-0000-0000000000aa';
    for (const c of model_1.WS_INPUTS) {
        const body = { name: c.name, dataType: c.type, width: c.width ?? 160, isRequired: !!c.required, ...(c.description ? { description: c.description } : {}) };
        if (c.lookup)
            body.validation = { lookup: { sheetId: fake, columnId: fake } };
        const parsed = columnInput.parse(body);
        checkColumnInput(parsed);
    }
    strict_1.default.ok(model_1.WS_INPUTS.filter((c) => c.lookup).length >= 4);
});
(0, node_test_1.default)('auto routing: area of a line, plant in a line text, day path', async () => {
    const m = await Promise.resolve().then(() => __importStar(require('./model')));
    strict_1.default.equal(m.areaOf('Cup 1', 'Cup'), 'Cup');
    strict_1.default.equal(m.areaOf('Can R'), 'Can');
    strict_1.default.equal(m.areaOf('Auto B', 'Pouch'), 'Pouch');
    strict_1.default.equal(m.areaOf('Spout'), 'Pouch');
    strict_1.default.equal(m.areaOf('Pouch PF2 ชั้นบน'), 'Pouch');
    strict_1.default.equal(m.areaOf('Cancel x'), 'อื่นๆ');
    strict_1.default.equal(m.areaOf('ไลน์พิเศษ', 'Can'), 'Can');
    strict_1.default.equal(m.plantInText('Pouch PF2 ชั้นบน'), 'PF2');
    strict_1.default.equal(m.plantInText('Auto B'), null);
    strict_1.default.deepEqual(m.dayPath('2026-10-03'), { year: '2026', month: '10 ตุลาคม', file: '2026-10-03' });
    strict_1.default.throws(() => m.dayPath('3/10/2026'));
});
(0, node_test_1.default)('plan drop folder: only settled .xlsx in <year>/<month>, not lock files or handled folders', async () => {
    const fs = await Promise.resolve().then(() => __importStar(require('fs'))), os = await Promise.resolve().then(() => __importStar(require('os'))), path = await Promise.resolve().then(() => __importStar(require('path')));
    const { waitingFiles } = await Promise.resolve().then(() => __importStar(require('./watcher')));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
    const mk = (rel) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); fs.utimesSync(f, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000)); return f; };
    const a = mk('2026/10 ตุลาคม/แผน 03-10.xlsx');
    mk('2026/10 ตุลาคม/~$แผน.xlsx');
    mk('2026/10 ตุลาคม/เสร็จแล้ว/old.xlsx');
    mk('2026/10 ตุลาคม/note.txt');
    mk('top.xlsx');
    const fresh = path.join(dir, '2026/10 ตุลาคม/new.xlsx');
    fs.writeFileSync(fresh, 'x');
    strict_1.default.deepEqual(waitingFiles(dir), [a]);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.default)('plant values of the line table map to the PF folders', async () => {
    const { normalizePlant } = await Promise.resolve().then(() => __importStar(require('./model')));
    for (const [a, b] of [['2', 'PF2'], [2, 'PF2'], ['PF1', 'PF1'], ['pf 2', 'PF2'], [' pf1 ', 'PF1'], ['', ''], ['X', 'X']])
        strict_1.default.equal(normalizePlant(a), b);
});
(0, node_test_1.default)('line spec: every line has one plant + area, no duplicates, the factory rules hold', async () => {
    const { LINE_SPEC, lineSetupRows, DAY_SHEETS, sheetFor } = await Promise.resolve().then(() => __importStar(require('./model')));
    const m = new Map(LINE_SPEC.map((s) => [s.line, s]));
    strict_1.default.equal(m.size, LINE_SPEC.length);
    const p = (l) => m.get(l)?.plant;
    for (const l of ['Cup 1', 'Cup 12', 'Cup 13', 'Can A', 'Can K', 'Auto B', 'Auto C', 'Auto D', 'Spout 1', 'Spout 3', 'Pouch VS', 'Sachet', 'Pouch TN', 'Can 1'])
        strict_1.default.equal(p(l), 'PF1', l);
    for (const l of ['Cup 6', 'Cup 7', 'Can R', 'Can Z', 'Auto A', 'Auto E', 'Auto F', 'Pouch PF3', 'Pouch PF2 ชั้นบน', 'Jerky', 'Extruder', 'Freeze dried'])
        strict_1.default.equal(p(l), 'PF2', l);
    strict_1.default.equal(m.get('Cup 3').area, 'Cup');
    strict_1.default.equal(m.get('Can 2').area, 'Can');
    strict_1.default.equal(m.get('Jerky').area, 'Pouch');
    const rows = lineSetupRows();
    strict_1.default.equal(rows.length, LINE_SPEC.length);
    strict_1.default.deepEqual(rows.find((r) => r['ไลน์'] === 'Can A'), { ไลน์: 'Can A', โรงงาน: 'PF1', พื้นที่: 'Can' });
    strict_1.default.deepEqual(DAY_SHEETS, ['Pouch DS', 'Pouch NS', 'Can DS', 'Can NS', 'Cup DS', 'Cup NS', 'อื่นๆ']);
    strict_1.default.equal(sheetFor('Cup', 'NS'), 'Cup NS');
    strict_1.default.equal(sheetFor('อื่นๆ', 'DS'), 'อื่นๆ');
});
(0, node_test_1.default)('plan link: share links become direct downloads', async () => {
    const { downloadCandidates } = await Promise.resolve().then(() => __importStar(require('./planLink')));
    strict_1.default.deepEqual(downloadCandidates('https://drive.google.com/file/d/AbC_123-x/view?usp=sharing'), ['https://drive.google.com/uc?export=download&id=AbC_123-x']);
    strict_1.default.deepEqual(downloadCandidates('https://docs.google.com/spreadsheets/d/XyZ9/edit#gid=0'), ['https://docs.google.com/spreadsheets/d/XyZ9/export?format=xlsx']);
    strict_1.default.match(downloadCandidates('https://www.dropbox.com/s/abc/plan.xlsx?dl=0')[0], /dl=1/);
    const ms = downloadCandidates('https://contoso-my.sharepoint.com/:x:/g/personal/a_b/EXyz?e=abc');
    strict_1.default.equal(ms.length, 2);
    strict_1.default.match(ms[0], /download=1/);
    strict_1.default.equal(new URL(ms[1]).search, '?e=abc');
    strict_1.default.deepEqual(downloadCandidates('https://example.com/plan.xlsx'), ['https://example.com/plan.xlsx']);
    strict_1.default.throws(() => downloadCandidates('http://example.com/plan.xlsx'));
    strict_1.default.throws(() => downloadCandidates('not a url'));
});
(0, node_test_1.default)('note lines (New Code … / Thai) move to Remark (ไม่ Ink), code lines stay', async () => {
    const { isInkRemark, splitRemarks, REMARK_COL } = await Promise.resolve().then(() => __importStar(require('./model')));
    for (const s of ['New Code 1/9/25 ตรวจ 100%', 'New code 20/8/25 ตรวจ100%', '  NEW CODE 02/10/26', 'Check ราคาจาก Mail PN'])
        strict_1.default.equal(isInkRemark(s), true, s);
    for (const s of ['{P} S{YC}{MC}{DC}S{LC} VCN.7', 'Best By {DD} {MON} {Y+3}', 'Not for EU VCN.7', 'i-Tail 愛泰肉泥-護眼抗氧化', 'NEWCODE', 'Renew Code 1', '', null])
        strict_1.default.equal(isInkRemark(s), false, String(s));
    const r = splitRemarks({ 'แบบโค้ดแถว 1': '{P} S{YC}', 'แบบโค้ดแถว 4': 'New Code 1/9/25 ตรวจ 100%', [REMARK_COL]: 'เดิม' });
    strict_1.default.deepEqual(r.moved, ['New Code 1/9/25 ตรวจ 100%']);
    strict_1.default.equal(r.next['แบบโค้ดแถว 1'], '{P} S{YC}');
    strict_1.default.equal(r.next['แบบโค้ดแถว 4'], null);
    strict_1.default.equal(r.next[REMARK_COL], 'เดิม\nNew Code 1/9/25 ตรวจ 100%');
    strict_1.default.equal(splitRemarks(r.next).moved.length, 0); // running again changes nothing
});
//# sourceMappingURL=inkcode.test.js.map