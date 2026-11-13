import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { isoDate, parsePlan, resolveLine, shiftOf, timeText } from './plan';

const sheet = (rows: unknown[][]) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Sheet2'); return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })); };

test('plan: one item per product block, line/shift/date resolved', () => {
  const t = (h: number, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const buf = sheet([
    [null, null, null, null, null, null, null, null, null, null, 'แผนผลิต Petfood ประจำวันที่', new Date(2026, 9, 3)],
    ['Time', 'Product', 'Line', 'Size', 'Customer', 'Country', 'Complementary', 'Code', 'Doc.No', 'Rev.', 'ยอดผลิต'],
    [null, 'Cup 1 (วาง cap 10500)'],
    [t(7), 'Cup', 1, 'ส้ม', 'Smucker', 'USA', 'NO', 'JAPPMM X', 'M252', 3, 'ครบยอดอย่างน้อย'],
    [t(7), 'Cup', 1, 'ส้ม', 'Smucker', 'USA', 'NO', 'JAPPMM X', 'M252', 3, 47334],
    [t(7), 'Cup', 1, 'ส้ม', 'Smucker', 'USA', 'NO', 'JAPPMM X', 'M252', 3, 'ถ้วย'],
    [t(7), 'Cup', 2, 'Soup', 'Mars', 'USA', 'NO', 'QAHPMA B', 'P342', 10, 'ครบยอด'],
    [t(7), 'Cup', 2, 'Soup', 'Mars', 'USA', 'NO', 'QAHPMA B', 'MRDPF184/26', 1, 139],
    [t(7), 'Cup', 2, 'Soup', 'Mars', 'USA', 'NO', 'QAHPMA B', 'P342', 10, 'ถ้วย'],
    [t(19, 30), 'Pouch', 'Spout 2', 'x', 'Almo', 'Italy', 'NO', 'C', 'J111', 1, 500],
    [null, null, null, null, null, null, null, null, '(หัวหน้าแผนกวางแผนการผลิตและควบคุมเอกสาร)'],
  ]);
  const r = parsePlan(buf, ['Cup 1', 'Spout', 'Auto A']);
  assert.equal(r.date, '2026-10-03');
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items.map((i) => [i.line, i.doc, i.country, i.shift, i.qty, i.time]), [['Cup 1', 'M252', 'USA', 'DS', 47334, '07:00'], ['Cup 2', 'P342', 'USA', 'DS', null, '07:00'], ['Spout', 'J111', 'Italy', 'NS', 500, '19:30']]);
});
test('plan: helpers', () => {
  assert.equal(shiftOf('06:00'), 'DS'); assert.equal(shiftOf('18:59'), 'DS'); assert.equal(shiftOf('19:00'), 'NS'); assert.equal(shiftOf('02:00'), 'NS');
  assert.equal(timeText(0.5), '12:00'); assert.equal(timeText('7.30'), '07:30');
  assert.deepEqual(resolveLine('Can', 'U', ['Can U']), { line: 'Can U', known: true });
  assert.deepEqual(resolveLine('Pouch', 'Auto A', ['Auto A']), { line: 'Auto A', known: true });
  assert.equal(resolveLine('Pouch', 'ไม่รู้จัก', ['Auto A']).known, false);
  assert.throws(() => parsePlan(sheet([['a', 'b']])), /ไม่พบตารางแผนผลิต/);
});

test('Date cells built a few seconds early by SheetJS keep their day (server in a UTC+7 zone)', () => {
  assert.equal(isoDate(new Date(2026, 9, 2, 23, 59, 56)), '2026-10-03');   // local 23:59:56 of the 2nd = 00:00 of the 3rd
  assert.equal(isoDate(new Date(2026, 9, 3, 0, 0, 0)), '2026-10-03');
  assert.equal(timeText(new Date(1899, 11, 30, 6, 59, 56)), '07:00');
});
