import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

function cleanText(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_#>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export class BreezeVoiceService {
  constructor({
    enabled = true,
    url = 'http://127.0.0.1:7860',
    instruction = '一位可爱、活泼、声音清甜的少女，说话自然亲切，带一点调皮。',
    cfgScale = 4,
    seed = 42,
    timeoutMs = 120_000,
    dir = '/opt/qqbot/data/voice',
    ffmpeg = 'ffmpeg',
    logger,
    fetchImpl = globalThis.fetch,
    execFileImpl = execFileAsync,
    now = () => Date.now(),
  } = {}) {
    this.enabled = enabled;
    this.url = String(url).replace(/\/+$/, '');
    this.instruction = instruction;
    this.cfgScale = cfgScale;
    this.seed = seed;
    this.timeoutMs = timeoutMs;
    this.dir = dir;
    this.ffmpeg = ffmpeg;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.execFileImpl = execFileImpl;
    this.now = now;
  }

  async synthesize(text) {
    if (!this.enabled) return null;
    const speech = cleanText(text);
    if (!speech) return null;

    try {
      const form = new FormData();
      form.set('text', speech);
      form.set('instruction', this.instruction);
      form.set('cfg_scale', String(this.cfgScale));
      form.set('seed', String(this.seed));

      const response = await this.fetchImpl(`${this.url}/v1/audio/speech`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Breeze HTTP ${response.status}`);
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length < 100) throw new Error('Breeze 返回空音频');

      mkdirSync(this.dir, { recursive: true });
      const base = join(this.dir, `breeze-${this.now()}-${randomUUID()}`);
      const isWav = audio.subarray(0, 4).toString() === 'RIFF';
      const inputPath = `${base}.${isWav ? 'wav' : 'pcm'}`;
      const mp3Path = `${base}.mp3`;
      writeFileSync(inputPath, audio);

      const args = isWav
        ? ['-y', '-loglevel', 'error', '-i', inputPath]
        : ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', inputPath];
      args.push('-codec:a', 'libmp3lame', '-qscale:a', '4', mp3Path);
      await this.execFileImpl(this.ffmpeg, args, { timeout: 30_000 });

      this.logger?.info('Breeze 语音已生成', {
        chars: Array.from(speech).length,
        bytes: audio.length,
        wav: isWav,
      });
      return { filePath: mp3Path, text: speech };
    } catch (error) {
      this.logger?.warn('Breeze 语音失败', { error });
      return null;
    }
  }
}
