import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BreezeVoiceService } from '../src/voice/breeze.js';
import { silentLogger } from '../src/logger.js';

test('BreezeVoiceService calls the TTS API and converts PCM to mp3', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qqbot-breeze-'));
  let form;
  const service = new BreezeVoiceService({
    logger: silentLogger,
    dir: directory,
    instruction: '可爱的少女',
    fetchImpl: async (_url, options) => {
      form = options.body;
      return {
        ok: true,
        async arrayBuffer() {
          return Buffer.alloc(4800, 1).buffer;
        },
      };
    },
    execFileImpl: async (_bin, args) => {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(args[args.length - 1], Buffer.from('fake breeze mp3'));
      return { stdout: '', stderr: '' };
    },
  });

  try {
    const result = await service.synthesize('爸爸，今天过得怎么样');
    assert.ok(result?.filePath);
    assert.equal(readFileSync(result.filePath, 'utf8'), 'fake breeze mp3');
    assert.equal(form.get('text'), '爸爸，今天过得怎么样');
    assert.equal(form.get('instruction'), '可爱的少女');
    assert.equal(form.get('cfg_scale'), '4');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
