import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { analyzeOneBotMessage, splitText } from '../text.js';
import { collectForwardIds, collectReplyIds, formatForwardMessages } from '../forward.js';

const WS_OPEN = 1;
const WS_CLOSED = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * NapCat / OneBot 11 接入。
 * 连接 NapCat 的「WebSocket 服务器」，接收群消息并通过 send_group_msg 回复。
 * 非官方接口，存在账号风控风险，请使用小号并自行评估。
 */
export class NapCatAdapter {
  #reconnectTimer = null;
  #stableTimer = null;
  #pending = new Map();
  #seen = new Set();
  #forwardCache = new Map();
  #recentForwards = new Map();

  constructor({
    wsUrl = 'ws://127.0.0.1:3001',
    accessToken = '',
    onMessage,
    onGroupMessage,
    logger,
    dryRun = false,
    replyMaxChars = 1200,
    replyMaxParts = 4,
    forwardEnabled = true,
    allowedGroups = new Set(),
    privateAllowedUsers = new Set(),
    WebSocketImpl = WebSocket,
    reconnectBaseMs = 1000,
    reconnectMaxMs = 30_000,
    random = Math.random,
    apiTimeoutMs = 15_000,
    forwardMaxMessages = 60,
    forwardMaxChars = 6000,
    forwardCacheTtlMs = 10 * 60 * 1000,
    forwardRecentWindowMs = 5 * 60 * 1000,
  }) {
    this.wsUrl = wsUrl;
    this.accessToken = accessToken;
    this.onMessage = onMessage;
    this.onGroupMessage = onGroupMessage;
    this.logger = logger;
    this.dryRun = dryRun;
    this.replyMaxChars = replyMaxChars;
    this.replyMaxParts = replyMaxParts;
    this.forwardEnabled = forwardEnabled;
    this.allowedGroups = allowedGroups;
    this.privateAllowedUsers = privateAllowedUsers;
    this.WebSocketImpl = WebSocketImpl;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.random = random;
    this.apiTimeoutMs = apiTimeoutMs;
    this.forwardMaxMessages = forwardMaxMessages;
    this.forwardMaxChars = forwardMaxChars;
    this.forwardCacheTtlMs = forwardCacheTtlMs;
    this.forwardRecentWindowMs = forwardRecentWindowMs;

    this.ws = null;
    this.started = false;
    this.stopped = false;
    this.ready = false;
    this.reconnectAttempts = 0;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.#connect();
  }

  #connect() {
    if (this.stopped) return;

    let ws;
    try {
      ws = new this.WebSocketImpl(this.wsUrl, {
        headers: this.accessToken
          ? { Authorization: `Bearer ${this.accessToken}` }
          : undefined,
      });
    } catch (error) {
      this.logger?.error('创建 NapCat WebSocket 失败', { error, url: this.wsUrl });
      this.#scheduleReconnect();
      return;
    }

