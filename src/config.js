import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const ADAPTERS = new Set(['auto', 'official', 'napcat']);

/**
 * Minimal .env loader so the bot also works on older Node versions and does
 * not need a dotenv dependency. Existing process.env values win.
 */
export function loadEnvFile(filePath = resolve(ROOT_DIR, '.env'), env = process.env) {
  if (!existsSync(filePath)) return false;

  let text = readFileSync(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();

    const equals = line.indexOf('=');
    if (equals <= 0) continue;

    const key = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) env[key] = value;
  }
  return true;
}

function text(env, key, fallback = '') {
  const value = env[key];
  return value === undefined || value === null ? fallback : String(value).trim();
}

function integer(env, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = text(env, key);
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`配置项 ${key} 必须是数字，当前值为：${raw}`);
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function numberValue(env, key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = text(env, key);
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`配置项 ${key} 必须是数字，当前值为：${raw}`);
  }
  return Math.min(max, Math.max(min, value));
}

function boolean(env, key, fallback = false) {
  const raw = text(env, key).toLowerCase();
  if (raw === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'y'].includes(raw);
}

export function parseIdSet(raw) {
  return new Set(
    String(raw ?? '')
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function parseRelations(raw) {
  const relations = {};
  for (const item of String(raw ?? '').split(/[,，;\n]+/)) {
    const match = /^\s*(\d{5,})\s*[:：=]\s*(.+?)\s*$/.exec(item);
    if (!match) continue;
    const name = match[2].trim();
    if (name) relations[match[1]] = name;
  }
  return relations;
}

function assertHttpUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`配置项 ${name} 不是合法的 URL：${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`配置项 ${name} 必须以 http:// 或 https:// 开头：${value}`);
  }
  return value.replace(/\/+$/, '');
}

function assertWsUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`配置项 ${name} 不是合法的 WebSocket URL：${value}`);
  }
  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw new Error(`配置项 ${name} 必须以 ws:// 或 wss:// 开头：${value}`);
  }
  return value;
}

