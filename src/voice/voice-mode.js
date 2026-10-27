import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const VOICE_REQUEST = /语音|发语音|说给我听|用语音|听听你|念一段|唱两句|唱一首|唱首歌|唱歌|哼两句/;

export function parseVoiceCommand(text) {
  const value = String(text ?? '').trim();
  const match = /^\/(语音|文字)(?:\s+(开|关|自动|状态))?\s*$/.exec(value);
  if (!match) return null;

  if (match[1] === '文字') {
    return { mode: 'off', reply: '好，之后默认用文字回复。需要语音时直接说“发语音”。' };
  }

  const arg = match[2] ?? '开';
  if (arg === '关') {
    return { mode: 'off', reply: '好，之后默认用文字回复。需要语音时直接说“发语音”。' };
  }
  if (arg === '自动') {
    return {
      mode: 'auto',
      reply: '好，恢复自动模式：默认文字，消息里说“发语音 / 用语音”时才回语音。',
    };
  }
  if (arg === '状态') {
    return { mode: 'status', reply: '' };
  }
  return {
    mode: 'on',
    reply: '好，之后在这个聊天里默认用语音回复。想改回文字发 /文字。',
  };
}

export class VoiceModeStore {
  constructor(filePath = '') {
    this.filePath = filePath;
    this.modes = new Map();
    this.#load();
  }

  #load() {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
      for (const [key, value] of Object.entries(data)) {
        if (value === 'on' || value === 'off' || value === 'auto') {
          this.modes.set(key, value);
        }
      }
    } catch {
      // Ignore a broken preference file and start from defaults.
    }
  }

  #save() {
    if (!this.filePath) return;
    try {
      writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.modes), null, 2));
    } catch {
      // Preferences are best-effort; a read-only data dir should not break chat.
    }
  }

  get(key) {
    return this.modes.get(key) ?? 'auto';
  }

  set(key, mode) {
    if (mode === 'auto') this.modes.delete(key);
    else this.modes.set(key, mode);
    this.#save();
  }
}

export function shouldUseVoice({ mode, text, voice }) {
  if (!voice?.enabled) return false;
  if (mode === 'on') return true;
  if (mode === 'off') return voice.isVoiceRequest(text);
  return voice.shouldSpeak(text);
}

export function isVoiceRequest(text) {
  return VOICE_REQUEST.test(String(text ?? ''));
}
