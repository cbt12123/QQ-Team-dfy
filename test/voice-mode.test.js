import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseVoiceCommand,
  shouldUseVoice,
  VoiceModeStore,
} from '../src/voice/voice-mode.js';

test('parseVoiceCommand supports on/off/auto/status', () => {
  assert.equal(parseVoiceCommand('/语音').mode, 'on');
  assert.equal(parseVoiceCommand('/语音 开').mode, 'on');
  assert.equal(parseVoiceCommand('/语音 关').mode, 'off');
  assert.equal(parseVoiceCommand('/文字').mode, 'off');
  assert.equal(parseVoiceCommand('/语音 自动').mode, 'auto');
  assert.equal(parseVoiceCommand('/语音 状态').mode, 'status');
  assert.equal(parseVoiceCommand('普通消息'), null);
});

test('VoiceModeStore persists per-chat choices', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qqbot-voice-mode-'));
  const file = join(directory, 'modes.json');
  try {
    const store = new VoiceModeStore(file);
    store.set('napcat:g1:u1', 'on');
    store.set('napcat:g1:u2', 'off');
    const reloaded = new VoiceModeStore(file);
    assert.equal(reloaded.get('napcat:g1:u1'), 'on');
    assert.equal(reloaded.get('napcat:g1:u2'), 'off');
    assert.equal(reloaded.get('napcat:g1:u3'), 'auto');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shouldUseVoice respects explicit requests and auto mode', () => {
  const voice = {
    enabled: true,
    always: false,
    isVoiceRequest: (text) => text.includes('发语音'),
    shouldSpeak: (text) => text.includes('发语音'),
  };
  assert.equal(shouldUseVoice({ mode: 'on', text: '普通消息', voice }), true);
  assert.equal(shouldUseVoice({ mode: 'off', text: '普通消息', voice }), false);
  assert.equal(shouldUseVoice({ mode: 'off', text: '发语音', voice }), true);
  assert.equal(shouldUseVoice({ mode: 'auto', text: '普通消息', voice }), false);
});
