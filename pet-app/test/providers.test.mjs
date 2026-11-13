import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { configuredChat } from '../chat.mjs';
import { configuredVoice } from '../voice.mjs';

test('configured model and voice adapters exchange real HTTP payloads with compatible provider contracts', async t => {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ path: req.url, body: Buffer.concat(chunks).toString(), headers: req.headers });
    if (req.url === '/v1/chat/completions') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '你好呀' } }] })); }
    else if (req.url === '/v1/audio/transcriptions') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: '识别成功' })); }
    else { res.setHeader('Content-Type', 'audio/mpeg'); res.end('audio-bytes'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  const chat = configuredChat({ LLM_BASE_URL: base, LLM_API_KEY: 'test-only', LLM_MODEL: 'test-model' });
  assert.equal(await chat.reply({ history: [], memories: ['当前用户喜欢蓝莓'], text: '你好' }), '你好呀');
  const model = JSON.parse(requests[0].body);
  assert.match(model.messages[0].content, /独立应用/);
  assert.match(model.messages.at(-1).content, /当前用户喜欢蓝莓/);
  assert.doesNotMatch(model.messages.at(-1).content, /QQ群聊|QQ私聊|QQ 语音|点歌流程/);
  assert.equal(requests[0].path, '/v1/chat/completions');
  const { asr, tts } = configuredVoice({ PET_ASR_BASE_URL: base, PET_ASR_API_KEY: 'asr-test-only', PET_TTS_BASE_URL: base, PET_TTS_API_KEY: 'tts-test-only' });
  assert.equal(await asr.transcribe(Buffer.from('recording-bytes'), 'audio/mpeg'), '识别成功');
  assert.match(requests[1].body, /filename="recording.mp3"/);
  assert.match(requests[1].body, /recording-bytes/);
  assert.equal((await tts.synthesize('你好')).bytes.toString(), 'audio-bytes');
  assert.equal(JSON.parse(requests[2].body).input, '你好');
  assert.equal(configuredChat({}), undefined);
  assert.equal(configuredVoice({}).asr, undefined);
});

test('canceling an app reply aborts the actual provider HTTP request', async t => {
  let received;
  const started = new Promise(resolve => { received = resolve; });
  const server = createServer((req, res) => {
    req.resume();
    received();
    req.on('end', () => setTimeout(() => {
      if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: 'too late' } }] }));
    }, 250));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const chat = configuredChat({ LLM_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, LLM_API_KEY: 'test-only' });
  const controller = new AbortController();
  const reply = chat.reply({ history: [], memories: [], text: 'hello', signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(reply, /abort|cancel/i);
});
