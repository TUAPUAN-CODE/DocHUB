import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileFormula, displayFormula, evaluate, FormulaSyntaxError, FValue, parseHM } from './index';

const ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SHEET = ID(900);
const cols = [{ id: ID(1), name: 'ประเภทวัตถุดิบ', dataType: 'varchar' }, { id: ID(2), name: 'เริ่ม', dataType: 'datetime' }, { id: ID(3), name: 'จบ', dataType: 'datetime' }];
const srcCols = [{ id: ID(11), name: 'ประเภทวัตถุดิบ', dataType: 'varchar' }, { id: ID(12), name: 'เตรียมเสร็จ-เข้าห้องเย็น', dataType: 'varchar' }, { id: ID(13), name: 'เข้าห้องเย็น-ออกห้องเย็น', dataType: 'float' }];
const opts = { sources: [{ alias: 'คุมDelay', sheetId: SHEET }], sourceColumns: new Map([[SHEET, srcCols]]) };

// the "control table" of the example: one row per material type
const table: Record<string, Record<string, FValue>> = {
  ไก่: { [ID(12)]: '5', [ID(13)]: 4 },
  ปลา: { [ID(12)]: '5:30', [ID(13)]: 2.3 },
  ผัก: { [ID(12)]: '4.23', [ID(13)]: 1.23 },
};
const lookup = (sheet: string, result: string, key: string, k: FValue): FValue => {
  if (sheet !== SHEET || key !== ID(11) || k === null) return null;
  const row = table[String(k).trim()];
  return row ? row[result] ?? null : null;
};
const run = (src: string, values: Record<string, FValue> = {}) =>
  evaluate(compileFormula(src, cols, opts).ast, { get: (id) => values[id] ?? null, tzOffsetMinutes: 420, lookup });

test('HM reads 5:30, 4.23 (= 4 h 23 m) and 5 (= 5 h)', () => {
  assert.equal(parseHM('5'), 300);
  assert.equal(parseHM('5:30'), 330);
  assert.equal(parseHM('4.23'), 263);
  assert.equal(parseHM('1.23'), 83);
  assert.equal(parseHM(5.3), 330); // typed 5.30 stored as 5.3 → 5 h 30 m
  assert.equal(parseHM('4.5'), 290);
  assert.equal(parseHM('4.75'), null); // 75 minutes is not a time
  assert.equal(parseHM('abc'), null);
  assert.equal(parseHM(null), null);
  assert.equal(parseHM(''), null);
});

test('LOOKUP finds the standard time of the material type in another sheet', () => {
  const f = 'HM(LOOKUP(@คุมDelay[เตรียมเสร็จ-เข้าห้องเย็น], @คุมDelay[ประเภทวัตถุดิบ], [ประเภทวัตถุดิบ]))';
  assert.equal(run(f, { [ID(1)]: 'ไก่' }), 300);
  assert.equal(run(f, { [ID(1)]: ' ปลา ' }), 330);
  assert.equal(run(f, { [ID(1)]: 'ผัก' }), 263);
  assert.equal(run(f, { [ID(1)]: 'หมู' }), null); // no such type → empty
  assert.equal(run(f, {}), null);
  assert.equal(run('LOOKUP(@คุมDelay[เข้าห้องเย็น-ออกห้องเย็น], @คุมDelay[ประเภทวัตถุดิบ], "ปลา")'), 2.3);
});

test('canonical form keeps ids (rename-proof) and display form shows names', () => {
  const c = compileFormula('HM(LOOKUP(@คุมDelay[เตรียมเสร็จ-เข้าห้องเย็น], @คุมDelay[ประเภทวัตถุดิบ], [ประเภทวัตถุดิบ]))', cols, opts);
  assert.equal(c.canonical, `HM(LOOKUP(@{${SHEET}}[#${ID(12)}], @{${SHEET}}[#${ID(11)}], [#${ID(1)}]))`);
  assert.deepEqual(c.sourceSheets, [SHEET]);
  assert.deepEqual(c.deps, [ID(1)]);
  assert.equal(displayFormula(c.canonical, cols, opts.sources, opts.sourceColumns), c.display);
  // the stored form compiles again, also after the alias or a column was renamed
  const renamedCols = srcCols.map((x) => (x.id === ID(12) ? { ...x, name: 'ขั้นตอน 1' } : x));
  const again = compileFormula(c.canonical, cols, { sources: [{ alias: 'ตารางคุม', sheetId: SHEET }], sourceColumns: new Map([[SHEET, renamedCols]]) });
  assert.equal(again.display, 'HM(LOOKUP(@ตารางคุม[ขั้นตอน 1], @ตารางคุม[ประเภทวัตถุดิบ], [ประเภทวัตถุดิบ]))');
});

test('mistakes in cross-sheet references are explained', () => {
  const bad = (src: string, re: RegExp) => assert.throws(() => compileFormula(src, cols, opts), (e: unknown) => e instanceof FormulaSyntaxError && re.test(e.message));
  bad('LOOKUP(@อื่น[x], @คุมDelay[ประเภทวัตถุดิบ], 1)', /ไม่พบแหล่งข้อมูล/);
  bad('LOOKUP(@คุมDelay[ไม่มี], @คุมDelay[ประเภทวัตถุดิบ], 1)', /ไม่พบคอลัมน์/);
  bad('@คุมDelay[ประเภทวัตถุดิบ]', /เฉพาะภายใน LOOKUP/);
  bad('LOOKUP([เริ่ม], @คุมDelay[ประเภทวัตถุดิบ], 1)', /ต้องใช้ @แหล่ง/);
  bad('LOOKUP(@คุมDelay, 1, 2)', /ต้องระบุคอลัมน์/);
});

test('MID, IFERROR and FILL (code templates)', () => {
  assert.equal(run('MID("2ICBS822SAENQN2300", 2, 1)'), 'I');
  assert.equal(run('MID("2ICBS822SAENQN2300", 3, 9)'), 'CBS822SAE');
  assert.equal(run('MID("abc", 5, 2)'), '');
  assert.equal(run('IFERROR(DATEVALUE("not a date"), "x")'), 'x');
  assert.equal(run('IFERROR(1 + 1, "x")'), 2);
  assert.equal(run('FILL("{P} S{YC}{MC}{DC}S{LC}", "P=B23AA|YC=5|MC=A|DC=3|LC=R")'), 'B23AA S5A3SR');
  assert.equal(run('FILL("BBE:{DD} {MON} {Y+3} {nope}", "DD=07|MON=MAR|Y+3=2029")'), 'BBE:07 MAR 2029 {nope}');
});
