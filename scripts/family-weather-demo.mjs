import { loadEnvFile, loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { LlmClient } from '../src/chat/llm.js';
import { ChatEngine } from '../src/chat/engine.js';
import { WeatherService } from '../src/weather/weather.js';

loadEnvFile();
const config = loadConfig({ env: process.env });
const logger = createLogger(config.logLevel);
const weather = new WeatherService({ ...config.weather, logger });
const engine = new ChatEngine(config, {
  logger,
  weather,
  llm: new LlmClient(config.llm, { logger }),
});

const father = await engine.reply({
  platform: 'napcat-private',
  groupId: 'private:1318053457',
  userId: '1318053457',
  userName: '爸爸',
  text: '爸爸这边今天天气怎么样，要不要带伞？',
  messageId: 'family-demo',
});
console.log('DAD:', father.text);

const other = await engine.reply({
  platform: 'napcat-private',
  groupId: 'private:10002',
  userId: '10002',
  userName: '群友',
  text: '西安今天天气怎么样？',
  messageId: 'family-demo-2',
});
console.log('OTHER:', other.text);
