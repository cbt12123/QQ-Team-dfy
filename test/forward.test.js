import test from 'node:test';
import assert from 'node:assert/strict';
import { collectForwardIds, collectReplyIds, formatForwardMessages } from '../src/forward.js';

test('collectForwardIds supports array and CQ-string forms', () => {
  assert.deepEqual(
    collectForwardIds([
      { type: 'text', data: { text: '看看这个' } },
      { type: 'forward', data: { id: 'fwd-1' } },
    ]),
    ['fwd-1'],
  );
  assert.deepEqual(collectForwardIds('[CQ:forward,id=fwd-2]'), ['fwd-2']);
});

test('collectReplyIds supports array and CQ-string reply segments', () => {
  assert.deepEqual(
    collectReplyIds([
      { type: 'reply', data: { id: 'reply-1' } },
      { type: 'text', data: { text: '看这个' } },
    ]),
    ['reply-1'],
  );
  assert.deepEqual(collectReplyIds('[CQ:reply,id=reply-2]'), ['reply-2']);
});

test('formatForwardMessages flattens senders and text', () => {
  const text = formatForwardMessages([
    {
      sender: { card: '小明' },
      message: [{ type: 'text', data: { text: '周末去露营' } }],
    },
    {
      sender: { nickname: '小红' },
      message: [{ type: 'text', data: { text: '我也想去' } }],
    },
  ]);
  assert.match(text, /共 2 条/);
  assert.match(text, /小明: 周末去露营/);
  assert.match(text, /小红: 我也想去/);
});
