import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONAS, findPersona } from '../src/personas.js';

const ADMIN_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT_DIR = resolve(ADMIN_DIR, '..');
const ENV_PATH = process.env.ADMIN_ENV_PATH ?? join(ROOT_DIR, '.env');
const HOST = process.env.ADMIN_HOST ?? '127.0.0.1';
const PORT = Number(process.env.ADMIN_PORT ?? 8787);

const FIELD_MAP = {
  botName: 'BOT_NAME',
  model: 'LLM_MODEL',
  temperature: 'LLM_TEMPERATURE',
  maxTokens: 'LLM_MAX_TOKENS',
  timeoutMs: 'LLM_TIMEOUT_MS',
  replyEnabled: 'REPLY_ENABLED',
  searchEnabled: 'SEARCH_ENABLED',
  proactiveEnabled: 'PROACTIVE_ENABLED',
  forwardEnabled: 'FORWARD_ENABLED',
  weatherEnabled: 'WEATHER_ENABLED',
  visionEnabled: 'VISION_ENABLED',
  visionModel: 'VISION_MODEL',
  imageGenEnabled: 'IMAGE_GEN_ENABLED',
  imageGenWidth: 'IMAGE_GEN_WIDTH',
  imageGenHeight: 'IMAGE_GEN_HEIGHT',
  breezeEnabled: 'BREEZE_ENABLED',
  breezeUrl: 'BREEZE_URL',
  breezeInstruction: 'BREEZE_INSTRUCTION',
  breezeCfgScale: 'BREEZE_CFG_SCALE',
  breezeSeed: 'BREEZE_SEED',
  svsEnabled: 'SVS_ENABLED',
  svsUrl: 'SVS_URL',
  svsSteps: 'SVS_STEPS',
  voiceEnabled: 'VOICE_ENABLED',
  voiceAlways: 'VOICE_ALWAYS',
  voiceSinging: 'VOICE_SINGING',
  voiceName: 'VOICE_NAME',
  voiceRate: 'VOICE_RATE',
  voicePitch: 'VOICE_PITCH',
  voiceMaxChars: 'VOICE_MAX_CHARS',
  replyMaxChars: 'REPLY_MAX_CHARS',
  replyMaxParts: 'REPLY_MAX_PARTS',
  maxHistoryTurns: 'MAX_HISTORY_TURNS',
  historyTtlMinutes: 'HISTORY_TTL_MINUTES',
  groupContextMaxMessages: 'GROUP_CONTEXT_MAX_MESSAGES',
  groupContextMaxChars: 'GROUP_CONTEXT_MAX_CHARS',
  groupContextMessageChars: 'GROUP_CONTEXT_MESSAGE_CHARS',
  groupContextRenderMessages: 'GROUP_CONTEXT_RENDER_MESSAGES',
  groupContextTtlMinutes: 'GROUP_CONTEXT_TTL_MINUTES',
  searchMaxResults: 'SEARCH_MAX_RESULTS',
  searchTimeoutMs: 'SEARCH_TIMEOUT_MS',
  proactiveGroups: 'PROACTIVE_GROUPS',
  napcatAllowedGroups: 'NAPCAT_ALLOWED_GROUPS',
  privateAllowedUsers: 'NAPCAT_PRIVATE_ALLOWED_USERS',
  proactiveCooldownSec: 'PROACTIVE_COOLDOWN_SEC',
  proactiveMaxPerHour: 'PROACTIVE_MAX_PER_HOUR',
  proactiveChance: 'PROACTIVE_CHANCE',
  proactiveDebounceMs: 'PROACTIVE_DEBOUNCE_MS',
  proactiveMinChars: 'PROACTIVE_MIN_CHARS',
  proactiveMaxChars: 'PROACTIVE_MAX_CHARS',
  proactiveRetryOnSkip: 'PROACTIVE_RETRY_ON_SKIP',
  proactiveQuietHours: 'PROACTIVE_QUIET_HOURS',
  systemPrompt: 'LLM_SYSTEM_PROMPT',
  familyFatherQq: 'FAMILY_FATHER_QQ',
  familyFatherCity: 'FAMILY_FATHER_CITY',
  familyFatherJob: 'FAMILY_FATHER_JOB',
  familyRelations: 'FAMILY_RELATIONS',
  weatherCity: 'WEATHER_CITY',
  weatherLatitude: 'WEATHER_LATITUDE',
  weatherLongitude: 'WEATHER_LONGITUDE',
  logLevel: 'LOG_LEVEL',
  dryRun: 'BOT_DRY_RUN',
};

