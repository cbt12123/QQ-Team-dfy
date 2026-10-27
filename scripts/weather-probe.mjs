const url =
  'https://api.open-meteo.com/v1/forecast?latitude=34.3416&longitude=108.9398&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FShanghai&forecast_days=2';
const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
console.log('status', response.status);
console.log((await response.text()).slice(0, 2000));
