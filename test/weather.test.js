import test from 'node:test';
import assert from 'node:assert/strict';
import { WeatherService, weatherLabel } from '../src/weather/weather.js';
import { silentLogger } from '../src/logger.js';

const SAMPLE = {
  current: {
    temperature_2m: 18.2,
    apparent_temperature: 17.1,
    relative_humidity_2m: 55,
    weather_code: 2,
    wind_speed_10m: 8.4,
  },
  daily: {
    time: ['2026-10-27', '2026-10-28'],
    weather_code: [2, 61],
    temperature_2m_max: [21.3, 18.5],
    temperature_2m_min: [12.4, 10.2],
    precipitation_probability_max: [10, 60],
  },
};

test('weatherLabel maps WMO codes', () => {
  assert.equal(weatherLabel(0), '晴');
  assert.equal(weatherLabel(61), '小雨');
  assert.equal(weatherLabel(999), '未知天气');
});

test('WeatherService formats current and daily weather', async () => {
  const weather = new WeatherService({
    city: '西安',
    logger: silentLogger,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return SAMPLE;
      },
    }),
  });

  const text = await weather.get();
  assert.match(text, /西安天气/);
  assert.match(text, /当前：18.2°C/);
  assert.match(text, /今天：12.4~21.3°C/);
  assert.match(text, /明天：10.2~18.5°C/);
});

test('WeatherService caches the response', async () => {
  let calls = 0;
  const weather = new WeatherService({
    logger: silentLogger,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, async json() { return SAMPLE; } };
    },
  });
  await weather.get();
  await weather.get();
  assert.equal(calls, 1);
});

test('WeatherService triggers only on weather-like messages', () => {
  const weather = new WeatherService({ logger: silentLogger });
  assert.equal(weather.shouldFetch('今天西安天气怎么样'), true);
  assert.equal(weather.shouldFetch('要不要带伞'), true);
  assert.equal(weather.shouldFetch('今天吃什么'), false);
});
