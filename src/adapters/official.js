import WebSocket from 'ws';
import { splitText } from '../text.js';

const WS_OPEN = 1;
const WS_CLOSED = 3;
const OFFICIAL_GROUP_INTENT = 1 << 25;
const FATAL_CLOSE_CODES = new Set([4914, 4915]);
const IDENTIFY_REQUIRED_CODES = new Set([4006, 4007]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * QQ 官方机器人 WebSocket 接入。
 * 文档：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html
 */
export class OfficialAdapter {
  #heartbeatTimer = null;
  #reconnectTimer = null;
  #heartbeatAwaited = false;
  #connectionSeq = 0;
  #currentToken = '';
  #forceIdentify = false;
  #seen = new Set();

  constructor({
    api,
    onMessage,
    logger,
    dryRun = false,
    replyMaxChars = 1200,
    replyMaxParts = 4,
    allowedGroups = new Set(),
    WebSocketImpl = WebSocket,
    reconnectBaseMs = 1000,
    reconnectMaxMs = 30_000,
    random = Math.random,
  }) {
    this.api = api;
    this.onMessage = onMessage;
    this.logger = logger;
    this.dryRun = dryRun;
    this.replyMaxChars = replyMaxChars;
    this.replyMaxParts = replyMaxParts;
    this.allowedGroups = allowedGroups;
    this.WebSocketImpl = WebSocketImpl;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.random = random;

    this.ws = null;
    this.sessionId = '';
    this.seq = null;
    this.botUser = null;
    this.started = false;
    this.stopped = false;
    this.ready = false;
    this.reconnectAttempts = 0;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.ready = false;
    await this.#open({ resume: false });
  }

  async #open({ resume }) {
    if (this.stopped) return;

    const token = await this.api.getAccessToken();
    const url = await this.api.getGatewayUrl();
    const connectionId = ++this.#connectionSeq;
    const shouldResume = Boolean(resume && this.sessionId);
    this.#currentToken = token;
    this.#forceIdentify = false;

    this.logger?.info('连接 QQ 网关', { resume: shouldResume, url });
    const ws = new this.WebSocketImpl(url);
    this.ws = ws;

    ws.on('open', () => {
      if (connectionId !== this.#connectionSeq) return;
      this.logger?.debug('WebSocket 已建立，等待 Hello');
    });

    ws.on('message', (data) => {
      if (connectionId !== this.#connectionSeq) return;
      this.#onRawMessage(data);
    });

    ws.on('error', (error) => {
      if (connectionId !== this.#connectionSeq) return;
      this.logger?.warn('QQ 网关 WebSocket 错误', { error });
    });

    ws.on('close', (code, reason) => {
      if (connectionId !== this.#connectionSeq) return;
      this.#onClose(code, reason?.toString?.() ?? '');
    });
  }

  #send(payload) {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      this.logger?.warn('发送网关报文失败', { error });
      return false;
    }
  }

  #onRawMessage(data) {
    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
    } catch (error) {
      this.logger?.warn('无法解析网关报文', { error });
      return;
    }

    if (typeof payload?.s === 'number') this.seq = payload.s;
    const op = payload?.op;

    if (op === 10) {
      this.#onHello(payload.d ?? {});
      return;
    }
    if (op === 11) {
      this.#heartbeatAwaited = false;
      return;
    }
    if (op === 7) {
      this.logger?.warn('网关要求重连');
      this.#requestReconnect(true);
      return;
    }
    if (op === 9) {
      this.logger?.warn('网关 Session 无效，需要重新鉴权');
      this.sessionId = '';
      this.seq = null;
      this.#forceIdentify = true;
      this.#requestReconnect(false);
      return;
    }
    if (op === 0) {
      this.#onDispatch(payload);
    }
  }

  #onHello(data) {
    const interval = Number(data.heartbeat_interval) || 45_000;
    this.logger?.debug('收到网关 Hello', { heartbeatInterval: interval });

    if (!this.#forceIdentify && this.sessionId) {
      this.#send({
        op: 6,
        d: {
          token: `QQBot ${this.#currentToken}`,
          session_id: this.sessionId,
          seq: this.seq,
        },
      });
      this.logger?.info('尝试恢复 QQ 网关 Session');
    } else {
      this.#send({
        op: 2,
        d: {
          token: `QQBot ${this.#currentToken}`,
          intents: OFFICIAL_GROUP_INTENT,
          shard: [0, 1],
          properties: {
            $os: process.platform,
            $browser: 'qq-group-chatbot',
            $device: 'qq-group-chatbot',
          },
        },
      });
      this.logger?.info('已发送网关鉴权');
    }

    this.#startHeartbeat(interval);
  }

  #startHeartbeat(interval) {
    clearInterval(this.#heartbeatTimer);
    this.#heartbeatAwaited = false;
    this.#heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WS_OPEN) return;
      if (this.#heartbeatAwaited) {
        this.logger?.warn('心跳超时，主动重连');
        this.ws.terminate();
        return;
      }
      this.#heartbeatAwaited = true;
      this.#send({ op: 1, d: this.seq });
    }, interval);
    this.#heartbeatTimer.unref?.();
  }

  #onDispatch(payload) {
    const type = payload.t;
    const data = payload.d ?? {};

    if (type === 'READY') {
      this.sessionId = data.session_id ?? '';
      this.botUser = data.user ?? null;
      this.ready = true;
      this.reconnectAttempts = 0;
      this.logger?.info('QQ 机器人已上线', {
        bot: this.botUser?.username,
        sessionId: this.sessionId,
      });
      return;
    }

    if (type === 'RESUMED') {
      this.ready = true;
      this.reconnectAttempts = 0;
      this.logger?.info('QQ 网关 Session 已恢复');
      return;
    }

    if (type === 'GROUP_AT_MESSAGE_CREATE') {
      this.#handleGroupAt(data);
      return;
    }

    this.logger?.debug('收到未处理事件', { type });
  }

  #handleGroupAt(data) {
    const groupId = String(data.group_openid ?? '');
    const messageId = String(data.id ?? '');
    if (!groupId || !messageId) {
      this.logger?.warn('群 @ 事件缺少 group_openid 或 id，已忽略');
      return;
    }

    if (this.allowedGroups.size > 0 && !this.allowedGroups.has(groupId)) {
      this.logger?.debug('群不在白名单，已忽略', { groupId });
      return;
    }

    const dedupeKey = `${groupId}:${messageId}`;
    if (this.#seen.has(dedupeKey)) {
      this.logger?.debug('收到重复的群消息，已忽略', { messageId });
      return;
    }
    this.#seen.add(dedupeKey);
    if (this.#seen.size > 500) {
      this.#seen.delete(this.#seen.values().next().value);
    }

    const userId = String(data.author?.member_openid ?? data.author?.id ?? '');
    const userName = String(data.author?.username ?? '');
    const text = String(data.content ?? '').trim();
    let replySeq = 0;

    const message = {
      platform: 'official',
      groupId,
      userId,
      userName,
      text,
      messageId,
      raw: data,
      reply: async (answer) => {
        const chunks = splitText(answer, this.replyMaxChars, this.replyMaxParts);
        for (const chunk of chunks) {
          replySeq += 1;
          if (this.dryRun) {
            this.logger?.info('[dry-run] 官方回复', { groupId, seq: replySeq, content: chunk });
          } else {
            await this.api.sendGroupText({
              groupId,
              content: chunk,
              msgId: messageId,
              msgSeq: replySeq,
            });
          }
          if (replySeq < chunks.length) await sleep(250);
        }
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

  #requestReconnect(resume) {
    const ws = this.ws;
    if (!ws || ws.readyState === WS_CLOSED) {
      this.#scheduleReconnect(resume);
      return;
    }
    ws.close(4000, 'reconnect');
  }

  #onClose(code, reason) {
    clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
    this.#heartbeatAwaited = false;
    this.ws = null;
    this.ready = false;

    if (this.stopped) return;
    this.logger?.warn('QQ 网关连接关闭', { code, reason });

    if (FATAL_CLOSE_CODES.has(code)) {
      this.logger?.error('QQ 网关拒绝连接，机器人可能已下架或封禁，请到开放平台检查状态', { code });
      this.stopped = true;
      return;
    }

    if (IDENTIFY_REQUIRED_CODES.has(code)) {
      this.sessionId = '';
      this.seq = null;
      this.#forceIdentify = true;
    }

    const resume = !this.#forceIdentify && Boolean(this.sessionId);
    this.#scheduleReconnect(resume);
  }

  #scheduleReconnect(resume) {
    if (this.stopped || this.#reconnectTimer) return;

    const attempt = this.reconnectAttempts;
    this.reconnectAttempts += 1;
    const exponential = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * 2 ** Math.min(attempt, 8),
    );
    const delay = Math.round(exponential * (0.75 + this.random() * 0.5));

    this.logger?.info('准备重连 QQ 网关', { delayMs: delay, resume });
    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      if (this.stopped) return;
      try {
        await this.#open({ resume });
      } catch (error) {
        this.logger?.error('重连 QQ 网关失败', { error });
        this.#scheduleReconnect(resume);
      }
    }, delay);
  }

  async stop() {
    this.stopped = true;
    this.started = false;
    this.ready = false;
    clearInterval(this.#heartbeatTimer);
    clearTimeout(this.#reconnectTimer);
    this.#heartbeatTimer = null;
    this.#reconnectTimer = null;

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
