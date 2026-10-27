const IMAGE_MARKERS = new Set([
  'image',
  'mface',
]);

/**
 * Extract image URLs from OneBot array-form or CQ-string messages.
 */
export function collectImageUrls(message, max = 5) {
  const urls = [];

  if (Array.isArray(message)) {
    for (const segment of message) {
      if (!segment || !IMAGE_MARKERS.has(segment.type)) continue;
      const data = segment.data ?? {};
      const url = data.url ?? data.file;
      if (url) urls.push(String(url));
    }
  } else {
    const input = String(message ?? '');
    const regex = /\[CQ:(?:image|mface),([^\]]*)\]/g;
    for (let match = regex.exec(input); match; match = regex.exec(input)) {
      const params = {};
      for (const part of match[1].split(',')) {
        const equals = part.indexOf('=');
        if (equals < 0) continue;
        params[part.slice(0, equals)] = part.slice(equals + 1)
          .replace(/&#91;/g, '[')
          .replace(/&#93;/g, ']')
          .replace(/&#44;/g, ',')
          .replace(/&amp;/g, '&');
      }
      const url = params.url ?? params.file;
      if (url) urls.push(String(url));
    }
  }

  return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url) || url.startsWith('data:image/')))].slice(
    0,
    max,
  );
}

export class ImageService {
  #cache = new Map();

  constructor({
    enabled = true,
    maxImages = 3,
    timeoutMs = 20_000,
    maxBytes = 20 * 1024 * 1024,
    fetchImpl = globalThis.fetch,
    logger,
    now = () => Date.now(),
    cacheTtlMs = 10 * 60 * 1000,
  } = {}) {
    this.enabled = enabled;
    this.maxImages = Math.max(1, maxImages);
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.now = now;
    this.cacheTtlMs = cacheTtlMs;
  }

  async prepare(urls) {
    if (!this.enabled || !Array.isArray(urls) || !urls.length) return [];
    const prepared = [];

    for (const url of urls.slice(0, this.maxImages)) {
      try {
        const dataUrl = await this.#load(url);
        if (dataUrl) prepared.push(dataUrl);
      } catch (error) {
        this.logger?.warn('下载图片失败', { error });
      }
    }
    return prepared;
  }

  async #load(url) {
    if (url.startsWith('data:image/')) return url;

    const cached = this.#cache.get(url);
    if (cached && this.now() < cached.expiresAt) return cached.dataUrl;

    const response = await this.fetchImpl(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`图片 HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      throw new Error(`不是图片：${contentType}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > this.maxBytes) throw new Error(`图片过大：${buffer.length} bytes`);

    const dataUrl = `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`;
    this.#cache.set(url, {
      dataUrl,
      expiresAt: this.now() + this.cacheTtlMs,
    });
    if (this.#cache.size > 100) {
      this.#cache.delete(this.#cache.keys().next().value);
    }
    this.logger?.info('图片已准备', { bytes: buffer.length, type: contentType });
    return dataUrl;
  }
}
