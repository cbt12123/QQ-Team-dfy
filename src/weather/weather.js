const WEATHER_CODES = {
  0: '晴',
  1: '大部晴朗',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '毛毛雨',
  53: '小雨',
  55: '中雨',
  56: '冻毛毛雨',
  57: '冻雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷暴',
  96: '雷暴伴冰雹',
  99: '强雷暴伴冰雹',
};

export function weatherLabel(code) {
  return WEATHER_CODES[Number(code)] ?? '未知天气';
}

export class WeatherService {
  #cache = null;

  constructor({
    enabled = true,
    city = '西安',
    latitude = 34.3416,
    longitude = 108.9398,
    timezone = 'Asia/Shanghai',
    timeoutMs = 10_000,
    cacheTtlMs = 10 * 60 * 1000,
    fetchImpl = globalThis.fetch,
    logger,
    now = () => Date.now(),
  } = {}) {
    this.enabled = enabled;
    this.city = city;
    this.latitude = latitude;
    this.longitude = longitude;
    this.timezone = timezone;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.now = now;
  }

  shouldFetch(text) {
    return (
      this.enabled &&
      /(天气|气温|温度|下雨|雨伞|带伞|冷不冷|热不热|穿什么|多少度)/.test(String(text ?? ''))
    );
  }

  async get() {
    if (!this.enabled) return '';
    if (this.#cache && this.now() < this.#cache.expiresAt) return this.#cache.text;

    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(this.latitude));
    url.searchParams.set('longitude', String(this.longitude));
    url.searchParams.set(
      'current',
      'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m',
    );
    url.searchParams.set(
      'daily',
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    );
    url.searchParams.set('timezone', this.timezone);
    url.searchParams.set('forecast_days', '2');

    try {
      const response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`天气 HTTP ${response.status}`);
      const payload = await response.json();
      const text = this.#format(payload);
      if (!text) throw new Error('天气数据为空');

      this.#cache = { text, expiresAt: this.now() + this.cacheTtlMs };
      this.logger?.info('天气数据已更新', { city: this.city });
      return text;
    } catch (error) {
      this.logger?.warn('获取天气失败', { city: this.city, error });
      return '';
    }
  }

  #format(payload) {
    const current = payload?.current;
    const daily = payload?.daily;
    if (!current || !daily?.time?.length) return '';

    const today = 0;
    const tomorrow = 1;
    const lines = [
      `[${this.city}天气，来源 Open-Meteo]`,
      `当前：${current.temperature_2m}°C，体感 ${current.apparent_temperature}°C，${weatherLabel(
        current.weather_code,
      )}，湿度 ${current.relative_humidity_2m}%，风速 ${current.wind_speed_10m}km/h`,
      `今天：${daily.temperature_2m_min[today]}~${daily.temperature_2m_max[today]}°C，${weatherLabel(
        daily.weather_code[today],
      )}，降雨概率 ${daily.precipitation_probability_max[today]}%`,
    ];

    if (daily.time[tomorrow]) {
      lines.push(
        `明天：${daily.temperature_2m_min[tomorrow]}~${daily.temperature_2m_max[tomorrow]}°C，${weatherLabel(
          daily.weather_code[tomorrow],
        )}，降雨概率 ${daily.precipitation_probability_max[tomorrow]}%`,
      );
    }
    return lines.join('\n');
  }
}
