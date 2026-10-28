import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createRuntime } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { analyzeOneBotMessage } from '../src/text.js';
import { silentLogger } from '../src/logger.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await wait(20);
  }
  throw new Error('Timed out waiting for group reply');
}

test('other-member mentions are recognized in array and CQ formats', () => {
  for (const message of [
    [{ type: 'at', data: { qq: '20002' } }, { type: 'text', data: { text: '怎么看' } }],
    '[CQ:at,qq=20002] 怎么看',
    '[CQ:at,qq=all] 大家好',
  ]) {
    assert.equal(analyzeOneBotMessage({ message }, '10001').mentionsOthers, true);
  }
  assert.equal(analyzeOneBotMessage({ message: '[CQ:at,qq=10001] 怎么看' }, '10001').mentionsOthers, false);
});

test('runtime joins without an initial mention, continues, saves memory, and always handles mentions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-participation-'));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const actions = [];
  let peer;
  server.on('connection', (socket) => {
    peer = socket;
    socket.on('message', (raw) => {
      const p = JSON.parse(String(raw));
      if (p.action !== 'send_group_msg') return;
      actions.push(p);
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: p.echo, data: { message_id: 5000 + actions.length } }));
    });
  });
  const config = loadConfig({ env: {
    ADAPTER: 'napcat', DATA_DIR: dir, LLM_API_KEY: 'test-only',
    NAPCAT_WS_URL: `ws://127.0.0.1:${server.address().port}`,
    NAPCAT_ALLOWED_GROUPS: '123456', PROACTIVE_ENABLED: '1', PROACTIVE_GROUPS: '123456',
    PROACTIVE_CHANCE: '1', PROACTIVE_DEBOUNCE_MS: '0', PROACTIVE_QUIET_HOURS: '',
    PROACTIVE_FOLLOWUP_COOLDOWN_SEC: '0',
    WEATHER_ENABLED: '0', SEARCH_ENABLED: '0', VOICE_ENABLED: '0',
  } });
  const runtime = createRuntime(config, { logger: silentLogger });
  const calls = [];
  runtime.llm.chat = async (o) => { calls.push(o); return '自然接住这句话'; };
  runtime.vision.prepare = async (urls) => urls.map(() => 'data:image/png;base64,test');
  let id = 0;
  const send = (message, user = 20002) => peer.send(JSON.stringify({
    post_type: 'message', message_type: 'group', self_id: 10001,
    group_id: 123456, user_id: user, message_id: ++id,
    time: Math.floor(Date.now() / 1000), sender: { nickname: '测试群友' }, message,
  }));
  const text = (value) => ({ type: 'text', data: { text: value } });
  try {
    await runtime.start();
    await until(() => runtime.adapter.ready && peer);
    send([text('今天出去玩很开心')]);
    const key = 'napcat:123456:20002';
    await until(() => runtime.memory.get(key).length === 2);
    assert.equal(actions[0].params.message[0].type, 'text');

    // Even a very short follow-up bypasses ordinary participation probability/cooldown.
    config.proactive.chance = 0;
    send([{ type: 'image', data: { url: 'https://example.com/meme.png' } }]);
    send([text('这个呢')]);
    await until(() => runtime.memory.get(key).length === 4);
    assert.equal(calls[1].history.length, 2);
    assert.deepEqual(calls[1].images, ['data:image/png;base64,test']);
    assert.equal(calls[1].model, config.vision.model);

    send([{ type: 'at', data: { qq: '30003' } }, text('你怎么看')]);
    await wait(50);
    assert.equal(actions.length, 2);

    // A different speaker can also continue by quoting a recent bot message.
    send([{ type: 'reply', data: { id: '5002' } }, text('然后呢')], 30003);
    await until(() => actions.length === 3);

    // Direct mentions are independent of probability, quiet hours and hourly limits.
    config.proactive.maxPerHour = 1;
    for (let h = 0; h < 24; h++) runtime.proactive.quietHours.add(h);
    send([{ type: 'at', data: { qq: '10001' } }, text('请回答')]);
    await until(() => actions.length === 4);
    assert.equal(actions[3].params.message[0].type, 'at');
  } finally {
    await runtime.stop();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime learns an allowlisted private interest and recalls it during group participation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-cross-scene-'));
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  let peer;
  const sends = [];
  server.on('connection', socket => {
    peer = socket;
    socket.on('message', raw => {
      const p = JSON.parse(String(raw));
      if (!['send_group_msg', 'send_private_msg'].includes(p.action)) return;
      sends.push(p);
      socket.send(JSON.stringify({ status: 'ok', retcode: 0, echo: p.echo, data: { message_id: 5000 + sends.length } }));
    });
  });
  const config = loadConfig({ env: {
    ADAPTER: 'napcat', DATA_DIR: dir, LLM_API_KEY: 'test-only',
    NAPCAT_WS_URL: `ws://127.0.0.1:${server.address().port}`,
    NAPCAT_PRIVATE_ALLOWED_USERS: '20002', NAPCAT_ALLOWED_GROUPS: '123456',
    MEMORY_SHARE_ORDINARY_PRIVATE: '1',
    PROACTIVE_ENABLED: '1', PROACTIVE_GROUPS: '123456', PROACTIVE_CHANCE: '1',
    PROACTIVE_DEBOUNCE_MS: '0', PROACTIVE_QUIET_HOURS: '',
    WEATHER_ENABLED: '0', SEARCH_ENABLED: '0', VOICE_ENABLED: '0',
  } });
  const runtime = createRuntime(config, { logger: silentLogger });
  const calls = [];
  runtime.llm.chat = async o => {
    if (o.systemPrompt?.includes('记忆整理器')) return JSON.stringify({ items: [{
      kind: 'preference', key: '摄影', text: '我平时喜欢摄影', evidence: '我平时喜欢摄影',
      visibility: 'ordinary', status: 'active',
    }] });
    calls.push(o); return o.personalMemory?.includes('摄影') ? '最近在拍什么？' : '你好';
  };
  try {
    await runtime.start();
    await until(() => runtime.adapter.ready && peer);
    peer.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: 10001,
      user_id: 20002, message_id: 1, message: [{ type: 'text', data: { text: '我平时喜欢摄影' } }] }));
    await until(() => sends.some(s => s.action === 'send_private_msg'));
    peer.send(JSON.stringify({ post_type: 'message', message_type: 'group', self_id: 10001,
      group_id: 123456, user_id: 20002, message_id: 2,
      message: [{ type: 'text', data: { text: '好无聊啊' } }] }));
    await until(() => sends.some(s => s.action === 'send_group_msg'));
    assert.match(calls.at(-1).personalMemory, /摄影/);
    assert.match(sends.at(-1).params.message[0].data.text, /拍什么/);
    assert.doesNotMatch(runtime.groupContext.render('napcat', '123456'), /我平时喜欢摄影/);
  } finally {
    await runtime.stop();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
