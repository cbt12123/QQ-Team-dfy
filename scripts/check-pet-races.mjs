import { chromium } from '../.cache/pet-qa/node_modules/playwright/index.mjs';
import { createApp } from '../pet-app/server.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'pet-races-'));
const app = createApp({ dataDir: dir, secureCookies: false, chat: { reply: async () => '需要删除的旧内容' }, asr: { transcribe: async () => 'hello' }, tts: { synthesize: async () => ({ bytes: Buffer.from('test-audio'), mime: 'audio/mpeg' }) } });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage(); const failures = [];
try {
  await page.addInitScript(() => {
    window.testStreams = []; window.testPermissionRequests = []; window.testPlays = 0;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      const track = { stopped: false, stop() { this.stopped = true; } };
      const stream = { getTracks: () => [track] }; window.testStreams.push(track); window.testPermissionRequests.push(() => resolve(stream));
    });
    window.MediaRecorder = class extends EventTarget {
      static isTypeSupported() { return true; }
      constructor(stream) { super(); this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.dispatchEvent(new Event('stop')); }
    };
    window.Audio = class extends EventTarget { play() { window.testPlays++; return Promise.resolve(); } pause() {} };
  });
  await page.goto(base + '/#invite=' + app.store.createInvite({ admin: true }));
  await page.locator('#username').fill('raceuser'); await page.locator('#password').fill('a race test password 123'); await page.locator('#auth-submit').click();
  await page.locator('#chat-view').waitFor({ state: 'visible' });
  await page.locator('#record').focus(); await page.keyboard.down('Space');
  await page.waitForFunction(() => window.testPermissionRequests.length === 1); await page.keyboard.up('Space');
  await page.keyboard.down('Space'); await page.waitForFunction(() => window.testPermissionRequests.length === 2);
  await page.evaluate(() => { window.testPermissionRequests[0](); window.testPermissionRequests[1](); });
  await page.waitForTimeout(50); await page.keyboard.up('Space');
  try { assert.ok(await page.evaluate(() => window.testStreams.every(track => track.stopped)), 'obsolete permission requests must stop their own microphone streams'); }
  catch (error) { failures.push(error.message); }
  await page.locator('#message-input').fill('旧内容'); await page.locator('#send').click(); await page.locator('#messages .assistant').waitFor();
  let releaseAudio; const audioGate = new Promise(resolve => { releaseAudio = resolve; }); let audioStarted;
  const audioStart = new Promise(resolve => { audioStarted = resolve; });
  await page.route('**/api/audio/*', async route => { const response = await route.fetch(); audioStarted(); await audioGate; await route.fulfill({ response }); });
  await page.locator('#messages .assistant button').click(); await audioStart;
  await page.locator('#open-memory').click(); page.once('dialog', dialog => dialog.accept()); await page.locator('#clear-history').click();
  await page.waitForFunction(() => !document.querySelector('#messages .message'));
  releaseAudio(); await page.waitForTimeout(150);
  try { assert.equal(await page.evaluate(() => window.testPlays), 0, 'late audio after successful deletion must never play'); }
  catch (error) { failures.push(error.message); }
  await page.unroute('**/api/audio/*');
  // A fetched transcript held in transit must also be invalidated by deletion.
  let releaseHistory, historyStarted; const historyGate = new Promise(resolve => { releaseHistory = resolve; }); const historyStart = new Promise(resolve => { historyStarted = resolve; }); let held = false;
  await page.route('**/api/messages', async route => {
    if (route.request().method() === 'GET' && !held) { held = true; const response = await route.fetch(); historyStarted(); await historyGate; await route.fulfill({ response }); }
    else await route.continue();
  });
  await page.locator('#message-input').fill('旧历史'); await page.locator('#send').click(); await historyStart;
  page.once('dialog', dialog => dialog.accept()); await page.locator('#clear-history').click();
  await page.waitForFunction(() => !document.querySelector('#messages .message'));
  releaseHistory(); await page.waitForTimeout(150);
  try { assert.equal(await page.locator('#messages .message').count(), 0, 'late history after successful deletion must not reappear'); }
  catch (error) { failures.push(error.message); }
  assert.deepEqual(failures, []);
  console.log('PASS: delayed microphone permission, deleted audio and deleted history races');
} finally { await browser.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