    this.ws = ws;
    this.logger?.info('连接 NapCat WebSocket', { url: this.wsUrl });

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.ready = true;
      this.logger?.info('NapCat 已连接，等待群 @ 消息');
      clearTimeout(this.#stableTimer);
      this.#stableTimer = setTimeout(() => {
        this.reconnectAttempts = 0;
      }, 5000);
      this.#stableTimer.unref?.();
    });

    ws.on('message', (data) => {
      if (this.ws !== ws) return;
      this.#onRawMessage(data);
    });

    ws.on('error', (error) => {
      if (this.ws !== ws) return;
      this.logger?.warn('NapCat WebSocket 错误', { error });
    });

    ws.on('close', (code, reason) => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.ws = null;
      clearTimeout(this.#stableTimer);
      this.#rejectPending(new Error('NapCat 连接已断开'));
      if (this.stopped) return;
      this.logger?.warn('NapCat 连接关闭', {
        code,
        reason: reason?.toString?.() ?? '',
      });
      this.#scheduleReconnect();
    });
  }

  #onRawMessage(data) {
    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
    } catch (error) {
      this.logger?.warn('无法解析 NapCat 报文', { error });
      return;
    }

    if (payload?.echo && this.#pending.has(payload.echo)) {
      this.#settleApiResponse(payload);
      return;
    }

    if (payload?.post_type !== 'message') return;

    if (payload.message_type === 'private') {
      void this.#handlePrivateMessage(payload).catch((error) => {
        this.logger?.error('处理 NapCat 私聊消息失败', { error });
      });
      return;
    }

    if (payload.message_type !== 'group') return;

    void this.#handleGroupMessage(payload).catch((error) => {
      this.logger?.error('处理 NapCat 群消息失败', { error });
    });
  }

  async #handlePrivateMessage(event) {
    const selfId = event.self_id;
    if (!selfId || String(event.user_id) === String(selfId)) return;

    const userId = String(event.user_id ?? '');
    if (!userId || !this.privateAllowedUsers.has(userId)) {
      this.logger?.debug('私聊用户不在白名单，已忽略', { userId: userId ? '***' : '' });
      return;
    }

    const messageId = String(event.message_id ?? '');
    const dedupeKey = `private:${userId}:${messageId || `${event.time}:${event.user_id}`}`;
    if (this.#seen.has(dedupeKey)) return;
    this.#seen.add(dedupeKey);
    if (this.#seen.size > 1000) {
      this.#seen.delete(this.#seen.values().next().value);
    }

    const info = analyzeOneBotMessage(event, selfId);
    let text = info.text;
    if (this.forwardEnabled && text.includes('[聊天记录]')) {
      text = await this.#expandForwards(event, text);
    }

    const userName = String(event.sender?.card || event.sender?.nickname || '');
    const message = {
      platform: 'napcat-private',
      groupId: `private:${userId}`,
      userId,
      userName,
      text,
      messageId,
      raw: event,
      reply: async (answer) => {
        await this.sendPrivateText(userId, answer);
      },
    };

    this.logger?.info('收到 QQ 私聊消息', {
      userId: '***',
      chars: Array.from(text).length,
    });

    Promise.resolve(this.onMessage(message)).catch((error) => {
      this.logger?.error('处理 QQ 私聊消息失败', { userId: '***', error });
    });
  }

  async #handleGroupMessage(event) {
    const selfId = event.self_id;
    if (!selfId || String(event.user_id) === String(selfId)) return;

    const groupId = String(event.group_id ?? '');
    if (!groupId) return;

    if (this.allowedGroups.size > 0 && !this.allowedGroups.has(groupId)) {
      this.logger?.debug('群不在白名单，已忽略', { groupId });
      return;
    }

    const userId = String(event.user_id ?? '');
    const userName = String(event.sender?.card || event.sender?.nickname || '');
    const messageId = String(event.message_id ?? '');
    const dedupeKey = `${groupId}:${messageId || `${event.time}:${event.user_id}`}`;
    if (this.#seen.has(dedupeKey)) return;
    this.#seen.add(dedupeKey);
    if (this.#seen.size > 1000) {
      this.#seen.delete(this.#seen.values().next().value);
    }

    const info = analyzeOneBotMessage(event, selfId);
    const messageForwardIds = collectForwardIds(event.message ?? event.raw_message);
    if (messageForwardIds.length) {
      this.#rememberForwards(groupId, userId, messageForwardIds);
      this.logger?.info('记录群内转发消息', {
        groupId,
        userId,
        count: messageForwardIds.length,
      });
    }

    // 所有群消息都进入旁听缓存；只有被 @ 时才生成回复。
    try {
      this.onGroupMessage?.({
        platform: 'napcat',
        groupId,
        userId,
        userName,
        text: info.text,
        messageId,
        timestamp:
          Number(event.time) > 0 ? Number(event.time) * 1000 : Date.now(),
        isBot: false,
        mentioned: info.mentioned,
      });
    } catch (error) {
      this.logger?.warn('记录群聊上下文失败', { groupId, error });
    }

    if (!info.mentioned) {
      this.logger?.debug('群消息未 @ 机器人，仅记录上下文', {
        groupId,
        userId,
        chars: Array.from(info.text).length,
      });
      return;
    }

    let text = this.forwardEnabled
      ? await this.#expandForwards(event, info.text)
      : info.text;

    const message = {
      platform: 'napcat',
      groupId,
      userId,
      userName,
      text,
      messageId,
      raw: event,
      reply: async (answer) => {
        await this.sendGroupText(groupId, answer, { mentionUserId: userId });
      },
    };

    this.logger?.info('收到群 @ 消息', {
      groupId,
      userId,
      userName,
      chars: Array.from(text).length,
    });

    Promise.resolve(this.onMessage(message)).catch((error) => {
      this.logger?.error('处理群 @ 消息失败', { groupId, userId, error });
    });
  }

  /**
   * Send plain text to a group. Passing mentionUserId makes the first chunk
   * an @ reply; proactive messages omit it.
   */
  async sendGroupText(groupId, answer, { mentionUserId = '' } = {}) {
    const chunks = splitText(answer, this.replyMaxChars, this.replyMaxParts);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const segments = [];
      if (mentionUserId && index === 0) {
        segments.push({ type: 'at', data: { qq: String(mentionUserId) } });
      }
      segments.push({ type: 'text', data: { text: `${mentionUserId && index === 0 ? ' ' : ''}${chunk}` } });

      if (this.dryRun) {
        this.logger?.info('[dry-run] NapCat 回复', {
          groupId,
          mentionUserId,
          seq: index + 1,
          content: chunk,
        });
      } else {
        await this.#callApi('send_group_msg', {
          group_id: groupId,
          message: segments,
        });
      }
      if (index < chunks.length - 1) await sleep(250);
    }
  }

  async sendPrivateText(userId, answer) {
    const chunks = splitText(answer, this.replyMaxChars, this.replyMaxParts);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (this.dryRun) {
        this.logger?.info('[dry-run] NapCat 私聊回复', {
          userId: '***',
          seq: index + 1,
          content: chunk,
        });
      } else {
        await this.#callApi('send_private_msg', {
          user_id: userId,
          message: [{ type: 'text', data: { text: chunk } }],
        });
      }
      if (index < chunks.length - 1) await sleep(250);
    }
  }

  async #expandForwards(event, originalText) {
    const rawMessage = event.message ?? event.raw_message;
    const forwardIds = collectForwardIds(rawMessage);
    const replyIds = collectReplyIds(rawMessage);
    const wantsRecent = this.#wantsForwardContext(originalText);
    if (!forwardIds.length && !replyIds.length && !wantsRecent) return originalText;

    const blocks = [];
    for (const id of forwardIds) {
      const block = await this.#readForward(id);
      if (block) blocks.push(block);
    }
    for (const id of replyIds) {
      const block = await this.#readRepliedForward(id);
      if (block && !blocks.includes(block)) blocks.push(block);
    }

    if (!blocks.length && wantsRecent) {
      const block = await this.#readRecentForward(
        String(event.group_id ?? ''),
        String(event.user_id ?? ''),
      );
      if (block) {
        blocks.push(block);
        this.logger?.info('使用最近一条转发聊天记录', {
          groupId: String(event.group_id ?? ''),
          userId: String(event.user_id ?? ''),
        });
      }
    }

    if (!blocks.length) return originalText;

    const base = originalText.trim();
    return `${base ? `${base}\n\n` : ''}${blocks.join('\n\n')}`.trim();
  }

  #rememberForwards(groupId, userId, forwardIds) {
    const now = Date.now();
    const recent = (this.#recentForwards.get(groupId) ?? []).filter(
      (entry) => now - entry.timestamp <= this.forwardRecentWindowMs,
    );
    for (const id of forwardIds) {
      recent.push({ id, userId, timestamp: now });
    }
    this.#recentForwards.set(groupId, recent.slice(-5));
  }

  async #readRecentForward(groupId, userId) {
    const now = Date.now();
    const recent = (this.#recentForwards.get(groupId) ?? []).filter(
      (entry) => now - entry.timestamp <= this.forwardRecentWindowMs,
    );
    if (!recent.length) return '';

    const preferred =
      [...recent].reverse().find((entry) => entry.userId === userId) ?? recent.at(-1);
    return this.#readForward(preferred.id);
  }

  #wantsForwardContext(text) {
    return /(聊天记录|转发|总结|记录|上面|看看|看这个|说了(什么|啥)|啥事|内容)/.test(
      String(text ?? ''),
    );
  }

  async #readRepliedForward(replyId) {
    const cacheKey = `reply:${replyId}`;
    const cached = this.#forwardCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.text;

    try {
      const data = await this.#callApi('get_msg', { message_id: replyId });
      const ids = collectForwardIds(data?.message ?? data?.raw_message);
      if (!ids.length) return '';

      const text = await this.#readForward(ids[0]);
      if (!text) return '';

      this.#forwardCache.set(cacheKey, {
        text,
        expiresAt: Date.now() + this.forwardCacheTtlMs,
      });
      if (this.#forwardCache.size > 50) {
        this.#forwardCache.delete(this.#forwardCache.keys().next().value);
      }
      this.logger?.info('已读取回复中的转发聊天记录', { replyId });
      return text;
    } catch (error) {
      this.logger?.warn('读取回复消息失败，尝试按转发 ID 读取', { replyId, error });
      const fallback = await this.#readForward(replyId);
      if (!fallback) return '';
      this.#forwardCache.set(cacheKey, {
        text: fallback,
        expiresAt: Date.now() + this.forwardCacheTtlMs,
      });
      return fallback;
    }
  }

  async #readForward(forwardId) {
    const now = Date.now();
    const cached = this.#forwardCache.get(forwardId);
    if (cached && now < cached.expiresAt) return cached.text;

    try {
      let data;
      try {
        data = await this.#callApi('get_forward_msg', { message_id: forwardId });
      } catch (firstError) {
        // 不同 OneBot 实现/版本对参数名接受度不同，再试一次 id。
        data = await this.#callApi('get_forward_msg', { id: forwardId });
      }
      const messages = Array.isArray(data?.messages)
        ? data.messages
        : Array.isArray(data?.data?.messages)
          ? data.data.messages
          : Array.isArray(data)
            ? data
            : [];
      const formatted = formatForwardMessages(messages, {
        maxMessages: this.forwardMaxMessages,
        maxChars: this.forwardMaxChars,
      });
      if (!formatted) return '';

      const text = `<forwarded_chat>\n${formatted}\n</forwarded_chat>`;
      this.#forwardCache.set(forwardId, {
        text,
        expiresAt: now + this.forwardCacheTtlMs,
      });
      if (this.#forwardCache.size > 50) {
        this.#forwardCache.delete(this.#forwardCache.keys().next().value);
      }
      this.logger?.info('已读取转发聊天记录', {
        forwardId,
        messages: messages.length,
        chars: Array.from(text).length,
      });
      return text;
    } catch (error) {
      this.logger?.warn('读取转发聊天记录失败', { forwardId, error });
      return '';
    }
  }

  #callApi(action, params) {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return Promise.reject(new Error('NapCat WebSocket 尚未连接'));
    }

    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(echo);
        reject(new Error(`NapCat API ${action} 超时（${this.apiTimeoutMs}ms）`));
      }, this.apiTimeoutMs);
      timer.unref?.();

      this.#pending.set(echo, { resolve, reject, timer, action });
      this.ws.send(JSON.stringify({ action, params, echo }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(echo);
        reject(error);
      });
    });
  }

  #settleApiResponse(payload) {
    const pending = this.#pending.get(payload.echo);
    if (!pending) return;
    this.#pending.delete(payload.echo);
    clearTimeout(pending.timer);

    if (payload.status === 'ok' || payload.retcode === 0) {
      pending.resolve(payload.data ?? payload);
      return;
    }

    const detail = payload.message || payload.wording || payload.status || '未知错误';
    pending.reject(new Error(`NapCat API ${pending.action} 失败：${detail}`));
  }

  #rejectPending(error) {
    for (const [echo, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(echo);
    }
  }

  #scheduleReconnect() {
    if (this.stopped || this.#reconnectTimer) return;

    const attempt = this.reconnectAttempts;
    this.reconnectAttempts += 1;
    const exponential = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * 2 ** Math.min(attempt, 8),
    );
    const delay = Math.round(exponential * (0.75 + this.random() * 0.5));

    this.logger?.info('准备重连 NapCat', { delayMs: delay });
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.stopped) return;
      this.#connect();
    }, delay);
  }

  async stop() {
    this.stopped = true;
    this.started = false;
    this.ready = false;
    clearTimeout(this.#reconnectTimer);
    clearTimeout(this.#stableTimer);
    this.#reconnectTimer = null;
    this.#stableTimer = null;
    this.#rejectPending(new Error('机器人已停止'));

    const ws = this.ws;
    this.ws = null;
    if (!ws || ws.readyState === WS_CLOSED) return;

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        ws.terminate();
        resolve();
      }, 500);
      timer.unref?.();
      ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.close(1000, 'bot stopped');
    });
  }
}
