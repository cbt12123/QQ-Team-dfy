import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { truncateText } from '../text.js';

/**
 * Bounded, persisted transcript of recent group chatter. It is used only as
 * background context when the bot is mentioned; the bot does not reply to
 * these messages on its own.
 */
export class GroupContextStore {
  #groups = new Map();
  #saveTimer = null;

  constructor({
    maxMessages = 60,
    maxChars = 8000,
    maxMessageChars = 500,
    ttlMs = 6 * 60 * 60 * 1000,
    now = () => Date.now(),
    filePath = '',
    saveDelayMs = 200,
  } = {}) {
    this.maxMessages = Math.max(1, maxMessages);
    this.maxChars = Math.max(200, maxChars);
    this.maxMessageChars = Math.max(50, maxMessageChars);
    this.ttlMs = Math.max(1, ttlMs);
    this.now = now;
    this.filePath = filePath;
    this.saveDelayMs = Math.max(0, saveDelayMs);
    this.#load();
  }

  record({
    platform = 'napcat',
    groupId,
    userId = '',
    userName = '',
    text,
    messageId = '',
    timestamp = this.now(),
    isBot = false,
    mentioned = false,
  } = {}) {
    const cleanText = normalizeText(text, this.maxMessageChars);
    if (!groupId || !cleanText) return false;

    const key = `${platform}:${groupId}`;
    let entry = this.#groups.get(key);
    if (!entry) {
      entry = { messages: [], updatedAt: this.now() };
      this.#groups.set(key, entry);
    }

    if (messageId && entry.messages.some((message) => message.messageId === messageId)) {
      return false;
    }

    const time = Number(timestamp);
    entry.messages.push({
      userId: String(userId ?? ''),
      userName: String(userName ?? ''),
      text: cleanText,
      messageId: String(messageId ?? ''),
      timestamp: Number.isFinite(time) ? time : this.now(),
      isBot: Boolean(isBot),
      mentioned: Boolean(mentioned),
    });
    entry.updatedAt = this.now();
    this.#trim(entry);
    this.#scheduleSave();
    return true;
  }

  render(platform, groupId, { excludeMessageId = '', limit = 30 } = {}) {
    const entry = this.#groups.get(`${platform}:${groupId}`);
    if (!entry) return '';

    const cutoff = this.now() - this.ttlMs;
    const messages = entry.messages
      .filter(
        (message) =>
          message.timestamp >= cutoff &&
          (!excludeMessageId || message.messageId !== excludeMessageId),
      )
      .slice(-Math.max(1, limit));

    if (!messages.length) return '';
    return `[最近群聊]\n${messages.map(formatMessage).join('\n')}`;
  }

  count(platform, groupId) {
    return this.#groups.get(`${platform}:${groupId}`)?.messages.length ?? 0;
  }

  clear(platform, groupId) {
    const deleted = this.#groups.delete(`${platform}:${groupId}`);
    if (deleted) this.#scheduleSave();
    return deleted;
  }

  prune() {
    const cutoff = this.now() - this.ttlMs;
    let removed = 0;
    for (const [key, entry] of this.#groups) {
      const kept = entry.messages.filter((message) => message.timestamp >= cutoff);
      if (kept.length !== entry.messages.length) {
        entry.messages = kept;
        removed += 1;
      }
      if (!entry.messages.length) {
        this.#groups.delete(key);
        removed += 1;
      }
    }
    if (removed) this.#scheduleSave();
    return removed;
  }

  #trim(entry) {
    if (entry.messages.length > this.maxMessages) {
      entry.messages.splice(0, entry.messages.length - this.maxMessages);
    }

    let totalChars = entry.messages.reduce((sum, message) => sum + message.text.length, 0);
    while (entry.messages.length > 1 && totalChars > this.maxChars) {
      const removed = entry.messages.shift();
      totalChars -= removed.text.length;
    }
  }

  #load() {
    if (!this.filePath || !existsSync(this.filePath)) return;

    let payload;
    try {
      payload = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch {
      return;
    }
    if (!payload || typeof payload.groups !== 'object' || !payload.groups) return;

    const cutoff = this.now() - this.ttlMs;
    for (const [key, value] of Object.entries(payload.groups)) {
      if (!value || !Array.isArray(value.messages)) continue;
      const messages = value.messages
        .filter(
          (message) =>
            message &&
            typeof message.text === 'string' &&
            Number.isFinite(Number(message.timestamp)) &&
            Number(message.timestamp) >= cutoff,
        )
        .map((message) => ({
          userId: String(message.userId ?? ''),
          userName: String(message.userName ?? ''),
          text: truncateText(message.text, this.maxMessageChars),
          messageId: String(message.messageId ?? ''),
          timestamp: Number(message.timestamp),
          isBot: Boolean(message.isBot),
          mentioned: Boolean(message.mentioned),
        }))
        .slice(-this.maxMessages);

      if (!messages.length) continue;
      this.#groups.set(key, {
        messages,
        updatedAt: Number(value.updatedAt) || this.now(),
      });
    }
  }

  #scheduleSave() {
    if (!this.filePath || this.#saveTimer) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.flush();
    }, this.saveDelayMs);
    this.#saveTimer.unref?.();
  }

  flush() {
    if (!this.filePath) return;
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }

    const groups = {};
    for (const [key, value] of this.#groups) {
      groups[key] = {
        updatedAt: value.updatedAt,
        messages: value.messages,
      };
    }

    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ version: 1, savedAt: this.now(), groups }, null, 2)}\n`,
      { mode: 0o600 },
    );
    renameSync(temporaryPath, this.filePath);
  }

  close() {
    this.flush();
    this.#groups.clear();
  }
}

function normalizeText(value, maxChars) {
  const text = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateText(text, maxChars);
}

function formatMessage(message) {
  const name = message.userName || message.userId || '群友';
  return `${message.isBot ? `${name}(bot)` : name}: ${message.text}`;
}
