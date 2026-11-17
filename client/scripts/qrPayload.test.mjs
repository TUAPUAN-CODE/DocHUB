// node --test scripts/qrPayload.test.mjs   (Node 22.18+ runs the .ts file as it is)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrKindOf, qrPayload } from '../src/lib/pdf/blocks/qrPayload.ts';

test('package type comes from PKG, then from the line name', () => {
  for (const [pkg, kind] of [['Can', 'can'], ['CAN', 'can'], [' can ', 'can'], ['Cup', 'cup'], ['CUP', 'cup'], ['cup', 'cup'], ['Sachet', 'sachet'], ['Pouch Sachet', 'sachet'],
    ['Pouch', 'pouch'], ['pouch', 'pouch'], ['Spout', 'pouch'], ['Jerky', 'pouch'], ['Jerky PET can', 'pouch'], ['Freeze Dried', 'pouch']]) assert.equal(qrKindOf(pkg, 'Cup 1'), kind, String(pkg));
  assert.equal(qrKindOf('', 'Cup 3'), 'cup');
  assert.equal(qrKindOf(null, 'Can R'), 'can');
  assert.equal(qrKindOf(undefined, 'Sachet'), 'sachet');
  assert.equal(qrKindOf('', 'Pouch VS'), 'pouch');
  assert.equal(qrKindOf('', ''), 'pouch');
});

const lines = ['PWVVPX822  S9LCS4', 'BBE:NOV.12.2028', '', ''];

test('Can: 23 characters per line, padded, joined, trailing spaces cut', () => {
  const p = qrPayload(lines, 'can');
  assert.equal(p, 'PWVVPX822  S9LCS4      ' + 'BBE:NOV.12.2028        '.slice(0, 23 - 0).replace(/\s+$/, ''));
  assert.equal(p.length, 23 + 15);
  assert.equal(qrPayload(['A'.repeat(30), 'B'], 'can'), 'A'.repeat(23) + 'B');
});

test('Pouch / other: 40 characters per line, padded, joined, trailing spaces cut', () => {
  const p = qrPayload(lines, 'pouch');
  assert.equal(p, 'PWVVPX822  S9LCS4'.padEnd(40) + 'BBE:NOV.12.2028');
  assert.equal(qrPayload(['A'.repeat(45), 'B'], 'pouch'), 'A'.repeat(40) + 'B');
});

test('Cup: real data only, no padding, no HH:MM / HHMM, lines joined directly, at most 40 per line', () => {
  assert.equal(qrPayload(['ABC   ', '  DEF  HH:MM', 'G HHMM H', ''], 'cup'), 'ABC' + '  DEF' + 'G  H');
  assert.equal(qrPayload(['A'.repeat(45), 'B'], 'cup'), 'A'.repeat(40) + 'B');
  assert.equal(qrPayload(['1430 HH:MM'], 'cup'), '1430');   // a real number stays
  assert.equal(qrPayload(['HH:MM', 'X', '', ''], 'cup'), 'X');
});

test('Pouch Sachet: like Cup, a new line (CR+LF) between the lines', () => {
  assert.equal(qrPayload(['ABC   ', '  DEF  HH:MM', 'G HHMM H', ''], 'sachet'), 'ABC\r\n  DEF\r\nG  H');
  assert.equal(qrPayload(['A', '', 'B', ''], 'sachet'), 'A\r\n\r\nB');   // an empty line in the middle keeps its place
  assert.equal(qrPayload(['', '', '', ''], 'sachet'), '');
});

test('the character limit can be overridden', () => {
  assert.equal(qrPayload(['A'.repeat(30)], 'pouch', { chars: 10 }), 'A'.repeat(10));
  assert.equal(qrPayload(['A'.repeat(30)], 'can', { chars: 25 }), 'A'.repeat(25));
});
