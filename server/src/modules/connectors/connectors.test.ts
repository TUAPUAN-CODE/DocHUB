import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecords } from './parse';
import { decryptJson, encryptJson } from './secret';
import { assertAllowedUrl } from './safeFetch';

test('parses nested JSON by path and flattens objects', () => {
    const body = Buffer.from(JSON.stringify({ data: { items: [{ a: 1, b: { c: 'x' } }] } }));
    assert.deepEqual(parseRecords(body, { format: 'json', jsonPath: 'data.items' }), [{ a: 1, 'b.c': 'x' }]);
  });
test('parses CSV with header row', () => {
    assert.deepEqual(parseRecords(Buffer.from('a,b\n1,2\n3,4\n'), { format: 'csv' }).map((r) => ({ ...r })), [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });
test('encrypts and decrypts, rejects tampering', () => {
    const s = encryptJson({ p: 'secret' });
    assert.ok(!s.includes('secret'));
    assert.deepEqual(decryptJson(s), { p: 'secret' });
    assert.equal(decryptJson(s.slice(0, -2) + 'AA'), null);
  });
test('blocks loopback, metadata and credentials in URL', async () => {
    await assert.rejects(assertAllowedUrl('http://127.0.0.1/x'));
    await assert.rejects(assertAllowedUrl('http://169.254.169.254/latest'));
    await assert.rejects(assertAllowedUrl('http://localhost:4000'));
    await assert.rejects(assertAllowedUrl('https://user:pw@example.com'));
    await assert.rejects(assertAllowedUrl('ftp://example.com'));
  });

test('daily connector: due once after its clock time (Thai time)', async () => {
  const { dailyDue } = await import('./runner');
  const th = (d: number, h: number, mi: number) => new Date(Date.UTC(2026, 10, d, h - 7, mi)); // Thai wall clock → instant
  const now = th(19, 5, 1);
  assert.equal(dailyDue('05:00', null, now, 420), true);
  assert.equal(dailyDue('05:00', th(18, 5, 0), now, 420), true);    // ran yesterday
  assert.equal(dailyDue('05:00', th(19, 5, 0), now, 420), false);   // already ran today
  assert.equal(dailyDue('05:00', null, th(19, 4, 59), 420), false); // not yet
  assert.equal(dailyDue('05:00', th(18, 23, 0), th(19, 0, 30), 420), false); // just after midnight: today's 05:00 has not come yet
  assert.equal(dailyDue('bad', null, now, 420), false);
});