const NUMBER_RULES = {
  temperature: [0, 2],
  maxTokens: [1, 16000],
  timeoutMs: [1000, 300000],
  replyMaxChars: [100, 4500],
  replyMaxParts: [1, 5],
  maxHistoryTurns: [0, 50],
  historyTtlMinutes: [1, 10080],
  groupContextMaxMessages: [5, 500],
  groupContextMaxChars: [500, 30000],
  groupContextMessageChars: [50, 2000],
  groupContextRenderMessages: [5, 100],
  groupContextTtlMinutes: [1, 10080],
  searchMaxResults: [1, 10],
  searchTimeoutMs: [1000, 60000],
  proactiveCooldownSec: [30, 3600],
  proactiveMaxPerHour: [1, 60],
  proactiveChance: [0, 1],
  proactiveDebounceMs: [0, 30000],
  proactiveMinChars: [1, 100],
  proactiveMaxChars: [20, 500],
  weatherLatitude: [-90, 90],
  weatherLongitude: [-180, 180],
  imageGenWidth: [256, 2048],
  imageGenHeight: [256, 2048],
  voiceMaxChars: [10, 1000],
  svsSteps: [4, 80],
  breezeCfgScale: [1, 8],
  breezeSeed: [0, 2147483647],
};

const BOOLEAN_FIELDS = new Set([
  'replyEnabled',
  'searchEnabled',
  'proactiveEnabled',
  'forwardEnabled',
  'weatherEnabled',
  'visionEnabled',
  'imageGenEnabled',
  'breezeEnabled',
  'svsEnabled',
  'voiceEnabled',
  'voiceAlways',
  'voiceSinging',
  'proactiveRetryOnSkip',
  'dryRun',
]);

