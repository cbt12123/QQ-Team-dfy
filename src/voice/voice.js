import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

function cleanSpeech(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_#>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class VoiceService {
  constructor({
    enabled = true,
    always = false,
    singing = true,
    bin = 'edge-tts',
    voice = 'zh-CN-XiaoyiNeural',
    rate = '+8%',
    pitch = '+6Hz',
    volume = '+0%',
    dir = '/opt/qqbot/data/voice',
    maxChars = 300,
    timeoutMs = 30_000,
    logger,
    execFileImpl = execFileAsync,
    now = () => Date.now(),
  } = {}) {
    this.enabled = enabled;
    this.always = always;
    this.singing = singing;
    this.bin = bin;
    this.voice = voice;
    this.rate = rate;
    this.pitch = pitch;
    this.volume = volume;
    this.dir = dir;
    this.maxChars = maxChars;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.execFileImpl = execFileImpl;
    this.now = now;
  }

  shouldSpeak(text) {
    if (!this.enabled) return false;
    if (this.always) return true;
    return /语音|发语音|说给我听|用语音|听听你|念一段|唱两句|唱一首|唱首歌|唱歌|哼两句/.test(
      String(text ?? ''),
    );
  }

  isSinging(text) {
    return this.singing && /唱|哼两句|来首歌|来一首/.test(String(text ?? ''));
  }

  async synthesize(text, { singing = false } = {}) {
    if (!this.enabled) return null;
    let speech = cleanSpeech(text);
    if (!speech) return null;
    speech = Array.from(speech).slice(0, this.maxChars).join('');

    mkdirSync(this.dir, { recursive: true });
    const filePath = join(this.dir, `${this.now()}-${randomUUID()}.mp3`);
    const rate = singing ? '-8%' : this.rate;
    const pitch = singing ? '+24Hz' : this.pitch;

    try {
      await this.execFileImpl(
        this.bin,
        [
          '--voice',
          this.voice,
          `--rate=${rate}`,
          `--pitch=${pitch}`,
          `--volume=${this.volume}`,
          '--text',
          speech,
          '--write-media',
          filePath,
        ],
        { timeout: this.timeoutMs, windowsHide: true },
      );
      if (!existsSync(filePath) || statSync(filePath).size < 100) {
        throw new Error('TTS 没有生成有效音频');
      }
      this.#cleanup();
      this.logger?.info('语音已生成', { chars: Array.from(speech).length, singing });
      return { filePath, text: speech };
    } catch (error) {
      this.logger?.warn('语音生成失败', { error });
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch {
        // ignore cleanup error
      }
      return null;
    }
  }

  #cleanup() {
    try {
      const files = readdirSync(this.dir)
        .map((name) => join(this.dir, name))
        .filter((file) => file.endsWith('.mp3'))
        .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const item of files.slice(100)) unlinkSync(item.file);
      const cutoff = this.now() - 60 * 60 * 1000;
      for (const item of files) {
        if (item.mtime < cutoff) unlinkSync(item.file);
      }
    } catch {
      // best-effort cleanup
    }
  }
}
