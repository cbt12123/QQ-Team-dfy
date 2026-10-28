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
    '/memory 查看在当前场景可使用的长期记忆',
    '/forget 关键词  删除相关长期记忆；/forget all 删除全部长期记忆',
    '/ping  检查我是否在线',
    '/id    查看当前群和用户 ID（配置白名单时有用）',
  ].join('\n');
}

export class ChatEngine {
  #queues = new Map();
  #searchIntents = new Map();

  constructor(
    config,
    { logger, llm, memory, personalMemory, search, weather, vision, imageGenerator, food, now = () => Date.now() } = {},
  ) {
    this.config = config;
    this.logger = logger;
    this.llm = llm;
    this.personalMemory = personalMemory;
    this.search = search;
    this.weather = weather;
    this.vision = vision;
    this.imageGenerator = imageGenerator;
    this.food = food;
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
  async proactiveReply({ context = '', triggerText = '', userId = '', groupId = '', followUp = false, images: imageUrls = [] } = {}) {
    if (!this.llm?.enabled) return null;
    const images = imageUrls.length && this.vision?.enabled ? await this.vision.prepare(imageUrls) : [];
    if (imageUrls.length && !images.length) return null;
    const food = !images.length && await this.food?.handle({ text: triggerText, sessionKey: `napcat:${groupId}:${userId}` });
    if (food?.text) return food.text;
    const relationship = this.#relationshipFor(userId);
    const personalMemory = await this.personalMemory?.recall({ platform: 'napcat', groupId, userId,
      text: triggerText }, { proactive: true });
    const weatherData = this.weather?.shouldFetch(triggerText)
      ? (await this.weather.get()) || '[天气数据暂时获取失败]'
      : '';

    const prompt = [
      '群里正在聊天，没有人 @ 你。你是普通群成员，可以参与，也可以保持沉默。',
      followUp
        ? '你刚回复过当前发言者。判断这句话是否在接你的话；如果是，自然继续回答，不需要再次 @。如果他转向别人或已经结束话题，输出 <SKIP>。'
        : '先判断讨论对象和话题。只有你能自然接话、有内容可说时才参与，不要替别人回答，也不要为了活跃而硬插话。',
      '下面是最近一段群聊，不是只有最后一句话。先理解大家在聊什么，再自然接一句。',
      '如果最后一句只是“是的”“哈哈”“确实”这种附和，要接回上面的主题，不要只对这几个字作答。',
      '规则：',
      '- 想接：只输出 1 句中文，口语化，不 @ 任何人，不长篇，不装懂；可以好奇、追问、吐槽或附和。',
      '- 不适合参与、只是别人之间的对话、没有新内容或话题已结束时，输出 <SKIP>。',
      `当前群里最后一句是：${triggerText}`,
    ].join('\n');

    let answer;
    try {
      answer = await this.llm.chat({
        history: this.memory.get(`napcat:${groupId}:${userId}`),
        userText: prompt,
        context,
        relationship,
        weather: weatherData,
        personalMemory,
        images,
        model: images.length ? this.config.vision?.model : undefined,
      });
    } catch (error) {
      this.logger?.warn('主动接话判断失败', { error });
      return null;
    }

    let text = normalizeProactiveText(answer);
    if (!text) return null;

    text = text
      .replace(/^(?:@\S+\s*)+/u, '')
      .replace(/^(?:[-*]\s*)/, '')
      .trim();
    if (Array.from(text).length < 2) return null;

    return truncateText(text, this.config.proactive?.maxChars ?? 160);
  }

  #familyRoster(excludeId) {
    const family = this.config.family ?? {};
    const lines = [];
    const fatherId = String(family.fatherQq ?? '');

    if (fatherId && String(excludeId) !== fatherId) {
      lines.push(
        `爸爸：在${family.fatherCity || '西安'}做${family.fatherJob || '程序员'}`,
      );
    }

    for (const [qq, relation] of Object.entries(family.relations ?? {})) {
      if (String(qq) === String(excludeId) || String(qq) === fatherId) continue;
      const name = typeof relation === 'string' ? relation : relation.name;
      const details = [];
      if (typeof relation === 'object') {
        if (relation.city) details.push(`在${relation.city}`);
        if (relation.job) details.push(relation.job);
        if (relation.note) details.push(relation.note);
      }
      lines.push(`${name}：${details.length ? details.join('，') : '已记录的亲友'}`);
    }
    return lines;
  }

  #relationshipFor(userId) {
    const family = this.config.family ?? {};
    const isFather = Boolean(
      family.fatherQq && String(userId) === String(family.fatherQq),
    );
    if (isFather) {
      const roster = this.#familyRoster(userId);
      return [
        '当前和你说话的是你爸爸。你是他的女儿，要叫他“爸爸”。',
        `他住在${family.fatherCity || '西安'}，职业是${family.fatherJob || '程序员'}。这是你记得的家庭设定。`,
        ...(roster.length
          ? ['你记得的其他家人和亲友：', ...roster.map((line) => `- ${line}`)]
          : []),
        '爸爸问起亲友时可以直接回答；但不要向其他群友透露这些隐私。',
      ].join('\n');
    }

