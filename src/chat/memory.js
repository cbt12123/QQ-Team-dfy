import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Per-user conversation memory with optional JSON persistence. The store is
 * intentionally small and synchronous-on-flush: a QQ group bot produces very
 * little data, and this keeps deployment dependency-free.
 */
export class ConversationStore {
  #entries = new Map();
  #saveTimer = null;

  constructor({
    maxTurns = 8,
    ttlMs = 2 * 60 * 60 * 1000,
    now = () => Date.now(),
    filePath = '',
    saveDelayMs = 150,
  } = {}) {
    this.maxTurns = Math.max(0, maxTurns);
    this.ttlMs = Math.max(1, ttlMs);
    this.now = now;
    this.filePath = filePath;
    this.saveDelayMs = Math.max(0, saveDelayMs);
    this.#load();
  }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return [];
    if (this.now() - entry.updatedAt >= this.ttlMs) {
      this.#entries.delete(key);
      this.#scheduleSave();
      return [];
    }
    return entry.messages.map((message) => ({ ...message }));
  }

  append(key, userText, assistantText) {
    if (this.maxTurns === 0) {
      this.#entries.delete(key);
      this.#scheduleSave();
      return;
    }

    const previous = this.get(key);
    const messages = [
      ...previous,
      { role: 'user', content: userText },
      { role: 'assistant', content: assistantText },
    ].slice(-this.maxTurns * 2);

    this.#entries.set(key, { messages, updatedAt: this.now() });
    this.#scheduleSave();
  }

  clear(key) {
    const deleted = this.#entries.delete(key);
    if (deleted) this.#scheduleSave();
    return deleted;
  }

  prune() {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.#entries) {
      if (now - entry.updatedAt >= this.ttlMs) {
        this.#entries.delete(key);
        removed += 1;
      }
    }
    if (removed) this.#scheduleSave();
    return removed;
  }

  get size() {
    return this.#entries.size;
  }

  #load() {
    if (!this.filePath || !existsSync(this.filePath)) return;

    let payload;
    try {
      payload = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch {
      return;
    }
    if (!payload || typeof payload.entries !== 'object' || !payload.entries) return;

    for (const [key, value] of Object.entries(payload.entries)) {
      if (!value || !Array.isArray(value.messages)) continue;
      const messages = value.messages.filter(
        (message) =>
          message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string',
      );
      if (!messages.length) continue;

      const updatedAt = Number(value.updatedAt);
      if (!Number.isFinite(updatedAt) || this.now() - updatedAt >= this.ttlMs) continue;
      this.#entries.set(key, {
        messages: messages.slice(-this.maxTurns * 2),
        updatedAt,
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

    const entries = {};
    for (const [key, value] of this.#entries) {
      entries[key] = {
        updatedAt: value.updatedAt,
        messages: value.messages,
      };
    }

    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ version: 1, savedAt: this.now(), entries }, null, 2)}\n`,
      { mode: 0o600 },
    );
    renameSync(temporaryPath, this.filePath);
  }

  close() {
    this.flush();
    this.#entries.clear();
  }
}
