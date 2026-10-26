/**
 * Decide whether the bot should join an ongoing group conversation without
 * being mentioned. This is deliberately conservative even in "active" mode:
 * every proactive message costs social capital and account risk.
 */
export class ProactivePolicy {
  #timers = new Map();
  #pending = new Map();
  #lastAttempt = new Map();
  #speaks = new Map();
  #generation = new Map();

  constructor({
    config,
    engine,
    getContext,
    send,
    onBotMessage,
    logger,
    now = () => Date.now(),
    random = Math.random,
    hour = () => new Date().getHours(),
  }) {
    this.config = config;
    this.engine = engine;
    this.getContext = getContext;
    this.send = send;
    this.onBotMessage = onBotMessage;
    this.logger = logger;
    this.now = now;
    this.random = random;
    this.hour = hour;
    this.groups = new Set(config.groups ?? []);
    this.quietHours = parseQuietHours(config.quietHours);
  }

  get enabled() {
    return Boolean(
      this.config.enabled &&
        this.groups.size &&
        this.engine?.llm?.enabled,
    );
  }

  consider(event) {
    if (!this.enabled) return false;
    const groupId = String(event.groupId ?? '');
    if (!this.groups.has(groupId)) return false;
    if (event.mentioned) {
      this.cancel(groupId);
      return false;
    }

    const text = String(event.text ?? '').trim();
    if (!this.#isCandidate(text)) return false;
    if (!this.#canAttempt(groupId)) return false;

    this.#pending.set(groupId, { ...event, groupId, text });
    clearTimeout(this.#timers.get(groupId));
    const timer = setTimeout(() => {
      this.#timers.delete(groupId);
      void this.#fire(groupId);
    }, this.config.debounceMs);
    timer.unref?.();
    this.#timers.set(groupId, timer);
    return true;
  }

  cancel(groupId) {
    const key = String(groupId ?? '');
    clearTimeout(this.#timers.get(key));
    this.#timers.delete(key);
    this.#pending.delete(key);
    this.#generation.set(key, (this.#generation.get(key) ?? 0) + 1);
  }

  close() {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#pending.clear();
  }

  #isCandidate(text) {
    if (text.length < this.config.minChars) return false;
    if (text.startsWith('/')) return false;
    if (/^\[(图片|语音|视频|文件|表情|卡片|聊天记录)\]$/.test(text)) return false;
    if (/https?:\/\//i.test(text)) return false;

    const isQuestion =
      /[?？]|吗|咋|怎么|为什么|为啥|谁|什么|哪|如何|能不能|有没有|是不是/.test(text);
    if (isQuestion) return true;

    const mentionsBot = text.includes(this.config.botName ?? '');
    if (mentionsBot) return true;

    return this.random() < this.config.chance;
  }

  #canAttempt(groupId) {
    if (this.quietHours.has(this.hour())) return false;

    const lastAttempt = this.#lastAttempt.get(groupId) ?? 0;
    if (this.now() - lastAttempt < this.config.cooldownMs) return false;
    return this.#speaksInLastHour(groupId) < this.config.maxPerHour;
  }

  #speaksInLastHour(groupId) {
    const cutoff = this.now() - 60 * 60 * 1000;
    const recent = (this.#speaks.get(groupId) ?? []).filter((timestamp) => timestamp > cutoff);
    this.#speaks.set(groupId, recent);
    return recent.length;
  }

  async #fire(groupId) {
    const event = this.#pending.get(groupId);
    this.#pending.delete(groupId);
    if (!event || !this.#canAttempt(groupId)) return;

    const generation = this.#generation.get(groupId) ?? 0;
    this.#lastAttempt.set(groupId, this.now());

    const context = this.getContext(groupId);
    if (!context) return;

    this.logger?.info('考虑主动接话', {
      groupId,
      triggerChars: Array.from(event.text).length,
    });

    let answer;
    try {
      answer = await this.engine.proactiveReply({
        context,
        triggerText: event.text,
      });
    } catch (error) {
      this.logger?.warn('主动接话生成失败', { groupId, error });
      return;
    }

    if (!answer) {
      this.logger?.debug('主动接话判断为沉默', { groupId });
      return;
    }
    if ((this.#generation.get(groupId) ?? 0) !== generation) {
      this.logger?.debug('主动接话已被新的 @ 取消', { groupId });
      return;
    }
    if (this.#speaksInLastHour(groupId) >= this.config.maxPerHour) return;

    try {
      await this.send({ groupId, text: answer });
    } catch (error) {
      this.logger?.warn('主动消息发送失败', { groupId, error });
      return;
    }

    const now = this.now();
    this.#speaks.set(groupId, [...(this.#speaks.get(groupId) ?? []), now]);
    this.onBotMessage?.({ groupId, text: answer });
    this.logger?.info('主动接话已发送', {
      groupId,
      chars: Array.from(answer).length,
      perHour: this.#speaksInLastHour(groupId),
    });
  }
}

export function parseQuietHours(raw) {
  const hours = new Set();
  for (const part of String(raw ?? '').split(/[,，\s]+/)) {
    if (!part) continue;
    const match = part.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
    if (!match) continue;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 0 || start > 23 || end < 0 || end > 23) continue;

    if (start <= end) {
      for (let hour = start; hour <= end; hour += 1) hours.add(hour);
    } else {
      for (let hour = start; hour <= 23; hour += 1) hours.add(hour);
      for (let hour = 0; hour <= end; hour += 1) hours.add(hour);
    }
  }
  return hours;
}