    const relation = family.relations?.[String(userId)];
    if (relation) {
      const name = typeof relation === 'string' ? relation : relation.name;
      const pronoun = /妈|姨|姐|妹|女|娘|婶|姑|奶/.test(name) ? '她' : '他';
      const details = [];
      if (typeof relation === 'object') {
        if (relation.city) details.push(`${pronoun}在${relation.city}`);
        if (relation.job) details.push(`${pronoun}的职业是${relation.job}`);
      }
      if (typeof relation === 'object' && relation.note) {
        details.push(`备注：${relation.note}`);
      }
      const roster = this.#familyRoster(userId);
      return [
        `当前和你说话的是你的${name}。称呼${pronoun}“${name}”。`,
        ...(details.length ? [`${details.join('，')}。这是你记得的亲友设定。`] : []),
        ...(roster.length
          ? ['你记得的其他家人和亲友：', ...roster.map((line) => `- ${line}`)]
          : []),
        '按长辈或亲友的语气自然相处，不要叫爸爸，也不要编造其他关系。',
      ].join('\n');
    }

    return '当前用户不是爸爸，也不是已记录的亲友。不要叫他爸爸，不要编造亲属关系；正常称呼群友即可。';
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
      if (command === '/memory' || command === '/记忆') {
        if (!this.personalMemory?.enabled) return { text: '长期记忆功能当前没有开启。', command: 'memory' };
        const items = await this.personalMemory.list(message);
        return { text: items.length ? ['在当前场景能使用的你的长期记忆：',
          ...items.map(i => `· ${i.key}：${i.text}（${i.visibility === 'shared' ? '可跨场景' : i.visibility === 'private' ? '仅本人私聊' : '原群及本人私聊'}${i.status === 'resolved' ? '，已结束' : ''}）`),
          '私聊可查看你的完整记忆。/forget 关键词 可删除，/forget all 删除你的全部长期记忆。'].join('\n')
          : '暂时没有整理出可在这里使用的长期记忆。', command: 'memory', forceText: true };
      }
      if (command === '/forget' || command === '/忘记') {
        const query = text.slice(text.indexOf(' ') + 1).trim();
        if (!query || query === text) return { text: '用 /forget 关键词 删除相关长期记忆，或 /forget all 删除你的全部长期记忆。', command: 'forget' };
        const count = this.personalMemory?.forget(message, /^(all|全部)$/i.test(query) ? '' : query) || 0;
        return { text: `已删除 ${count} 条你的长期记忆。当前聊天原文可用 /reset 清空。`, command: 'forget', forceText: true };
      }
      if (command === '/reset' || command === '/重置' || command === '/清空') {
        const cleared = this.memory.clear(sessionKey);
        this.food?.clear(sessionKey);
        return {
          text: cleared
            ? '已清空当前聊天的短期对话。长期记忆可用 /forget all 删除；群聊旁听记录按时间过期。'
            : '当前聊天没有短期对话记录。长期记忆可用 /forget all 删除。',
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

    const foodImage = Boolean(message.images?.length && this.food &&
      (this.food.shouldHandle(text, sessionKey) || this.food.isDeliverySession(sessionKey)));
    const food = foodImage ? null : await this.food?.handle({ text, sessionKey });
    if (food?.text) {
      this.memory.append(sessionKey, text, food.text);
      return { text: food.text, command: 'food', forceText: true };
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

    const generatedImageUrl = this.imageGenerator?.generate(text);
    if (generatedImageUrl) {
      this.logger?.info('生成图片', { chars: Array.from(text).length });
      return {
        text: '画好了，看看这个～',
        imageUrl: generatedImageUrl,
        command: 'image',
      };
    }

    let images = [];
    if (this.vision?.enabled && Array.isArray(message.images) && message.images.length) {
      images = await this.vision.prepare(message.images);
    }
    if (foodImage && !images.length) {
      return { text: '这张商家列表图没读成功，重发一张清晰截图，或把店名和价格发给我，我再帮你挑。',
        command: 'food-image-error', forceText: true };
    }
    if (message.images?.length && !images.length) {
      return { text: this.vision?.enabled
        ? '收到图片了，但图片下载失败，暂时没法看清。请重发图片再试一下。'
        : '收到图片了，但看图功能还没有开启。', command: 'image-error', forceText: true };
    }

    const groupContext = String(message.groupContext ?? '').trim();
    let searchResults = '';
    const searchQuery = foodImage ? '' : this.#resolveSearchQuery(text, sessionKey, groupContext);
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
    const personalMemory = await this.personalMemory?.recall(message);
    let answer;
    try {
      answer = await this.llm.chat({
        history: this.memory.get(sessionKey),
        userText: foodImage ? `${text}\n\n请帮用户挑截图里的餐饮商家，只依据截图清晰可见的信息，最多3家，每家“店名＋可见价格＋简短理由”。看不清的价格就说没看清，不猜门店、菜品、评分或口味。说“截图里”以说明信息来源，不能据此保证实时配送、优惠或营业。不要输出链接和长地址，也不要改推地图上的附近餐厅。` : text,
        context: groupContext,
        searchResults,
        weather: weatherData,
        relationship,
        personalMemory,
        images,
        voice: Boolean(message.voiceExpected),
        model: images.length ? this.config.vision?.model : undefined,
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
    if (foodImage) answer = answer
      .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, '$1')
      .replace(/https?:\/\/\S+/gi, '').trim();
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
    this.personalMemory?.noteDiscussed(message, answer);

    this.logger?.info('chat reply', {
      platform: message.platform,
      groupId: message.groupId,
      userId: message.userId,
      ms: Math.max(0, this.now() - startedAt),
      chars: Array.from(answer).length,
      contextChars: Array.from(groupContext).length,
    });

    return { text: answer, command: 'chat', ...(foodImage ? { forceText: true } : {}) };
  }
}
