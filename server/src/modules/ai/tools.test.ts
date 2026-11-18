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
