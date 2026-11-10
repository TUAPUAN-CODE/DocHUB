import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffIsEmpty, diffSnapshots, Snapshot } from './diff';

const cols = [
  { id: 'c1', name: 'Sub Doc No.', type: 'varchar' },
  { id: 'c2', name: 'Short Code', type: 'varchar' },
  { id: 'c3', name: 'ให้Spread', type: 'text' },
  { id: 'c4', name: 'รูปภาพ', type: 'image' },
  { id: 'c5', name: 'วันที่ Update ข้อมูล', type: 'date', stamp: true },
  { id: 'c6', name: 'Updated by', type: 'varchar', stamp: true },
];
const snap = (rows: Snapshot['rows'], c = cols): Snapshot => ({ cols: c, rows });

test('no change → empty diff (stamps alone are not a change)', () => {
  const a = snap([{ id: 'r1', no: 1, v: { c1: 'X001', c3: 'note', c5: '2026-01-01', c6: 'A' } }]);
  const b = snap([{ id: 'r1', no: 1, v: { c1: 'X001', c3: 'note', c5: '2026-11-10', c6: 'B' } }]);
  assert.ok(diffIsEmpty(diffSnapshots(a, b)));
});

test('added, removed and changed rows with old → new values, labelled by key columns', () => {
  const a = snap([
    { id: 'r1', no: 1, v: { c1: 'X001', c2: 'SC-01', c3: 'old note', c4: ['/uploads/a.png'] } },
    { id: 'r2', no: 2, v: { c1: 'X002', c3: 'gone' } },
  ]);
  const b = snap([
    { id: 'r1', no: 1, v: { c1: 'X001', c2: 'SC-01', c3: 'new note', c4: ['/uploads/a.png', '/uploads/b.png'], c5: '2026-11-10', c6: 'User A' } },
    { id: 'r3', no: 3, v: { c1: 'X003', c3: 'fresh' } },
  ]);
  const d = diffSnapshots(a, b, ['c1', 'c2']);
  assert.deepEqual(d.added.map((r) => r.label), ['X003']);
  assert.deepEqual(d.removed.map((r) => r.label), ['X002']);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].label, 'X001 · SC-01');
  assert.equal(d.changed[0].by, 'User A');
  assert.equal(d.changed[0].at, '2026-11-10');
  assert.deepEqual(d.changed[0].fields.map((f) => [f.name, f.old, f.new]), [
    ['ให้Spread', 'old note', 'new note'],
    ['รูปภาพ', ['/uploads/a.png'], ['/uploads/a.png', '/uploads/b.png']],
  ]);
});

test('empty string and missing cell are the same; column add / remove / rename reported', () => {
  const a = snap([{ id: 'r1', no: 1, v: { c1: 'X', c2: '' } }], cols.slice(0, 3));
  const b = snap([{ id: 'r1', no: 1, v: { c1: 'X' } }], [cols[0], { ...cols[1], name: 'Short code' }, cols[3]]);
  const d = diffSnapshots(a, b);
  assert.equal(d.changed.length, 0);
  assert.deepEqual(d.columns, { added: ['รูปภาพ'], removed: ['ให้Spread'], renamed: [{ from: 'Short Code', to: 'Short code' }] });
  assert.ok(!diffIsEmpty(d));
});

test('label falls back to the first column, then to the row number', () => {
  const a = snap([]);
  const b = snap([{ id: 'r1', no: 7, v: { c3: 'only a note' } }, { id: 'r2', no: 8, v: { c1: 'X004' } }]);
  assert.deepEqual(diffSnapshots(a, b).added.map((r) => r.label), ['แถว 7', 'X004']);
});
