import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const STAR_LYRICS = '一闪一闪亮晶晶满天都是小星星';
const STAR_NOTES = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];
const STAR_DURATIONS = [
  0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.8, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9,
];

export class SingingService {
  constructor({
    enabled = true,
    url = 'http://127.0.0.1:8765',
    timeoutMs = 60_000,
    steps = 20,
    dir = '/opt/qqbot/data/voice',
    ffmpeg = 'ffmpeg',
    logger,
    fetchImpl = globalThis.fetch,
    execFileImpl = execFileAsync,
    now = () => Date.now(),
  } = {}) {
    this.enabled = enabled;
    this.url = String(url).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.steps = steps;
    this.dir = dir;
    this.ffmpeg = ffmpeg;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.execFileImpl = execFileImpl;
    this.now = now;
  }

  shouldSing(text) {
    return this.enabled && /唱|哼两句|来首歌|来一首/.test(String(text ?? ''));
  }

  buildSong(text) {
    let lyrics = String(text ?? '')
      .replace(/(?:帮我|请|麻烦|给我|能不能|可以)?\s*(?:唱首歌|唱一首|唱个歌|来首歌|来一首|唱歌|哼两句)/g, '')
      .replace(/[^\u4e00-\u9fff]/g, '')
      .trim();

    if (!lyrics || lyrics.length < 2 || /小星星|一闪一闪/.test(text)) {
      lyrics = STAR_LYRICS;
    }
    lyrics = Array.from(lyrics).slice(0, 40).join('');
    const chars = Array.from(lyrics);
    const notes = chars.map((_, index) => ({
      midi: STAR_NOTES[index % STAR_NOTES.length],
      duration: STAR_DURATIONS[index % STAR_DURATIONS.length],
    }));
    return { lyrics, notes };
  }

  async sing(text) {
    if (!this.shouldSing(text)) return null;
    const song = this.buildSong(text);

    try {
      const response = await this.fetchImpl(`${this.url}/sing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics: song.lyrics,
          notes: song.notes,
          steps: this.steps,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`SVS HTTP ${response.status}`);
      }
      const wav = Buffer.from(await response.arrayBuffer());
      if (wav.length < 100 || wav.subarray(0, 4).toString() !== 'RIFF') {
        throw new Error('SVS 没有返回有效 WAV');
      }

      mkdirSync(this.dir, { recursive: true });
      const base = join(this.dir, `svs-${this.now()}-${randomUUID()}`);
      const wavPath = `${base}.wav`;
      const mp3Path = `${base}.mp3`;
      writeFileSync(wavPath, wav);
      await this.execFileImpl(
        this.ffmpeg,
        ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-qscale:a', '4', mp3Path],
        { timeout: 30_000 },
      );
      this.logger?.info('唱歌音频已生成', { lyrics: song.lyrics.length, bytes: wav.length });
      return {
        filePath: mp3Path,
        lyrics: song.lyrics,
        attribution: 'AI 合成：绮萱 / DiffSinger',
      };
    } catch (error) {
      this.logger?.warn('唱歌服务不可用', { error });
      return null;
    }
  }
}