function readEnvFile() {
  const values = {};
  if (!existsSync(ENV_PATH)) return values;
  const text = readFileSync(ENV_PATH, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function writeEnvValues(updates) {
  const original = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const lines = original ? original.replace(/\r\n/g, '\n').split('\n') : [];
  const pending = new Map(Object.entries(updates));

  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${String(value).replace(/\r?\n/g, ' ')}`;
  });

  for (const [key, value] of pending) {
    next.push(`${key}=${String(value).replace(/\r?\n/g, ' ')}`);
  }

  const directory = resolve(ENV_PATH, '..');
  mkdirSync(directory, { recursive: true });
  const temporary = `${ENV_PATH}.admin.tmp`;
  writeFileSync(temporary, `${next.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
  renameSync(temporary, ENV_PATH);
}

function publicConfig(env) {
  const config = {};
  for (const [field, key] of Object.entries(FIELD_MAP)) {
    const raw = env[key] ?? '';
    if (BOOLEAN_FIELDS.has(field)) config[field] = ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
    else if (field in NUMBER_RULES) config[field] = raw === '' ? null : Number(raw);
    else config[field] = raw;
  }
  config.hasApiKey = Boolean(env.LLM_API_KEY);
  config.hasAccessToken = Boolean(env.NAPCAT_ACCESS_TOKEN);
  config.personaId = findPersonaByPrompt(env.LLM_SYSTEM_PROMPT)?.id ?? 'custom';
  return config;
}

function findPersonaByPrompt(prompt) {
  const normalized = String(prompt ?? '').trim();
  if (!normalized) return null;
  return PERSONAS.find((persona) => persona.systemPrompt.trim() === normalized) ?? null;
}

function validateAndMap(body) {
  if (!body || typeof body !== 'object') throw new Error('请求体必须是 JSON 对象');
  const preset = body.personaId ? findPersona(body.personaId) : null;
  const merged = { ...body };
  if (preset) {
    merged.botName = preset.botName;
    merged.systemPrompt = preset.systemPrompt;
    merged.temperature = preset.temperature;
  }

  const updates = {};
  for (const [field, key] of Object.entries(FIELD_MAP)) {
    if (!(field in merged)) continue;
    let value = merged[field];

    if (BOOLEAN_FIELDS.has(field)) {
      value = value === true || value === 1 || value === '1' || value === 'true';
      updates[key] = value ? '1' : '0';
      continue;
    }

    if (field in NUMBER_RULES) {
      const number = Number(value);
      const [min, max] = NUMBER_RULES[field];
      if (!Number.isFinite(number) || number < min || number > max) {
        throw new Error(`${field} 必须在 ${min} 到 ${max} 之间`);
      }
      updates[key] = String(number);
      continue;
    }

    if (value === null || value === undefined) value = '';
    updates[key] = String(value).trim();
  }

  if (typeof merged.llmApiKey === 'string' && merged.llmApiKey.trim()) {
    updates.LLM_API_KEY = merged.llmApiKey.trim();
  }
  if (typeof merged.systemPrompt === 'string' && merged.systemPrompt.length > 8000) {
    throw new Error('systemPrompt 过长');
  }
  return updates;
}

function systemStatus(service) {
  try {
    const output = execFileSync(
      'systemctl',
      ['show', service, '--property=ActiveState,SubState,MainPID,ActiveEnterTimestamp'],
      { encoding: 'utf8', timeout: 5000 },
    );
    const values = Object.fromEntries(
      output
        .trim()
        .split('\n')
        .map((line) => {
          const equals = line.indexOf('=');
          return [line.slice(0, equals), line.slice(equals + 1)];
        }),
    );
    return {
      active: values.ActiveState === 'active',
      state: values.SubState || values.ActiveState || 'unknown',
      pid: Number(values.MainPID) || null,
      since: values.ActiveEnterTimestamp || '',
    };
  } catch {
    return { active: false, state: 'unavailable', pid: null, since: '' };
  }
}

function restartBot() {
  execFileSync('systemctl', ['restart', 'qqbot'], { timeout: 15000 });
  return systemStatus('qqbot');
}

function maskId(value) {
  const text = String(value ?? '');
  return text.length > 6 ? `${text.slice(0, 3)}****${text.slice(-3)}` : '****';
}

function redactLog(text) {
  return String(text ?? '')
    .replace(/groupId="(\d{5,})"/g, (_, id) => `groupId="${maskId(id)}"`)
    .replace(/userId="(\d{5,})"/g, (_, id) => `userId="${maskId(id)}"`)
    .replace(/group_id=(\d{5,})/g, (_, id) => `group_id=${maskId(id)}`)
    .replace(/user_id=(\d{5,})/g, (_, id) => `user_id=${maskId(id)}`)
    .replace(/userName="([^"]+)"/g, (_, name) => `userName="${String(name).slice(0, 1)}***"`)
    .replace(/sk-[A-Za-z0-9]{10,}/g, 'sk-***')
    .replace(/QQBot\s+[A-Za-z0-9._-]+/g, 'QQBot ***');
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function contentType(filePath) {
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
    }[extname(filePath)] ?? 'application/octet-stream'
  );
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = resolve(ADMIN_DIR, relative);
  if (target !== ADMIN_DIR && !target.startsWith(`${ADMIN_DIR}${sep}`)) {
    json(res, 403, { ok: false, error: 'forbidden' });
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    json(res, 404, { ok: false, error: 'not found' });
    return;
  }
  const body = readFileSync(target);
  res.writeHead(200, {
    'Content-Type': contentType(target),
    'Cache-Control': 'no-cache',
    'Content-Length': body.length,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolvePromise(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = new Set([
    `http://${req.headers.host}`,
    `https://${req.headers.host}`,
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
  ]);
  return allowed.has(origin);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/api/status') {
      const env = readEnvFile();
      return json(res, 200, {
        ok: true,
        bot: systemStatus('qqbot'),
        napcat: systemStatus('napcat'),
        config: publicConfig(env),
        personas: PERSONAS,
        now: new Date().toISOString(),
      });
    }

    if (pathname === '/api/logs') {
      const lines = Math.min(500, Math.max(20, Number(url.searchParams.get('lines') ?? 160)));
      try {
        const output = execFileSync(
          'journalctl',
          ['-u', 'qqbot', '-n', String(lines), '--no-pager', '--output=short-iso'],
          { encoding: 'utf8', timeout: 8000 },
        );
        return json(res, 200, { ok: true, lines: redactLog(output) });
      } catch (error) {
        return json(res, 500, { ok: false, error: `读取日志失败：${error.message}` });
      }
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      return json(res, 200, { ok: true, config: publicConfig(readEnvFile()), personas: PERSONAS });
    }

    if (pathname === '/api/config' && req.method === 'PUT') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, error: '跨域请求被拒绝' });
      const body = await readBody(req);
      const updates = validateAndMap(body);
      writeEnvValues(updates);
      const status = restartBot();
      return json(res, 200, {
        ok: true,
        status,
        config: publicConfig(readEnvFile()),
      });
    }

    if (pathname === '/api/restart' && req.method === 'POST') {
      if (!sameOrigin(req)) return json(res, 403, { ok: false, error: '跨域请求被拒绝' });
      const status = restartBot();
      return json(res, 200, { ok: true, status });
    }

    if (pathname === '/api/presets' && req.method === 'GET') {
      return json(res, 200, { ok: true, personas: PERSONAS });
    }

    if (pathname === '/api/health') {
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, pathname);
    }

    return json(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    console.error('[admin]', error);
    return json(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[admin] http://${HOST}:${PORT}`);
});
