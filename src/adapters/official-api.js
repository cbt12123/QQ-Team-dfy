export class OfficialApiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = 'OfficialApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function parseJson(text, context) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new OfficialApiError(`${context} 返回了非 JSON 内容：${text.slice(0, 300)}`);
  }
}

function errorDetail(payload, raw) {
  if (payload?.message) return `${payload.code ? `[${payload.code}] ` : ''}${payload.message}`;
  if (payload?.error) return typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error);
  return raw.slice(0, 300) || '未知错误';
}

export class OfficialApi {
  #token = '';
  #tokenExpiresAt = 0;
  #tokenPromise = null;

  constructor({
    appId,
    appSecret,
    apiBase = 'https://api.bot.qq.com',
    tokenUrl,
    fetchImpl = globalThis.fetch,
    logger,
    now = () => Date.now(),
    timeoutMs = 15_000,
  }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.apiBase = String(apiBase).replace(/\/+$/, '');
    this.tokenUrl = tokenUrl || `${this.apiBase}/app/getAppAccessToken`;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  async getAccessToken({ force = false } = {}) {
    if (!force && this.#token && this.now() < this.#tokenExpiresAt) {
      return this.#token;
    }
    if (this.#tokenPromise) return this.#tokenPromise;

    this.#tokenPromise = this.#fetchAccessToken().finally(() => {
      this.#tokenPromise = null;
    });
    return this.#tokenPromise;
  }

  async #fetchAccessToken() {
    let response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appId: this.appId, clientSecret: this.appSecret }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new OfficialApiError(`获取 access_token 网络失败：${error.message}`);
    }

    const raw = await response.text();
    const payload = parseJson(raw, '获取 access_token');
    if (!response.ok || payload.code) {
      throw new OfficialApiError(
        `获取 access_token 失败：${errorDetail(payload, raw)}`,
        { status: response.status, code: payload.code, body: raw },
      );
    }
    if (!payload.access_token) {
      throw new OfficialApiError('获取 access_token 失败：响应中没有 access_token', {
        status: response.status,
        body: raw,
      });
    }

    const expiresIn = Number(payload.expires_in) || 7200;
    this.#token = payload.access_token;
    // 提前 60 秒刷新，避免边界过期。
    this.#tokenExpiresAt = this.now() + Math.max(60, expiresIn - 60) * 1000;
    this.logger?.info('access_token 已刷新', { expiresIn });
    return this.#token;
  }

  async #request(path, options = {}) {
    const token = await this.getAccessToken();
    let response;
    try {
      response = await this.fetchImpl(`${this.apiBase}${path}`, {
        ...options,
        headers: {
          Accept: 'application/json',
          Authorization: `QQBot ${token}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers ?? {}),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new OfficialApiError(`请求 ${path} 网络失败：${error.message}`);
    }

    const raw = await response.text();
    const payload = parseJson(raw, `请求 ${path}`);
    if (!response.ok || (payload.code && payload.code !== 0)) {
      throw new OfficialApiError(
        `请求 ${path} 失败：${errorDetail(payload, raw)}`,
        { status: response.status, code: payload.code, body: raw },
      );
    }
    return payload;
  }

  async getGatewayUrl() {
    const payload = await this.#request('/gateway');
    if (!payload.url) {
      throw new OfficialApiError('获取 WebSocket 网关失败：响应中没有 url', { body: payload });
    }
    return payload.url;
  }

  async sendGroupText({ groupId, content, msgId, msgSeq = 1 }) {
    if (!groupId) throw new Error('sendGroupText 缺少 groupId');
    if (!content) throw new Error('sendGroupText 缺少内容');

    const body = { msg_type: 0, content };
    if (msgId) {
      body.msg_id = msgId;
      body.msg_seq = msgSeq;
    }

    return this.#request(`/v2/groups/${encodeURIComponent(groupId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}
