import test from 'node:test';
import assert from 'node:assert/strict';
import { ProactivePolicy, parseQuietHours } from '../src/chat/proactive.js';
import { silentLogger } from '../src/logger.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function config(overrides = {}) {
  return {
    enabled: true,
    groups: ['g1'],
    cooldownMs: 1_000,
    maxPerHour: 2,
    chance: 1,
    debounceMs: 0,
    minChars: 2,
    maxChars: 100,
    quietHours: '1-7',
    botName: '阿岚',
    ...overrides,
  };
}

test('parseQuietHours supports ranges and wrapping ranges', () => {
  assert.deepEqual([...parseQuietHours('1-3')], [1, 2, 3]);
  assert.deepEqual([...parseQuietHours('23-2')].sort((a, b) => a - b), [0, 1, 2, 23]);
  assert.deepEqual([...parseQuietHours('bad')], []);
});

test('ProactivePolicy sends a plain message after debounce', async () => {
  const sent = [];
  const engine = {
    llm: { enabled: true },
    async proactiveReply() {
      return '确实，今天有点累';
    },
  };
  const policy = new ProactivePolicy({
    config: config(),
    engine,
    logger: silentLogger,
    now: () => 100_000,
    hour: () => 12,
    random: () => 0.5,
    getContext: () => '[最近群聊]\n小明: 今天好累',
    send: async (message) => sent.push(message),
  });

  assert.equal(
    policy.consider({ groupId: 'g1', text: '今天好累', mentioned: false }),
    true,
  );
  await wait(20);
  assert.deepEqual(sent, [{ groupId: 'g1', text: '确实，今天有点累' }]);
  assert.equal(
    policy.consider({ groupId: 'g1', text: '真的累', mentioned: false }),
    false,
  );
  policy.close();
});

test('ProactivePolicy stays silent when the model returns SKIP', async () => {
  const sent = [];
  const policy = new ProactivePolicy({
    config: config(),
    engine: {
      llm: { enabled: true },
      async proactiveReply() {
        return null;
      },
    },
    logger: silentLogger,
    now: () => 200_000,
    hour: () => 12,
    random: () => 0,
    getContext: () => '[最近群聊]\n小明: 随便聊聊',
    send: async (message) => sent.push(message),
  });

  policy.consider({ groupId: 'g1', text: '随便聊聊', mentioned: false });
  await wait(20);
  assert.deepEqual(sent, []);
  policy.close();
});

test('ProactivePolicy does not speak during quiet hours', () => {
  const policy = new ProactivePolicy({
    config: config(),
    engine: { llm: { enabled: true } },
    logger: silentLogger,
    now: () => 100_000,
    hour: () => 3,
    getContext: () => 'context',
    send: async () => {},
  });

  assert.equal(
    policy.consider({ groupId: 'g1', text: '有人吗', mentioned: false }),
    false,
  );
  policy.close();
});

test('ProactivePolicy cancels a pending message when the bot is mentioned', async () => {
  const sent = [];
  const policy = new ProactivePolicy({
    config: config({ debounceMs: 20 }),
    engine: {
      llm: { enabled: true },
      async proactiveReply() {
        return '不该发';
      },
    },
    logger: silentLogger,
    now: () => 100_000,
    hour: () => 12,
    random: () => 0,
    getContext: () => 'context',
    send: async (message) => sent.push(message),
  });

  policy.consider({ groupId: 'g1', text: '随便聊聊', mentioned: false });
  policy.cancel('g1');
  await wait(40);
  assert.deepEqual(sent, []);
  policy.close();
});
