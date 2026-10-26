import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationStore } from '../src/chat/memory.js';

test('ConversationStore expires old conversations', () => {
  let now = 1_000;
  const store = new ConversationStore({ maxTurns: 2, ttlMs: 100, now: () => now });
  store.append('group:user', '你好', '你好呀');
  assert.equal(store.get('group:user').length, 2);

  now = 1_101;
  assert.deepEqual(store.get('group:user'), []);
});

test('ConversationStore persists and reloads messages', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qqbot-memory-'));
  const filePath = join(directory, 'conversations.json');
  try {
    const first = new ConversationStore({ maxTurns: 3, filePath });
    first.append('napcat:g:u', '第一句', '第一句回复');
    first.flush();

    const second = new ConversationStore({ maxTurns: 3, filePath });
    assert.deepEqual(second.get('napcat:g:u'), [
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '第一句回复' },
    ]);
    first.close();
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
