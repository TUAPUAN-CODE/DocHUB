import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffFormats, formatChangeCount, FormatSnap } from './format';

const col = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, type: 'varchar', order: 0, required: false, options: [], validation: {}, defaultValue: null, placeholder: null, description: null, ...extra,
});
const base: FormatSnap = { cols: [col('a', 'ผล', { order: 0 }), col('b', 'เวลา', { order: 1 })], settings: { formLayout: { perRow: 2 } }, pdf: [{ id: 't', name: 'ใบตรวจ', json: '{"x":1}' }] };

test('no change → empty diff', () => {
  assert.equal(formatChangeCount(diffFormats(base, structuredClone(base))), 0);
});

test('options, rename, new column, settings and pdf layout are found', () => {
  const cur = structuredClone(base);
  cur.cols[0].options = [{ value: 'OK' }];
  cur.cols[1].name = 'เวลาตรวจ';
  cur.cols.push(col('c', 'หมายเหตุ', { order: 2 }));
  cur.settings.formLayout = { perRow: 3 };
  cur.pdf[0].json = '{"x":2}';
  const d = diffFormats(base, cur);
  assert.deepEqual(d.columns.added, ['หมายเหตุ']);
  assert.deepEqual(d.columns.renamed, [{ from: 'เวลา', to: 'เวลาตรวจ' }]);
  assert.deepEqual(d.columns.changed, [{ name: 'ผล', what: ['ตัวเลือก'] }]);
  assert.equal(d.settings.length, 1);
  assert.deepEqual(d.pdf.changed, ['ใบตรวจ']);
  assert.equal(formatChangeCount(d), 5);
});

test('key order inside settings does not count as a change', () => {
  const a: FormatSnap = { ...base, settings: { lines: { a: 1, b: 2 } } };
  const b: FormatSnap = { ...base, settings: { lines: { b: 2, a: 1 } } };
  assert.equal(formatChangeCount(diffFormats(a, b)), 0);
});
