import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SingingService } from '../src/singing/singing.js';
import { silentLogger } from '../src/logger.js';

test('SingingService builds the default 小星星 song', () => {
  const service = new SingingService({ logger: silentLogger });
  assert.equal(service.shouldSing('唱首歌'), true);
  assert.equal(service.shouldSing('发条语音'), false);
  const song = service.buildSong('唱首歌');
  assert.equal(song.lyrics, '一闪一闪亮晶晶满天都是小星星');
  assert.equal(song.notes.length, Array.from(song.lyrics).length);
});

test('SingingService calls the SVS container and writes a voice file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qqbot-svs-'));
  let requestBody;
  let ffmpegArgs;
  const service = new SingingService({
    logger: silentLogger,
    dir: directory,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async arrayBuffer() {
          const buffer = Buffer.from('RIFF' + '0'.repeat(120));
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        },
      };
    },
    execFileImpl: async (_bin, args) => {
      ffmpegArgs = args;
      const { writeFileSync } = await import('node:fs');
      writeFileSync(args[args.length - 1], Buffer.from('fake mp3'));
      return { stdout: '', stderr: '' };
    },
  });

  try {
    const result = await service.sing('唱一首小星星');
    assert.ok(result?.filePath);
    assert.match(result.filePath, /\.mp3$/);
    assert.equal(readFileSync(result.filePath, 'utf8'), 'fake mp3');
    assert.equal(requestBody.lyrics, '一闪一闪亮晶晶满天都是小星星');
    assert.ok(Array.isArray(requestBody.notes));
    assert.ok(ffmpegArgs.includes('libmp3lame'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
