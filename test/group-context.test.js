import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GroupContextStore } from '../src/chat/group-context.js';

test('GroupContextStore records, renders and excludes the current message', () => {
  const store = new GroupContextStore({ maxMessages: 5, ttlMs: 60_000, now: () => 10_000 });
  store.record({
    groupId: 'g1',
    userId: 'u1',
    userName: '小明',
    text: '今天加班到十点',
    messageId: 'm1',
    timestamp: 9_000,
  });
  store.record({
    groupId: 'g1',
    userId: 'u2',
    userName: '小红',
    text: '太惨了',
    messageId: 'm2',
    timestamp: 9_500,
  });

  const context = store.render('napcat', 'g1', { excludeMessageId: 'm2' });
  assert.match(context, /小明: 今天加班到十点/);
  assert.doesNotMatch(context, /小红: 太惨了/);
  assert.equal(store.count('napcat', 'g1'), 2);
});

test('GroupContextStore persists recent chatter across restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qqbot-context-'));
  const filePath = join(directory, 'group-context.json');
  try {
    const first = new GroupContextStore({ maxMessages: 10, filePath });
    first.record({
      groupId: 'g1',
      userId: 'u1',
      userName: '小明',
      text: '群里的梗',
      messageId: 'm1',
      timestamp: Date.now(),
    });
    first.flush();

    const second = new GroupContextStore({ maxMessages: 10, filePath });
    assert.match(second.render('napcat', 'g1'), /小明: 群里的梗/);
    first.close();
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
