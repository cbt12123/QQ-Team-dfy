import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { ConversationStore } from './chat/memory.js';
import { GroupContextStore } from './chat/group-context.js';
import { LlmClient } from './chat/llm.js';
import { ChatEngine } from './chat/engine.js';
import { ProactivePolicy } from './chat/proactive.js';
import { WebSearch } from './search/web-search.js';
import { WeatherService } from './weather/weather.js';
import { OfficialApi } from './adapters/official-api.js';
import { OfficialAdapter } from './adapters/official.js';
import { NapCatAdapter } from './adapters/napcat.js';

export function createRuntime(config, { logger = createLogger(config.logLevel) } = {}) {
  const dataDir = config.dataDir ?? join(process.cwd(), 'data');
  mkdirSync(dataDir, { recursive: true });

  const memory = new ConversationStore({
    maxTurns: config.maxHistoryTurns,
    ttlMs: config.historyTtlMs,
    filePath: join(dataDir, 'conversations.json'),
  });
  const groupContext = new GroupContextStore({
    ...config.groupContext,
    filePath: join(dataDir, 'group-context.json'),
  });
  const llm = new LlmClient(config.llm, { logger });
  const search = new WebSearch({ ...config.search, logger });
  const weather = new WeatherService({ ...config.weather, logger });
  const engine = new ChatEngine(config, { logger, llm, memory, search, weather });
  let adapter;
  let proactive = null;

  const onGroupMessage = (event) => {
    try {
      groupContext.record(event);
    } catch (error) {
      logger.warn('记录群聊上下文失败', { groupId: event.groupId, error });
      return;
    }

    if (event.mentioned) proactive?.cancel(event.groupId);
    else proactive?.consider(event);
  };

  const onMessage = async (message) => {
    proactive?.cancel(message.groupId);
    if (!config.replyEnabled) {
      logger?.debug('回复功能已关闭，忽略 @ 消息', {
        groupId: message.groupId,
        userId: message.userId,
      });
      return;
    }
    message.groupContext = groupContext.render(message.platform, message.groupId, {
      excludeMessageId: message.messageId,
      limit: config.groupContext.renderMessages,
    });

    let answer;
    try {
      answer = await engine.reply(message);
    } catch (error) {
      logger.error('生成回复失败', {
        platform: message.platform,
        groupId: message.groupId,
        userId: message.userId,
        error,
      });
      answer = { text: '抱歉，我这边出了点问题，请稍后再试。' };
    }

    if (!answer?.text) return;
    try {
      await message.reply(answer.text);
      groupContext.record({
        platform: message.platform,
        groupId: message.groupId,
        userId: 'bot',
        userName: config.botName,
        text: answer.text,
        messageId: `bot:${message.messageId || Date.now()}:${Date.now()}`,
        timestamp: Date.now(),
        isBot: true,
      });
    } catch (error) {
      logger.error('发送 QQ 消息失败', {
        platform: message.platform,
        groupId: message.groupId,
        userId: message.userId,
        error,
      });
    }
  };

  if (config.adapter === 'official') {
    const api = new OfficialApi({
      ...config.official,
      logger,
    });
    adapter = new OfficialAdapter({
      api,
      onMessage,
      logger,
      dryRun: config.dryRun,
      replyMaxChars: config.replyMaxChars,
      replyMaxParts: config.replyMaxParts,
      allowedGroups: config.official.allowedGroups,
    });
  } else {
    adapter = new NapCatAdapter({
      ...config.napcat,
      onMessage,
      onGroupMessage,
      logger,
      dryRun: config.dryRun,
      replyMaxChars: config.replyMaxChars,
      replyMaxParts: config.replyMaxParts,
      forwardEnabled: config.forwardEnabled,
      allowedGroups: config.napcat.allowedGroups,
    });
  }

  if (config.adapter === 'napcat') {
    proactive = new ProactivePolicy({
      config: config.proactive,
      engine,
      logger,
      getContext: (groupId) =>
        groupContext.render('napcat', groupId, {
          limit: config.groupContext.renderMessages,
        }),
      send: async ({ groupId, text }) => {
        await adapter.sendGroupText(groupId, text);
      },
      onBotMessage: ({ groupId, text }) => {
        groupContext.record({
          platform: 'napcat',
          groupId,
          userId: 'bot',
          userName: config.botName,
          text,
          messageId: `proactive:${Date.now()}`,
          timestamp: Date.now(),
          isBot: true,
        });
      },
    });
  }

  return {
    config,
    logger,
    memory,
    groupContext,
    llm,
    search,
    weather,
    engine,
    adapter,
    proactive,
    async start() {
      await adapter.start();
    },
    async stop() {
      proactive?.close();
      await adapter.stop();
      memory.close();
      groupContext.close();
    },
  };
}

function installSignalHandlers(runtime, logger) {
  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info('收到退出信号，正在停止机器人', { signal });
    try {
      await runtime.stop();
    } catch (error) {
      logger.error('停止机器人失败', { error });
    }
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const config = loadConfig({ argv, env });
  const logger = createLogger(config.logLevel);
  const runtime = createRuntime(config, { logger });
  installSignalHandlers(runtime, logger);

  logger.info('机器人启动', {
    adapter: config.adapter,
    botName: config.botName,
    llm: runtime.llm.enabled ? config.llm.model : '演示模式（未配置 LLM_API_KEY）',
    dryRun: config.dryRun,
  });

  try {
    await runtime.start();
  } catch (error) {
    logger.error('启动失败', { error });
    process.exitCode = 1;
    return runtime;
  }

  return runtime;
}
