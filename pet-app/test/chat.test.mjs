import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

test('two accounts have isolated actual model contexts and persisted histories; forged user identity is ignored', async t => {
  const calls = [];
  const { request, register } = await fixture(t, { chat: { reply: async options => { calls.push(options); return `回答：${options.text}`; } } });
  const alice = await register('alice'); const bob = await register('bob');
  const memory = await request('/api/memories', { cookie: alice.cookie, method: 'POST', body: { text: '我喜欢蓝莓' } });
  assert.equal(memory.status, 201);
  const answer = await request('/api/messages', { cookie: alice.cookie, method: 'POST', body: { requestId: 'alice-message-001', text: '我的秘密是蓝鲸', user_id: bob.data.user.id } });
  assert.equal(answer.status, 200);
  assert.equal(answer.data.message.text, '回答：我的秘密是蓝鲸');
  assert.equal((await request('/api/messages', { cookie: bob.cookie })).data.messages.length, 0);
  assert.equal((await request('/api/memories', { cookie: bob.cookie })).data.memories.length, 0);
  assert.equal((await request(`/api/memories/${memory.data.memory.id}`, { cookie: bob.cookie, method: 'DELETE' })).status, 404);
  await request('/api/messages', { cookie: alice.cookie, method: 'POST', body: { requestId: 'alice-message-002', text: '继续' } });
  await request('/api/messages', { cookie: bob.cookie, method: 'POST', body: { requestId: 'bob-message-001', text: '你好' } });
  assert.match(JSON.stringify(calls[1]), /蓝鲸/);
  assert.match(JSON.stringify(calls[1]), /蓝莓/);
  assert.doesNotMatch(JSON.stringify(calls[2]), /蓝鲸|蓝莓/);
});

test('request IDs are idempotent, failures remain explicit and no provider means no pretend AI', async t => {
  let count = 0;
  const { request, register } = await fixture(t, { chat: { reply: async () => { count++; throw new Error('private-provider-key-must-not-leak'); } } });
  const alice = await register('alice');
  const body = { requestId: 'one-message-001', text: '你好' };
  const first = await request('/api/messages', { cookie: alice.cookie, method: 'POST', body });
  assert.equal(first.status, 502);
  assert.doesNotMatch(JSON.stringify(first.data), /private-provider-key/);
  assert.equal((await request('/api/messages', { cookie: alice.cookie, method: 'POST', body })).status, 409);
  assert.equal(count, 1);
  assert.equal((await request('/api/messages', { cookie: alice.cookie })).data.requests[0].state, 'failed');
});

test('successful retries reuse a persisted answer, and request IDs cannot be reused for different text', async t => {
  let count = 0;
  const { request, register } = await fixture(t, { chat: { reply: async () => { count++; return '好呀'; } } });
  const alice = await register('alice');
  const body = { requestId: 'same-message-001', text: '你好' };
  const first = await request('/api/messages', { cookie: alice.cookie, method: 'POST', body });
  const again = await request('/api/messages', { cookie: alice.cookie, method: 'POST', body });
  assert.equal(first.status, 200);
  assert.equal(again.data.message.id, first.data.message.id);
  assert.equal(count, 1);
  assert.equal((await request('/api/messages', { cookie: alice.cookie, method: 'POST', body: { ...body, text: 'changed' } })).status, 409);
});

test('clearing memories during generation prevents late reply resurrection and leaves other users intact', { timeout: 3000 }, async t => {
  let release; let started;
  const gate = new Promise(resolve => { started = resolve; });
  const { request, register } = await fixture(t, { chat: { reply: async () => { started(); return new Promise(resolve => { release = resolve; }); } } });
  const alice = await register('alice'); const bob = await register('bob');
  await request('/api/memories', { cookie: alice.cookie, method: 'POST', body: { text: '忘掉的秘密' } });
  await request('/api/memories', { cookie: bob.cookie, method: 'POST', body: { text: '保留的记忆' } });
  const pending = request('/api/messages', { cookie: alice.cookie, method: 'POST', body: { requestId: 'slow-message-001', text: '秘密' } });
  await gate;
  assert.equal((await request('/api/messages', { cookie: alice.cookie, method: 'POST', body: { requestId: 'slow-message-002', text: '另一个' } })).status, 409);
  assert.equal((await request('/api/memories', { cookie: alice.cookie, method: 'DELETE' })).status, 200);
  release('旧秘密的回复');
  assert.equal((await pending).status, 409);
  assert.equal((await request('/api/messages', { cookie: alice.cookie })).data.messages.length, 0);
  assert.equal((await request('/api/memories', { cookie: alice.cookie })).data.memories.length, 0);
  assert.equal((await request('/api/memories', { cookie: bob.cookie })).data.memories.length, 1);
});

test('message and memory input limits are enforced and unavailable model returns 503', async t => {
  const { request, register } = await fixture(t);
  const alice = await register('alice');
  assert.equal((await request('/api/messages', { cookie: alice.cookie, method: 'POST', body: { requestId: 'valid-id-001', text: 'hi' } })).status, 503);
  assert.equal((await request('/api/memories', { cookie: alice.cookie, method: 'POST', body: { text: 'x'.repeat(501) } })).status, 400);
});

test('long conversations keep newest context while export retains the complete transcript', async t => {
  const { app, request, register } = await fixture(t);
  const alice = await register('alice');
  const insert = app.store.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)');
  for (let i = 0; i < 510; i++) insert.run(`history-${i}`, alice.data.user.id, `request-${i}`, i % 2 ? 'assistant' : 'user', `line ${i}`, 1000 + i);
  const history = (await request('/api/messages', { cookie: alice.cookie })).data.messages;
  assert.equal(history.at(-1).text, 'line 509');
  const exported = (await request('/api/export', { cookie: alice.cookie })).data.messages;
  assert.equal(exported.length, 510);
});
