import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compileFormula, evaluate, FValue } from '../formula';
import { DB_FORMULAS, DB_KEY_MAP, DB_PLAIN, dbPreviewFormulas, REF_SHEETS, SAMPLE_ROW, SHEETS, WS_INPUTS, worksheetFormulas } from './model';

const dataDir = path.resolve(__dirname, '../../../../scripts/inkcode/data');
const have = fs.existsSync(path.join(dataDir, 'products.json'));
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));

// ---- in-memory DocHUB: every sheet = columns (id/name) + rows (id → value)
const ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
interface Sheet { id: string; cols: { id: string; name: string; dataType: string }[]; rows: Record<string, FValue>[] }
const sheets = new Map<string, Sheet>();
let seq = 1;
const mk = (name: string, defs: { name: string; type: string }[]): Sheet => {
  const s: Sheet = { id: ID(1000 + seq++), cols: defs.map((d) => ({ id: ID(seq++ * 7), name: d.name, dataType: d.type === 'float' ? 'float' : d.type })), rows: [] };
  sheets.set(name, s);
  return s;
};
const col = (s: Sheet, name: string) => s.cols.find((c) => c.name === name)!;
const date = (iso: string): FValue => ({ kind: 'date', ms: Date.parse(`${iso}T00:00:00Z`) }) as unknown as FValue;
const keyOf = (v: FValue) => (v === null ? '' : typeof v === 'object' ? String((v as { ms: number }).ms) : String(v)).trim().toLowerCase();

const lookup = (sheetId: string, result: string, keyCol: string, key: FValue): FValue => {
  const s = [...sheets.values()].find((x) => x.id === sheetId)!;
  if (key === null) return null;
  const k = keyOf(key);
  const hit = s.rows.find((r) => keyOf(r[keyCol]) === k);
  return hit ? hit[result] ?? null : null;
};

function addFormulaCols(s: Sheet, defs: ReturnType<typeof worksheetFormulas>) {
  for (const d of defs) s.cols.push({ id: ID(seq++ * 7), name: d.name, dataType: d.type });
}
function computeRow(s: Sheet, defs: ReturnType<typeof worksheetFormulas>, values: Record<string, FValue>) {
  for (const d of defs) {
    const others = s.cols.filter((c) => c.name !== d.name);
    const sources = d.formula!.sources.map((x) => ({ alias: x.alias, sheetId: sheets.get(x.sheet)!.id }));
    const sourceColumns = new Map(sources.map((x) => [x.sheetId, [...sheets.values()].find((y) => y.id === x.sheetId)!.cols]));
    const c = compileFormula(d.formula!.expr, others, { sources, sourceColumns });
    values[col(s, d.name).id] = evaluate(c.ast, { get: (id) => values[id] ?? null, tzOffsetMinutes: 420, lookup });
  }
}

