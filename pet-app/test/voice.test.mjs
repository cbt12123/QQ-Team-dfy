import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

test('speech is owned by the message author and audio is never shared across accounts', async t => {
  const { request, register, base } = await fixture(t, { chat: { reply: async () => '你好呀' },
    tts: { synthesize: async () => ({ bytes: Buffer.from('test-audio'), mime: 'audio/mpeg' }) },
    asr: { transcribe: async () => '我今天很好' } });
  const alice = await register('alice'); const bob = await register('bob');
  const message = (await request('/api/messages', { method: 'POST', cookie: alice.cookie, body: { requestId: 'audio-message-001', text: '你好' } })).data.message;
  assert.equal((await request(`/api/messages/${message.id}/audio`, { method: 'POST', cookie: bob.cookie, body: {} })).status, 404);
  const speech = await request(`/api/messages/${message.id}/audio`, { method: 'POST', cookie: alice.cookie, body: {} });
  assert.equal(speech.status, 201);
  const audio = await fetch(`${base}/api/audio/${speech.data.id}`, { headers: { Cookie: alice.cookie } });
  assert.equal(audio.status, 200); assert.equal(await audio.text(), 'test-audio');
  assert.match(audio.headers.get('cache-control'), /no-store/);
  assert.equal((await request(`/api/audio/${speech.data.id}`, { cookie: bob.cookie })).status, 404);
  const transcription = await fetch(base + '/api/transcribe', { method: 'POST', headers: { Cookie: alice.cookie, 'X-Pet-Request': '1', 'Content-Type': 'audio/webm' }, body: Buffer.from('sample') });
  assert.equal(transcription.status, 200); assert.equal((await transcription.json()).text, '我今天很好');
  assert.equal((await request('/api/history', { method: 'DELETE', cookie: alice.cookie })).status, 200);
  assert.equal((await request(`/api/audio/${speech.data.id}`, { cookie: alice.cookie })).status, 404);
});

test('recording upload validates type and size and unconfigured services are explicit', async t => {
  const { request, register, base } = await fixture(t, { asr: { transcribe: async () => 'hi' } });
  const alice = await register('alice');
  const upload = (type, body) => fetch(base + '/api/transcribe', { method: 'POST', headers: { Cookie: alice.cookie, 'X-Pet-Request': '1', 'Content-Type': type }, body });
  assert.equal((await upload('text/plain', 'not audio')).status, 415);
  assert.equal((await upload('audio/webm', Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await upload('audio/webm', Buffer.alloc(0))).status, 400);
  assert.equal((await request('/api/me', { cookie: alice.cookie })).data.capabilities.tts, false);
});

test('deletion during synthesis discards the late audio instead of restoring cleared content', { timeout: 3000 }, async t => {
  let release, started; const gate = new Promise(resolve => { started = resolve; });
  const { request, register, app } = await fixture(t, { chat: { reply: async () => '旧秘密' },
    tts: { synthesize: async () => { started(); return new Promise(resolve => { release = resolve; }); } } });
  const alice = await register('alice');
  const message = (await request('/api/messages', { method: 'POST', cookie: alice.cookie, body: { requestId: 'audio-delete-001', text: '秘密' } })).data.message;
  const pending = request(`/api/messages/${message.id}/audio`, { method: 'POST', cookie: alice.cookie, body: {} });
  await gate; await request('/api/memories', { method: 'DELETE', cookie: alice.cookie });
  release({ bytes: Buffer.from('secret'), mime: 'audio/mpeg' });
  assert.equal((await pending).status, 409);
  assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM audio').get().n, 0);
});
