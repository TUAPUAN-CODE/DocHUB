import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMail, cleanEmails, DEFAULT_CONFIG } from './qhMail';

test('cleanEmails: trims, lower-cases, de-duplicates and drops what is not an address', () => {
  assert.deepEqual(cleanEmails([' A@x.com ', 'a@x.com', 'not-mail', 'b@y.co.th', '', 'c@d']), ['a@x.com', 'b@y.co.th']);
});

test('buildMail: only plan lines whose Doc No is in Quality Highlight, subject placeholders filled, text escaped', () => {
  const qh = { fileId: 'f1', byDoc: new Map([['ab-1', [{ subDoc: 'AB-1', material: 'Tuna <fresh>', shortCode: 'S1', note: 'ระวัง\nสี', updated: '2026-01-02', by: 'QC' }]]]) };
  const lines = [
    { time: '07:00', line: 'Cup 1', product: 'P1', country: 'USA', doc: 'ab-1 ' },
    { time: '08:00', line: 'Cup 2', product: 'P2', country: 'JP', doc: 'ZZ-9' },
  ];
  const m = buildMail({ ...DEFAULT_CONFIG, to: ['a@x.com'] }, '2026-11-12', 'plan.xlsx', lines, qh);
  assert.equal(m.matched, 1);
  assert.equal(m.subject, 'Quality Highlight · แผนผลิตวันที่ 12/11/2026 มี 1 รายการที่ต้องแจ้ง');
  assert.ok(m.html.includes('Tuna &lt;fresh&gt;'));
  assert.ok(m.html.includes('ระวัง<br>สี'));
  assert.ok(!m.html.includes('ZZ-9'));
  assert.ok(m.text.includes('Doc No ab-1'));
  assert.ok(m.text.includes('ระวัง / สี'));
  assert.ok(!m.text.includes('ZZ-9'));
});