test('InkCode formulas compile and render the same codes as the Excel rules', { skip: !have }, () => {
  const ref = load('ref.json'); const products = load('products.json'); const tokens = Object.keys(load('tokens.json').tokens);

  for (const def of REF_SHEETS) mk(def.name, def.columns);
  const fill = (name: string, rows: Record<string, unknown>[]) => { const s = sheets.get(name)!; for (const r of rows) s.rows.push(Object.fromEntries(Object.entries(r).map(([k, v]) => [col(s, k).id, k === 'วันที่ผลิต' && typeof v === 'string' ? date(v) : (v as FValue)]))); };
  fill(SHEETS.year, ref.years.map((y: any) => ({ ปี: y['ปี'], ปี_พศ: y['ปี_พศ'], รหัสปี: y['รหัสปี'], รหัสปี2: y['รหัสปี2'] })));
  fill(SHEETS.month, ref.months); fill(SHEETS.day, ref.days); fill(SHEETS.line, ref.lines); fill(SHEETS.shift, ref.shifts); fill(SHEETS.calendar, ref.calendar); fill(SHEETS.sample, [SAMPLE_ROW]);

  // database
  const dbFormulas = [...DB_FORMULAS, ...dbPreviewFormulas(tokens)];
  const db = mk(SHEETS.db, DB_PLAIN);
  addFormulaCols(db, dbFormulas as any);
  const sample = products.filter((p: any) => p['แบบโค้ดแถว 1'] && p['Short Product Code'] && p['Product Code (SAP)']).slice(0, 400);
  for (const p of sample) {
    const values: Record<string, FValue> = {};
    for (const [k, val] of Object.entries(p)) { const name = DB_KEY_MAP[k] ?? k; const c = db.cols.find((x) => x.name === name); if (c) values[c.id] = (val as FValue) ?? null; }
    computeRow(db, dbFormulas as any, values);
    db.rows.push(Object.fromEntries(Object.entries(values)));
  }
  // MID formula = Excel's =MID(R,2,1)&MID(R,12,5)&" "&MID(R,3,9)
  const sap = 'Product Code SAP';
  const r0 = db.rows[0]; const s0 = String(r0[col(db, sap).id]);
  const chars = [...s0];
  assert.equal(r0[col(db, 'Code ฝน').id], chars.slice(1, 2).join('') + chars.slice(11, 16).join('') + ' ' + chars.slice(2, 11).join(''));

  // the database previews the codes for the sample date (2026-03-17) and line (Can R) — same rule as the worksheet
  const stdIdx = sample.findIndex((p: any) => /^\{P\} ?S\{YC\}\{MC\}\{DC\}S\{LC\}$/.test(p['แบบโค้ดแถว 1']));
  assert.ok(stdIdx >= 0);
  const pv = db.rows[stdIdx];
  const short0 = String(sample[stdIdx]['Short Product Code']);
  assert.match(String(pv[col(db, 'ตัวอย่างโค้ดแถว 1').id]), new RegExp('^' + short0.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ?S\\w+S\\w+$'));
  assert.equal(pv[col(db, 'วันที่ตัวอย่าง').id] !== null, true);
  // worksheet
  const wsFormulas = worksheetFormulas(tokens);
  const ws = mk(SHEETS.ws, WS_INPUTS);
  addFormulaCols(ws, wsFormulas);
  const yc = (y: number) => String(ref.years.find((x: any) => x['ปี'] === String(y))['รหัสปี']);
  const mc = (m: number) => String(ref.months.find((x: any) => x['เดือน'] === String(m))['ตัวอักษร']);
  const dc = (d: number) => String(ref.days.find((x: any) => x['วัน'] === String(d))['รหัสวัน']);
  const lcOf = (l: string) => String(ref.lines.find((x: any) => x['ไลน์'] === l)['รหัสไลน์']);

  let checked = 0;
  for (const p of sample) {
    const tpl: string = p['แบบโค้ดแถว 1'];
    if (!/^\{P\} ?S\{YC\}\{MC\}\{DC\}S\{LC\}$/.test(tpl)) continue;
    const values: Record<string, FValue> = {
      [col(ws, 'วันที่ผลิต').id]: date('2026-03-17'), [col(ws, 'ไลน์').id]: 'Can R', [col(ws, 'กะ').id]: 'DS', [col(ws, 'รหัสเอกสาร').id]: p['รหัสเอกสาร'], [col(ws, 'Market').id]: p['Market'] ?? null,
    };
    computeRow(ws, wsFormulas, values);
    const expected = String(p['Short Product Code']) + (tpl.includes(' S') ? ' ' : '') + 'S' + yc(2026) + mc(3) + dc(17) + 'S' + lcOf('Can R');
    assert.equal(values[col(ws, 'Code Format แถว 1').id], expected, `${p['รหัสเอกสาร']} ${tpl}`);
    assert.equal(values[col(ws, 'พบในฐานข้อมูล').id], '1');
    if (++checked >= 5) break;
  }
  assert.ok(checked > 0, 'no sample with the standard template');

  // best-before template: "BBE:{DD} {MON} {Y+3}"
  const bb = sample.find((p: any) => [1, 2, 3, 4].some((n) => /BBE:\{DD\} \{MON\} \{Y\+3\}/.test(p[`แบบโค้ดแถว ${n}`] ?? '')));
  if (bb) {
    const n = [1, 2, 3, 4].find((i) => /BBE:\{DD\} \{MON\} \{Y\+3\}/.test(bb[`แบบโค้ดแถว ${i}`] ?? ''))!;
    const values: Record<string, FValue> = { [col(ws, 'วันที่ผลิต').id]: date('2026-03-07'), [col(ws, 'ไลน์').id]: 'Cup 1', [col(ws, 'รหัสเอกสาร').id]: bb['รหัสเอกสาร'], [col(ws, 'Market').id]: bb['Market'] ?? null };
    computeRow(ws, wsFormulas, values);
    assert.equal(values[col(ws, `Code Format แถว ${n}`).id], 'BBE:07 MAR 2029');
  }
  // not in database → X; no date → empty code
  const miss: Record<string, FValue> = { [col(ws, 'วันที่ผลิต').id]: null, [col(ws, 'รหัสเอกสาร').id]: 'NOPE', [col(ws, 'Market').id]: 'XX' };
  computeRow(ws, wsFormulas, miss);
  assert.equal(miss[col(ws, 'พบในฐานข้อมูล').id], 'X');
  assert.equal(miss[col(ws, 'Code Format แถว 1').id], '');
  for (const d of wsFormulas) assert.ok(d.formula!.expr.length <= 2000, `${d.name} expression too long (${d.formula!.expr.length})`);
});

test('worksheet drop-down columns are valid DocHUB column definitions', () => {
  const { columnInput, checkColumnInput } = require('../../shared/schemas');
  const fake = '00000000-0000-0000-0000-0000000000aa';
  for (const c of WS_INPUTS) {
    const body: Record<string, unknown> = { name: c.name, dataType: c.type, width: c.width ?? 160, isRequired: !!c.required, ...(c.description ? { description: c.description } : {}) };
    if (c.lookup) body.validation = { lookup: { sheetId: fake, columnId: fake } };
    const parsed = columnInput.parse(body);
    checkColumnInput(parsed);
  }
  assert.ok(WS_INPUTS.filter((c) => c.lookup).length >= 4);
});

test('auto routing: area of a line, plant in a line text, day path', async () => {
  const m = await import('./model');
  assert.equal(m.areaOf('Cup 1', 'Cup'), 'Cup');
  assert.equal(m.areaOf('Can R'), 'Can');
  assert.equal(m.areaOf('Auto B', 'Pouch'), 'Pouch');
  assert.equal(m.areaOf('Spout'), 'Pouch');
  assert.equal(m.areaOf('Pouch PF2 ชั้นบน'), 'Pouch');
  assert.equal(m.areaOf('Cancel x'), 'อื่นๆ');
  assert.equal(m.areaOf('ไลน์พิเศษ', 'Can'), 'Can');
  assert.equal(m.plantInText('Pouch PF2 ชั้นบน'), 'PF2');
  assert.equal(m.plantInText('Auto B'), null);
  assert.deepEqual(m.dayPath('2026-10-03'), { year: '2026', month: '10 ตุลาคม', file: '2026-10-03' });
  assert.throws(() => m.dayPath('3/10/2026'));
});

test('plan drop folder: only settled .xlsx in <year>/<month>, not lock files or handled folders', async () => {
  const fs = await import('fs'), os = await import('os'), path = await import('path');
  const { waitingFiles } = await import('./watcher');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
  const mk = (rel: string) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); fs.utimesSync(f, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000)); return f; };
  const a = mk('2026/10 ตุลาคม/แผน 03-10.xlsx'); mk('2026/10 ตุลาคม/~$แผน.xlsx'); mk('2026/10 ตุลาคม/เสร็จแล้ว/old.xlsx'); mk('2026/10 ตุลาคม/note.txt'); mk('top.xlsx');
  const fresh = path.join(dir, '2026/10 ตุลาคม/new.xlsx'); fs.writeFileSync(fresh, 'x');
  assert.deepEqual(waitingFiles(dir), [a]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plant values of the line table map to the PF folders', async () => {
  const { normalizePlant } = await import('./model');
  for (const [a, b] of [['2', 'PF2'], [2, 'PF2'], ['PF1', 'PF1'], ['pf 2', 'PF2'], [' pf1 ', 'PF1'], ['', ''], ['X', 'X']] as const) assert.equal(normalizePlant(a), b);
});

