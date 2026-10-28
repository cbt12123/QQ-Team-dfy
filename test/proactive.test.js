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

function fixture(overrides = {}, generate = async () => '自然接话') {
  const calls = [];
  const sent = [];
  let time = 100_000;
  const policy = new ProactivePolicy({
    config: config(overrides),
    engine: { llm: { enabled: true }, proactiveReply: async (o) => { calls.push(o); return generate(o); } },
    now: () => time,
    hour: () => 12,
    random: () => 0.5,
    getContext: () => '最近群聊',
    send: async (m) => sent.push(m),
  });
  return { policy, calls, sent, advance: (ms) => { time += ms; } };
}

test('ordinary questions and bot names obey the configured probability', () => {
  const f = fixture({ chance: 0 });
  try {
    for (const text of ['大家怎么看？', '今天真开心', '阿岚今天真开心']) {
      assert.equal(f.policy.consider({ groupId: 'g1', userId: 'u1', text }), false);
    }
  } finally { f.policy.close(); }
});

test('same speaker can continue after an unsolicited reply without another mention', async () => {
  const f = fixture({ cooldownMs: 60_000, followUpCooldownMs: 3000, maxPerHour: 10 });
  try {
    f.policy.consider({ groupId: 'g1', userId: 'u1', text: '今天出去玩了' });
    await wait(20);
    f.advance(4000);
    assert.equal(f.policy.consider({ groupId: 'g1', userId: 'u1', text: '嗯' }), true);
    await wait(20);
    assert.equal(f.calls[1].followUp, true);
    assert.equal(f.sent.length, 2);
  } finally { f.policy.close(); }
});

test('a direct reply opens a bounded follow-up window only for its group and speaker', async () => {
  const f = fixture({ chance: 0 });
  try {
    f.policy.noteReply('g1', 'u1');
    assert.equal(f.policy.consider({ groupId: 'g1', userId: 'u2', text: '然后呢' }), false);
    assert.equal(f.policy.consider({ groupId: 'g2', userId: 'u1', text: '然后呢' }), false);
    assert.equal(f.policy.consider({ groupId: 'g1', userId: 'u1', text: '然后呢' }), true);
    await wait(20);
    assert.equal(f.sent.length, 1);
    f.advance(120_001);
    assert.equal(f.policy.consider({ groupId: 'g1', userId: 'u1', text: '然后呢' }), false);
  } finally { f.policy.close(); }
});

test('messages to other people cancel pending replies and end follow-up priority', async () => {
  const f = fixture({ chance: 0, debounceMs: 10 });
  try {
    f.policy.noteReply('g1', 'u1');
    f.policy.consider({ groupId: 'g1', userId: 'u1', text: '接着聊' });
    assert.equal(f.policy.consider({ groupId: 'g1', userId: 'u1', text: '@别人 你怎么看', directedToOthers: true }), false);
    await wait(30);
    assert.equal(f.sent.length, 0);
    assert.equal(f.policy.consider({ groupId: 'g1', userId: 'u1', text: '接着聊' }), false);
  } finally { f.policy.close(); }
});

test('new ordinary chatter invalidates a reply while it is being generated', async () => {
  let finish;
  const f = fixture({}, () => new Promise((resolve) => { finish = resolve; }));
  try {
    f.policy.consider({ groupId: 'g1', userId: 'u1', text: '最开始的话题' });
    await wait(20);
    f.policy.consider({ groupId: 'g1', userId: 'u2', text: '大家已经换话题了' });
    finish('过时的回复');
    await wait(20);
    assert.equal(f.sent.length, 0);
  } finally { f.policy.close(); }
});

test('follow-ups still respect quiet hours and the hourly limit', async () => {
  const f = fixture({ chance: 0, maxPerHour: 1 });
  try {
    f.policy.noteReply('g1', 'u1');
    f.policy.consider({ groupId: 'g1', userId: 'u1', text: '然后呢' });
    await wait(20);
    f.advance(4000);
    assert.equal(f.policy.consider({ groupId: 'g1', userId: 'u1', text: '继续呢' }), false);
  } finally { f.policy.close(); }
  const quiet = fixture({ chance: 0, quietHours: '12' });
  try {
    quiet.policy.noteReply('g1', 'u1');
    assert.equal(quiet.policy.consider({ groupId: 'g1', userId: 'u1', text: '然后呢' }), false);
  } finally { quiet.policy.close(); }
});
