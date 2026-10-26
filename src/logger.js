const LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function formatMeta(meta) {
  if (!meta) return '';
  if (meta instanceof Error) {
    return ` error=${JSON.stringify(meta.message)}`;
  }
  const parts = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    if (value instanceof Error) {
      parts.push(`${key}=${JSON.stringify(value.message)}`);
    } else if (typeof value === 'string') {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else if (typeof value === 'object') {
      try {
        parts.push(`${key}=${JSON.stringify(value)}`);
      } catch {
        parts.push(`${key}=[object]`);
      }
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

export function createLogger(level = 'info', { now = () => new Date() } = {}) {
  const threshold = LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.info;

  const write = (name, message, meta) => {
    if (LEVEL_WEIGHT[name] < threshold) return;
    const timestamp = now().toISOString();
    const line = `[${timestamp}] ${name.toUpperCase().padEnd(5)} ${message}${formatMeta(meta)}`;
    if (name === 'error' || name === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    level,
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

export const silentLogger = {
  level: 'silent',
  debug() {},
  info() {},
  warn() {},
  error() {},
};
