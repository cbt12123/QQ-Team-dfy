import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCrossVoice } from '../src/voice/cross-send.js';

const relations = {
  '2823115642': { name: '妈妈', city: '海口' },
  '2913487935': { name: '星河叔叔', city: '上海' },
};

test('parseCrossVoice detects a known recipient and content', () => {
  assert.deepEqual(parseCrossVoice('给妈妈发语音，说我想她了', relations), {
    targetUserId: '2823115642',
    targetName: '妈妈',
    content: '我想她了',
  });
  assert.deepEqual(parseCrossVoice('给星河叔叔发条语音，告诉她我周末过去', relations), {
    targetUserId: '2913487935',
    targetName: '星河叔叔',
    content: '我周末过去',
  });
  assert.deepEqual(parseCrossVoice('语音发给妈妈：我到了', relations), {
    targetUserId: '2823115642',
    targetName: '妈妈',
    content: '我到了',
  });
});

test('parseCrossVoice asks for content when missing and ignores non-commands', () => {
  assert.equal(parseCrossVoice('给妈妈发语音', relations).content, '');
  assert.equal(parseCrossVoice('妈妈最近怎么样', relations), null);
  assert.equal(parseCrossVoice('给奶奶发语音，说晚安', relations), null);
});
