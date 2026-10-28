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
import { FoodService } from './food/food-service.js';
import { ImageService } from './images/image-service.js';
import { ImageGenerator } from './images/image-generator.js';
import { VoiceService } from './voice/voice.js';
import { BreezeVoiceService } from './voice/breeze.js';
import { parseVoiceCommand, shouldUseVoice, VoiceModeStore } from './voice/voice-mode.js';
import { parseCrossVoice } from './voice/cross-send.js';
import { SingingService } from './singing/singing.js';
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
  const food = new FoodService({ ...config.food, llm, logger });
  const vision = new ImageService({ ...config.vision, logger });
  const imageGenerator = new ImageGenerator({ ...config.imageGen, logger });
  const voice = new VoiceService({ ...config.voice, logger });
  const voiceModes = new VoiceModeStore(join(dataDir, 'voice-modes.json'));
  const breeze = new BreezeVoiceService({ ...config.breeze, logger });
  const singing = new SingingService({ ...config.singing, logger });
  const engine = new ChatEngine(config, {
    logger,
    llm,
    memory,
    search,
    weather,
    vision,
    imageGenerator,
    food,
  });
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
    else if (config.replyEnabled) proactive?.consider(event);
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
    const voiceKey = `${message.platform}:${message.groupId}:${message.userId}`;
    const voiceCommand = parseVoiceCommand(message.text);
    if (voiceCommand) {
      if (voiceCommand.mode === 'status') {
        const current = voiceModes.get(voiceKey);
        const label = current === 'on' ? '语音' : current === 'off' ? '文字' : '自动';
        const global = voice.always ? '全局“全部用语音”已开' : '全局“全部用语音”关';
        await message.reply(
          `当前聊天：${label}。${global}。\n/语音 开：默认语音\n/文字：默认文字\n/语音 自动：说“发语音”才回语音`,
        );
      } else {
        voiceModes.set(voiceKey, voiceCommand.mode);
        await message.reply(voiceCommand.reply);
      }
      return;
    }

    if (message.platform === 'napcat-private') {
      const crossVoice = parseCrossVoice(message.text, config.family?.relations);
      if (crossVoice) {
        const isFather = String(message.userId) === String(config.family?.fatherQq ?? '');
        if (!isFather) {
          await message.reply('只有爸爸可以让我给别人发语音。');
          return;
        }
        if (!config.voice.enabled) {
          await message.reply('语音功能现在是关闭的，先在后台打开“语音回复”。');
          return;
        }
        if (!crossVoice.content) {
          await message.reply(`要给${crossVoice.targetName}发什么内容？可以说“给${crossVoice.targetName}发语音，说……”。`);
          return;
        }
        if (typeof message.sendVoiceTo !== 'function') {
          await message.reply('当前接入方式不支持给其他 QQ 发语音。');
          return;
        }

        let audio = await breeze.synthesize(crossVoice.content);
        if (!audio) {
          audio = await voice.synthesize(crossVoice.content);
        }
        if (!audio?.filePath) {
          await message.reply('这条语音生成失败了，稍后再试。');
          return;
        }
        try {
          await message.sendVoiceTo(crossVoice.targetUserId, audio.filePath);
          await message.reply(`已经用语音发给${crossVoice.targetName}了。`);
        } catch (error) {
          logger.error('给亲友发送语音失败', {
            platform: message.platform,
            userId: message.userId,
            error,
          });
          await message.reply(`给${crossVoice.targetName}发语音失败，可能是好友关系或 NapCat 发送限制。`);
        }
        return;
      }
    }

    message.groupContext = groupContext.render(message.platform, message.groupId, {
      excludeMessageId: message.messageId,
      limit: config.groupContext.renderMessages,
    });

    const useVoice = shouldUseVoice({
      mode: voiceModes.get(voiceKey),
      text: message.text,
      voice,
    });
    message.voiceExpected = useVoice;

    if (singing.shouldSing(message.text) && typeof message.replyVoice === 'function') {
      const song = await singing.sing(message.text);
      if (song) {
        try {
          await message.replyVoice(song.filePath, song.attribution);
          groupContext.record({
            platform: message.platform,
            groupId: message.groupId,
            userId: 'bot',
            userName: config.botName,
            text: `[唱歌] ${song.lyrics}`,
            messageId: `bot-sing:${message.messageId || Date.now()}:${Date.now()}`,
            timestamp: Date.now(),
            isBot: true,
          });
          return;
        } catch (error) {
          logger.error('发送唱歌语音失败', {
            platform: message.platform,
            groupId: message.groupId,
            userId: message.userId,
            error,
          });
        }
      }
    }

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

    if (answer.imageUrl) {
      if (typeof message.replyImage !== 'function') {
        answer.text = '图片生成目前只支持 NapCat 接入，当前接入方式发不了图。';
      } else {
        try {
          await message.replyImage(answer.imageUrl, answer.text);
          groupContext.record({
            platform: message.platform,
            groupId: message.groupId,
            userId: 'bot',
            userName: config.botName,
            text: `${answer.text} [图片]`,
            messageId: `bot-image:${message.messageId || Date.now()}:${Date.now()}`,
            timestamp: Date.now(),
            isBot: true,
          });
          return;
        } catch (error) {
          logger.error('发送生成的图片失败', {
            platform: message.platform,
            groupId: message.groupId,
            userId: message.userId,
            error,
          });
          answer.text = `${answer.text}\n（图片发送失败，稍后再试）`;
        }
      }
    }

    if (!answer.imageUrl && useVoice && !answer.forceText) {
      if (typeof message.replyVoice !== 'function') {
        answer.text = `${answer.text}\n（当前接入方式不支持发送语音）`;
      } else {
        let audio = await breeze.synthesize(answer.text);
        if (!audio) {
          audio = await voice.synthesize(answer.text, {
            singing: voice.isSinging(message.text),
          });
        }
        if (audio?.filePath) {
          try {
            await message.replyVoice(audio.filePath);
            groupContext.record({
              platform: message.platform,
              groupId: message.groupId,
              userId: 'bot',
              userName: config.botName,
              text: '[语音]',
              messageId: `bot-voice:${message.messageId || Date.now()}:${Date.now()}`,
              timestamp: Date.now(),
              isBot: true,
            });
            return;
          } catch (error) {
            logger.error('发送语音失败', {
              platform: message.platform,
              groupId: message.groupId,
              userId: message.userId,
              error,
            });
          }
        }
        answer.text = `${answer.text}\n（语音生成失败，先用文字回复）`;
      }
    }

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
      onBotReply: ({ groupId, userId }) => proactive?.noteReply(groupId, userId),
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
      onBotMessage: ({ groupId, userId, triggerText, text }) => {
        memory.append(`napcat:${groupId}:${userId}`, triggerText, text);
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
    food,
    vision,
    imageGenerator,
    voice,
    breeze,
    singing,
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
      food.close();
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
