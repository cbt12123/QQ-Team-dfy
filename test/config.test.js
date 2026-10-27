import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRelations } from '../src/config.js';

test('parseRelations parses QQ, name, city, job and note', () => {
  assert.deepEqual(parseRelations('2913487935:星河叔叔:上海:后端程序员:爸爸的发小'), {
    2913487935: {
      name: '星河叔叔',
      city: '上海',
      job: '后端程序员',
      note: '爸爸的发小',
    },
  });
  assert.deepEqual(parseRelations('2913487935：星河叔叔'), {
    2913487935: { name: '星河叔叔', city: '', job: '', note: '' },
  });
  assert.deepEqual(parseRelations(''), {});
});
