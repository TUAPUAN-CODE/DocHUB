import test from 'node:test';
import assert from 'node:assert/strict';
import { nameScore } from './tools';

test('nameScore: exact / contained / mis-heard names rank sensibly', () => {
  assert.equal(nameScore('Red Meat Bone', 'red meat bone'), 1);
  assert.ok(nameScore('InkCode', 'InkCode - ใบออกโค้ดนอกแผน') > 0.7);
  // speech-to-text heard "Let's" for "Red": still the best match, above the threshold used by find_items (0.3)
  const heard = nameScore("Let's Meat Bone", 'Red Meat Bone');
  assert.ok(heard >= 0.5, `heard=${heard}`);
  assert.ok(heard > nameScore("Let's Meat Bone", 'Right First Time'));
  assert.ok(nameScore('MD Record Problem', 'Quality Highlight Report') < 0.3);
});

test('resolveWhen: yesterday / month / explicit dates', async () => {
  const { resolveWhen } = await import('./tools');
  const now = new Date(2026, 10, 18, 10);
  assert.deepEqual(resolveWhen('yesterday', undefined, undefined, now), { from: '2026-11-17', to: '2026-11-17', label: 'เมื่อวาน (2026-11-17)' });
  assert.equal(resolveWhen('lastmonth', undefined, undefined, now)?.to, '2026-10-31');
  assert.equal(resolveWhen('last7days', undefined, undefined, now)?.from, '2026-11-12');
  assert.equal(resolveWhen(undefined, '2026-11-01', '2026-11-05', now)?.label, '2026-11-01 ถึง 2026-11-05');
  assert.equal(resolveWhen('nonsense'), null);
});

test('slicerPlan: date slicer + shift slicer, and what cannot be matched', async () => {
  const { slicerPlan, withPlan } = await import('./tools');
  const ds = (c: string) => ({ sheetId: 's1', xColumnId: c });
  const ws = [
    { id: 'd', type: 'slicer', title: 'วันที่', config: { mode: 'date' }, dataSource: ds('date') },
    { id: 'k', type: 'slicer', title: 'กะ', config: { mode: 'chips' }, dataSource: ds('shift') },
    { id: 'c', type: 'bar', title: 'x', config: {}, dataSource: ds('x') },
  ];
  const p = slicerPlan(ws, { from: '2026-11-17', to: '2026-11-17', slicers: [{ name: 'กะ', values: ['DS'] }, { name: 'โรงผลิต', values: ['A'] }] });
  assert.equal(p.filters.size, 2);
  assert.deepEqual(p.unmatched, ['โรงผลิต']);
  assert.equal(withPlan(ws, p.filters, 'c', ws[2].dataSource).filters.length, 2);
  assert.deepEqual(slicerPlan([ws[2]], { from: '2026-11-17' }).unmatched, ['วันที่']);
});

test('export_data / show_chart tools are declared with the parameters the model needs', async () => {
  const { TOOLS } = await import('./tools');
  const ex = TOOLS.find((t) => t.name === 'export_data') as any;
  const ch = TOOLS.find((t) => t.name === 'show_chart') as any;
  assert.deepEqual(ex.parameters.required, ['sheetId', 'format']);
  assert.ok(ex.parameters.properties.filters && ex.parameters.properties.columns);
  assert.deepEqual(ch.parameters.required, ['sheetId', 'series', 'chartType', 'title']);
  assert.ok(ch.parameters.properties.xColumnId && ch.parameters.properties.chartType.enum.includes('pareto'));
});
