import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelations } from '../src/config.js';

test('parseRelations parses QQ to relation names', () => {
  assert.deepEqual(parseRelations('2913487935:星河叔叔, 123456:妈妈'), {
    2913487935: '星河叔叔',
    123456: '妈妈',
  });
  assert.deepEqual(parseRelations('2913487935：星河叔叔'), {
    2913487935: '星河叔叔',
  });
  assert.deepEqual(parseRelations(''), {});
});
