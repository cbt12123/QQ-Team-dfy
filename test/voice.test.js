import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoiceService } from '../src/voice/voice.js';
import { silentLogger } from '../src/logger.js';

test('VoiceService detects voice and singing requests', () => {
  const voice = new VoiceService({ logger: silentLogger });
  assert.equal(voice.shouldSpeak('发条语音说晚安'), true);
  assert.equal(voice.shouldSpeak('普通文字'), false);
  assert.equal(voice.isSinging('唱首歌'), true);
  assert.equal(voice.isSinging('发条语音'), false);
});

test('VoiceService invokes edge-tts and returns the generated file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qqbot-voice-'));
  let args;
  const voice = new VoiceService({
    logger: silentLogger,
    bin: '/fake/edge-tts',
    dir: directory,
    execFileImpl: async (_bin, receivedArgs) => {
      args = receivedArgs;
      const output = receivedArgs[receivedArgs.indexOf('--write-media') + 1];
      const { writeFileSync } = await import('node:fs');
      writeFileSync(output, Buffer.from('fake mp3 data'.repeat(20)));
      return { stdout: '', stderr: '' };
    },
  });

  try {
    const result = await voice.synthesize('爸爸，记得吃饭');
    assert.ok(result?.filePath);
    assert.match(result.filePath, /\.mp3$/);
    assert.match(readFileSync(result.filePath, 'utf8'), /fake mp3 data/);
    assert.ok(args.includes('--voice'));
    assert.ok(args.includes('zh-CN-XiaoyiNeural'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