test('line spec: every line has one plant + area, no duplicates, the factory rules hold', async () => {
  const { LINE_SPEC, applyLineSpec } = await import('./model');
  const m = new Map(LINE_SPEC.map((s) => [s.line, s]));
  assert.equal(m.size, LINE_SPEC.length);
  const p = (l: string) => m.get(l)?.plant;
  for (const l of ['Cup 1', 'Cup 12', 'Cup 13', 'Can A', 'Can K', 'Auto B', 'Auto C', 'Auto D', 'Spout 1', 'Spout 3', 'Pouch VS', 'Sachet', 'Pouch TN', 'Can 1']) assert.equal(p(l), 'PF1', l);
  for (const l of ['Cup 6', 'Cup 7', 'Can R', 'Can Z', 'Auto A', 'Auto E', 'Auto F', 'Pouch PF3', 'Pouch PF2 ชั้นบน', 'Jerky', 'Extruder', 'Freeze dried']) assert.equal(p(l), 'PF2', l);
  assert.equal(m.get('Cup 3')!.area, 'Cup'); assert.equal(m.get('Can 2')!.area, 'Can'); assert.equal(m.get('Jerky')!.area, 'Pouch');
  const rows = applyLineSpec([{ ไลน์: 'Can B', Plant: null }, { ไลน์: 'ไลน์เก่า' }]);
  assert.equal(rows.find((r) => r['ไลน์'] === 'Can B')!['โรงงาน'], 'PF1');
  assert.equal(rows.find((r) => r['ไลน์'] === 'ไลน์เก่า')!['โรงงาน'], undefined);
  assert.ok(rows.some((r) => r['ไลน์'] === 'Can A' && r['พื้นที่'] === 'Can'));
});