export function loadConfig({ argv = [], env = process.env } = {}) {
  const cliAdapter = argv.find((arg) => !arg.startsWith('-'));
  let adapter = (cliAdapter || text(env, 'ADAPTER', 'auto')).toLowerCase();

  if (!ADAPTERS.has(adapter)) {
    throw new Error(`未知的接入方式 ADAPTER=${adapter}，可选：auto、official、napcat`);
  }

  const appId = text(env, 'QQ_APP_ID');
  const appSecret = text(env, 'QQ_APP_SECRET');
  const napcatWsUrl = text(env, 'NAPCAT_WS_URL');

  if (adapter === 'auto') {
    if (appId && appSecret) adapter = 'official';
    else if (napcatWsUrl) adapter = 'napcat';
    else {
      throw new Error(
        '没有找到可用的 QQ 接入配置。请在 .env 中填写 QQ_APP_ID/QQ_APP_SECRET（官方机器人），' +
          '或设置 NAPCAT_WS_URL（NapCat）。可先执行 npm run demo 查看本地演示。',
      );
    }
  }

  const logLevel = text(env, 'LOG_LEVEL', 'info').toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error(`LOG_LEVEL 必须是 debug/info/warn/error 之一，当前为：${logLevel}`);
  }

  const botName = text(env, 'BOT_NAME', '群助手') || '群助手';
  const dataDirRaw = text(env, 'DATA_DIR', 'data') || 'data';
  const dataDir = resolve(ROOT_DIR, dataDirRaw);
  const systemPrompt = text(
    env,
    'LLM_SYSTEM_PROMPT',
    '你是 QQ 群里的 AI 助手，名字叫{botName}。回答要简洁、友好、口语化，默认使用中文。' +
      '不要编造不知道的事实。群聊里不要长篇大论，除非用户明确要求详细说明。',
  ).replaceAll('{botName}', botName);

  const apiBase = assertHttpUrl(text(env, 'QQ_API_BASE', 'https://api.bot.qq.com'), 'QQ_API_BASE');
  const tokenUrl = assertHttpUrl(
    text(env, 'QQ_TOKEN_URL') || `${apiBase}/app/getAppAccessToken`,
    'QQ_TOKEN_URL',
  );

  const official = {
    appId,
    appSecret,
    apiBase,
    tokenUrl,
    intents: integer(env, 'QQ_INTENTS', 1 << 25, { min: 0 }),
    allowedGroups: parseIdSet(text(env, 'QQ_ALLOWED_GROUPS')),
  };

  if (adapter === 'official') {
    if (!appId || !appSecret) {
      throw new Error('官方接入需要同时填写 QQ_APP_ID 和 QQ_APP_SECRET。');
    }
  }

  const napcat = {
    wsUrl: assertWsUrl(
      text(env, 'NAPCAT_WS_URL', adapter === 'napcat' ? 'ws://127.0.0.1:3001' : 'ws://127.0.0.1:3001'),
      'NAPCAT_WS_URL',
    ),
    accessToken: text(env, 'NAPCAT_ACCESS_TOKEN'),
    allowedGroups: parseIdSet(text(env, 'NAPCAT_ALLOWED_GROUPS')),
    privateAllowedUsers: parseIdSet(text(env, 'NAPCAT_PRIVATE_ALLOWED_USERS')),
  };

  const llm = {
    baseUrl: assertHttpUrl(text(env, 'LLM_BASE_URL', 'https://api.deepseek.com/v1'), 'LLM_BASE_URL'),
    apiKey: text(env, 'LLM_API_KEY'),
    model: text(env, 'LLM_MODEL', 'deepseek-chat') || 'deepseek-chat',
    temperature: numberValue(env, 'LLM_TEMPERATURE', 0.8, { min: 0, max: 2 }),
    maxTokens: integer(env, 'LLM_MAX_TOKENS', 800, { min: 1, max: 16000 }),
    timeoutMs: integer(env, 'LLM_TIMEOUT_MS', 60_000, { min: 1_000, max: 300_000 }),
    systemPrompt,
  };

  return {
    adapter,
    logLevel,
    botName,
    dryRun: boolean(env, 'BOT_DRY_RUN'),
    replyEnabled: boolean(env, 'REPLY_ENABLED', true),
    forwardEnabled: boolean(env, 'FORWARD_ENABLED', true),
    replyMaxChars: integer(env, 'REPLY_MAX_CHARS', 1200, { min: 100, max: 4500 }),
    replyMaxParts: integer(env, 'REPLY_MAX_PARTS', 4, { min: 1, max: 5 }),
    maxHistoryTurns: integer(env, 'MAX_HISTORY_TURNS', 8, { min: 0, max: 50 }),
    historyTtlMs: integer(env, 'HISTORY_TTL_MINUTES', 120, { min: 1, max: 10080 }) * 60_000,
    dataDir,
    groupContext: {
      maxMessages: integer(env, 'GROUP_CONTEXT_MAX_MESSAGES', 80, { min: 5, max: 500 }),
      maxChars: integer(env, 'GROUP_CONTEXT_MAX_CHARS', 12_000, { min: 500, max: 30_000 }),
      maxMessageChars: integer(env, 'GROUP_CONTEXT_MESSAGE_CHARS', 500, { min: 50, max: 2000 }),
      renderMessages: integer(env, 'GROUP_CONTEXT_RENDER_MESSAGES', 50, { min: 5, max: 100 }),
      ttlMs: integer(env, 'GROUP_CONTEXT_TTL_MINUTES', 360, { min: 1, max: 10080 }) * 60_000,
    },
    search: {
      enabled: boolean(env, 'SEARCH_ENABLED', true),
      maxResults: integer(env, 'SEARCH_MAX_RESULTS', 5, { min: 1, max: 10 }),
      timeoutMs: integer(env, 'SEARCH_TIMEOUT_MS', 15_000, { min: 1_000, max: 60_000 }),
    },
    proactive: {
      enabled: boolean(env, 'PROACTIVE_ENABLED', false),
      groups: parseIdSet(text(env, 'PROACTIVE_GROUPS')),
      cooldownMs: integer(env, 'PROACTIVE_COOLDOWN_SEC', 120, { min: 30, max: 3600 }) * 1000,
      maxPerHour: integer(env, 'PROACTIVE_MAX_PER_HOUR', 10, { min: 1, max: 60 }),
      chance: numberValue(env, 'PROACTIVE_CHANCE', 0.35, { min: 0, max: 1 }),
      debounceMs: integer(env, 'PROACTIVE_DEBOUNCE_MS', 4000, { min: 0, max: 30_000 }),
      minChars: integer(env, 'PROACTIVE_MIN_CHARS', 4, { min: 1, max: 100 }),
      maxChars: integer(env, 'PROACTIVE_MAX_CHARS', 160, { min: 20, max: 500 }),
      quietHours: text(env, 'PROACTIVE_QUIET_HOURS', '1-7'),
      retryOnSkip: boolean(env, 'PROACTIVE_RETRY_ON_SKIP', true),
    },
    family: {
      fatherQq: text(env, 'FAMILY_FATHER_QQ'),
      fatherCity: text(env, 'FAMILY_FATHER_CITY', '西安') || '西安',
      fatherJob: text(env, 'FAMILY_FATHER_JOB', '程序员') || '程序员',
      relations: parseRelations(text(env, 'FAMILY_RELATIONS')),
    },
    weather: {
      enabled: boolean(env, 'WEATHER_ENABLED', true),
      city: text(env, 'WEATHER_CITY', '西安') || '西安',
      latitude: numberValue(env, 'WEATHER_LATITUDE', 34.3416, { min: -90, max: 90 }),
      longitude: numberValue(env, 'WEATHER_LONGITUDE', 108.9398, { min: -180, max: 180 }),
      timezone: text(env, 'WEATHER_TIMEZONE', 'Asia/Shanghai') || 'Asia/Shanghai',
      timeoutMs: integer(env, 'WEATHER_TIMEOUT_MS', 10_000, { min: 1_000, max: 60_000 }),
    },
    vision: {
      enabled: boolean(env, 'VISION_ENABLED', true),
      model: text(env, 'VISION_MODEL', 'deepseek-flash') || 'deepseek-flash',
      maxImages: integer(env, 'VISION_MAX_IMAGES', 3, { min: 1, max: 8 }),
      timeoutMs: integer(env, 'VISION_TIMEOUT_MS', 20_000, { min: 1_000, max: 60_000 }),
      maxBytes: integer(env, 'VISION_MAX_BYTES', 10 * 1024 * 1024, {
        min: 100 * 1024,
        max: 48 * 1024 * 1024,
      }),
    },
    breeze: {
      enabled: boolean(env, 'BREEZE_ENABLED', true),
      url: assertHttpUrl(text(env, 'BREEZE_URL', 'http://127.0.0.1:7860'), 'BREEZE_URL'),
      instruction:
        text(
          env,
          'BREEZE_INSTRUCTION',
          '一位可爱、活泼、声音清甜的少女，说话自然亲切，带一点调皮，像在跟爸爸聊天。',
        ) || '一位可爱、活泼、声音清甜的少女，说话自然亲切，带一点调皮，像在跟爸爸聊天。',
      cfgScale: numberValue(env, 'BREEZE_CFG_SCALE', 4, { min: 1, max: 8 }),
      seed: integer(env, 'BREEZE_SEED', 42, { min: 0, max: 2_147_483_647 }),
      timeoutMs: integer(env, 'BREEZE_TIMEOUT_MS', 120_000, { min: 10_000, max: 300_000 }),
    },
    singing: {
      enabled: boolean(env, 'SVS_ENABLED', false),
      url: assertHttpUrl(text(env, 'SVS_URL', 'http://127.0.0.1:8765'), 'SVS_URL'),
      timeoutMs: integer(env, 'SVS_TIMEOUT_MS', 30_000, { min: 5_000, max: 180_000 }),
      steps: integer(env, 'SVS_STEPS', 20, { min: 4, max: 80 }),
    },
    voice: {
      enabled: boolean(env, 'VOICE_ENABLED', true),
      always: boolean(env, 'VOICE_ALWAYS', false),
      singing: boolean(env, 'VOICE_SINGING', true),
      bin: text(env, 'VOICE_EDGE_BIN', 'edge-tts') || 'edge-tts',
      voice: text(env, 'VOICE_NAME', 'zh-CN-XiaoyiNeural') || 'zh-CN-XiaoyiNeural',
      rate: text(env, 'VOICE_RATE', '+8%') || '+8%',
      pitch: text(env, 'VOICE_PITCH', '+6Hz') || '+6Hz',
      volume: text(env, 'VOICE_VOLUME', '+0%') || '+0%',
      maxChars: integer(env, 'VOICE_MAX_CHARS', 300, { min: 10, max: 1000 }),
      timeoutMs: integer(env, 'VOICE_TIMEOUT_MS', 30_000, { min: 1_000, max: 120_000 }),
      dir: resolve(dataDir, 'voice'),
    },
    imageGen: {
      enabled: boolean(env, 'IMAGE_GEN_ENABLED', true),
      baseUrl: assertHttpUrl(
        text(env, 'IMAGE_GEN_BASE_URL', 'https://image.pollinations.ai/prompt'),
        'IMAGE_GEN_BASE_URL',
      ),
      width: integer(env, 'IMAGE_GEN_WIDTH', 1024, { min: 256, max: 2048 }),
      height: integer(env, 'IMAGE_GEN_HEIGHT', 1024, { min: 256, max: 2048 }),
      model: text(env, 'IMAGE_GEN_MODEL'),
    },
    official,
    napcat,
    llm,
  };
}
