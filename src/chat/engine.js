import { ConversationStore } from './memory.js';
import { truncateText } from '../text.js';

const MAX_INPUT_CHARS = 4000;

function normalizeProactiveText(value) {
  const text = String(value ?? '')
    .replace(/```(?:text|markdown)?/gi, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
  if (!text || /<SKIP>|\[SKIP\]|^(skip|不接|沉默)$/i.test(text)) return '';
  return text;
}

function helpText(botName) {
  return [
    `我是 ${botName}，在群里 @我 并直接说问题就能聊天。`,
    '',
    '可用命令：',
    '/help  查看这条帮助',
    '/reset 清空我们之间的对话记忆',
    '/ping  检查我是否在线',
    '/id    查看当前群和用户 ID（配置白名单时有用）',
  ].join('\n');
}

export class ChatEngine {
  #queues = new Map();
  #searchIntents = new Map();

  constructor(config, { logger, llm, memory, search, weather, now = () => Date.now() } = {}) {
    this.config = config;
    this.logger = logger;
    this.llm = llm;
    this.search = search;
    this.weather = weather;
    this.memory =
      memory ??
      new ConversationStore({
        maxTurns: config.maxHistoryTurns,
        ttlMs: config.historyTtlMs,
        now,
      });
    this.now = now;
  }

  /**
   * Serialize messages per user so two quick @ messages cannot race on the
   * same transcript. Different users still chat in parallel.
   */
  reply(message) {
    const key = `${message.platform}:${message.groupId}:${message.userId}`;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.#generate(message, key));
    const tracked = task.finally(() => {
      if (this.#queues.get(key) === tracked) this.#queues.delete(key);
    });
    this.#queues.set(key, tracked);
    return tracked;
  }

  /**
   * Decide whether to join an ongoing group conversation without being @'d.
   * Returns null when the model chooses silence.
   */
  async proactiveReply({ context = '', triggerText = '', userId = '' } = {}) {
    if (!this.llm?.enabled) return null;
    const relationship = this.#relationshipFor(userId);
    const weatherData = this.weather?.shouldFetch(triggerText)
      ? (await this.weather.get()) || '[天气数据暂时获取失败]'
      : '';

    const prompt = [
      '群里正在聊天，没有人 @ 你。你是群友，不是客服，现在处于活跃模式。',
      '下面是最近一段群聊，不是只有最后一句话。先理解大家在聊什么，再自然接一句。',
      '如果最后一句只是“是的”“哈哈”“确实”这种附和，要接回上面的主题，不要只对这几个字作答。',
      '规则：',
      '- 想接：只输出 1 句中文，口语化，不 @ 任何人，不长篇，不装懂；可以好奇、追问、吐槽或附和。',
      '- 只有确实不该接时才输出 <SKIP>。',
      `当前群里最后一句是：${triggerText}`,
    ].join('\n');

    let answer;
    try {
      answer = await this.llm.chat({
        history: [],
        userText: prompt,
        context,
        relationship,
        weather: weatherData,
      });
    } catch (error) {
      this.logger?.warn('主动接话判断失败', { error });
      return null;
    }

    let text = normalizeProactiveText(answer);
    if (!text && this.config.proactive?.retryOnSkip !== false) {
      // 活跃模式兜底：模型第一次太保守时，再要求它给一句短反应。
      try {
        const retry = await this.llm.chat({
          history: [],
          userText: [
            '群里正在聊天，你没有被人 @。现在是活跃模式，必须接一句，不要沉默。',
            '先看完整段群聊，接当前话题，不要只回复最后几个字。',
            '只输出一句中文，口语化，不 @ 人，不装懂，可以好奇或追问，不超过 50 字。',
            `当前群里最后一句是：${triggerText}`,
          ].join('\n'),
          context,
          relationship,
          weather: weatherData,
        });
        text = normalizeProactiveText(retry);
      } catch (error) {
        this.logger?.warn('主动接话兜底失败', { error });
      }
    }
    if (!text) return null;

    text = text
      .replace(/^(?:@\S+\s*)+/u, '')
      .replace(/^(?:[-*]\s*)/, '')
      .trim();
    if (Array.from(text).length < 2) return null;

    return truncateText(text, this.config.proactive?.maxChars ?? 160);
  }

  #relationshipFor(userId) {
    const family = this.config.family ?? {};
    const isFather = Boolean(
      family.fatherQq && String(userId) === String(family.fatherQq),
    );
    if (isFather) {
      return [
        '当前和你说话的是你爸爸。你是他的女儿，要叫他“爸爸”。',
        `他住在${family.fatherCity || '西安'}，职业是${family.fatherJob || '程序员'}。这是你记得的家庭设定。`,
        '关心他时可以提醒他天气、吃饭、休息，但不要向其他群友透露他的隐私。',
      ].join('\n');
    }
    return '当前用户不是爸爸。不要叫他爸爸，也不要编造父女关系；正常称呼群友即可。';
  }

  #resolveSearchQuery(text, sessionKey, groupContext) {
    const now = this.now();
    const intent = this.#searchIntents.get(sessionKey);
    const isFollowUp =
      /查到了吗|查到了没|搜到了吗|有结果了吗|找到了吗|资料呢|结果呢|出结果了吗/.test(text);
    const hasTopic = this.#hasResearchTopic(text);
    const isMetaSearch =
      /搜索引擎|搜索功能|给点资料|帮我们查|帮我查|再搜|试一下|试试/.test(text);
    const isKeywordRefinement =
      Boolean(intent) && text.length <= 40 && /[+＋]/.test(text) && hasTopic;

    if (isFollowUp && intent && now < intent.expiresAt) {
      this.#searchIntents.set(sessionKey, { ...intent, expiresAt: now + 30 * 60 * 1000 });
      return intent.query;
    }

    if (isKeywordRefinement) {
      this.#searchIntents.set(sessionKey, { query: text, expiresAt: now + 30 * 60 * 1000 });
      return text;
    }

    if (isFollowUp || (isMetaSearch && !hasTopic)) {
      const recentRequest = this.#findRecentResearchRequest(groupContext);
      if (recentRequest) {
        this.#searchIntents.set(sessionKey, {
          query: recentRequest,
          expiresAt: now + 30 * 60 * 1000,
        });
        return recentRequest;
      }
    }

    if (!this.search?.shouldSearch(text)) return '';

    this.#searchIntents.set(sessionKey, {
      query: text,
      expiresAt: now + 30 * 60 * 1000,
    });
    return text;
  }

  #hasResearchTopic(text) {
    return /具身|机器人|大模型|模型|视觉|工业|部署|框架|VLA|RT-2|算法|芯片|传感器|AI/i.test(
      String(text ?? ''),
    );
  }

  #findRecentResearchRequest(groupContext) {
    const lines = String(groupContext ?? '').split('\n').reverse();
    for (const line of lines) {
      if (!line || line.startsWith('[') || line.includes('(bot)')) continue;
      const body = line.replace(/^[^:]+:\s*/u, '').trim();
      if (
        body.length >= 6 &&
        this.#hasResearchTopic(body) &&
        this.search?.shouldSearch(body)
      ) {
        return body;
      }
    }
    return '';
  }

  async #generate(message, sessionKey) {
    const startedAt = this.now();
    const original = String(message.text ?? '')
      .replace(/^(?:\s*<@!?[^>]+>)+/u, '')
      .trim();
    const text = truncateText(original, MAX_INPUT_CHARS);

    if (!text) {
      return { text: `在的，有什么可以帮你？发送 /help 可以查看用法。`, command: 'empty' };
    }

    if (text.startsWith('/')) {
      const command = text.split(/\s+/, 1)[0].toLowerCase();
      if (command === '/help' || command === '/帮助') {
        return { text: helpText(this.config.botName), command: 'help' };
      }
      if (command === '/reset' || command === '/重置' || command === '/清空') {
        const cleared = this.memory.clear(sessionKey);
        return {
          text: cleared
            ? '已清空我们之间的对话记忆。群聊旁听记录还会按时间自动过期。'
            : '本来就没有对话记忆，直接问我吧。',
          command: 'reset',
        };
      }
      if (command === '/ping') {
        return {
          text: `pong 🏓 (${Math.max(0, this.now() - startedAt)}ms)`,
          command: 'ping',
        };
      }
      if (command === '/id' || command === '/whoami') {
        return {
          text: [
            `平台：${message.platform}`,
            `群 ID：${message.groupId}`,
            `用户 ID：${message.userId}`,
            `昵称：${message.userName || '未知'}`,
          ].join('\n'),
          command: 'id',
        };
      }
      return {
        text: `未知命令：${command}\n\n${helpText(this.config.botName)}`,
        command: 'unknown',
      };
    }

    if (!this.llm?.enabled) {
      return {
        text: [
          `收到：「${truncateText(text, 300)}」`,
          '',
          '当前是演示模式：还没有配置 LLM_API_KEY，所以我只会复读。',
          '在 .env 里填入大模型 API Key 并重启，就能正常聊天了。',
        ].join('\n'),
        command: 'demo',
      };
    }

    const groupContext = String(message.groupContext ?? '').trim();
    let searchResults = '';
    const searchQuery = this.#resolveSearchQuery(text, sessionKey, groupContext);
    if (searchQuery) {
      const results = await this.search.search(searchQuery);
      searchResults = results.length
        ? this.search.formatForPrompt(results)
        : '[联网搜索没有返回可用结果]';
    }

    let weatherData = '';
    if (this.weather?.shouldFetch(text)) {
      weatherData = (await this.weather.get()) || '[天气数据暂时获取失败]';
    }

    const relationship = this.#relationshipFor(message.userId);
    let answer;
    try {
      answer = await this.llm.chat({
        history: this.memory.get(sessionKey),
        userText: text,
        context: groupContext,
        searchResults,
        weather: weatherData,
        relationship,
      });
    } catch (error) {
      this.logger?.error('LLM 调用失败', {
        platform: message.platform,
        groupId: message.groupId,
        userId: message.userId,
        error,
      });
      return {
        text: '抱歉，我刚才调用 AI 失败了，请稍后再试。',
        command: 'llm-error',
        error,
      };
    }

    answer = String(answer ?? '')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!answer) {
      return { text: '我想了想，但这次没想出来该说什么，换个问法试试？', command: 'empty-llm' };
    }

    const promisedResearch =
      /我(?:先|去|再)?(?:查|搜|找).{0,12}(?:一下|资料|稍后|之后)|稍后(?:告诉|回复|发)|等我(?:查|搜|找)/.test(
        answer,
      );
    if (promisedResearch && searchResults === '[联网搜索没有返回可用结果]') {
      answer = '我这边没搜到可用资料，不能保证稍后继续查。你给个更具体的关键词或链接，我现在就帮你看。';
    }

    const maxTotal = this.config.replyMaxChars * this.config.replyMaxParts;
    answer = truncateText(answer, maxTotal);
    this.memory.append(sessionKey, text, answer);

    this.logger?.info('chat reply', {
      platform: message.platform,
      groupId: message.groupId,
      userId: message.userId,
      ms: Math.max(0, this.now() - startedAt),
      chars: Array.from(answer).length,
      contextChars: Array.from(groupContext).length,
    });

    return { text: answer, command: 'chat' };
  }
}
