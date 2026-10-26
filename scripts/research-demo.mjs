import { loadEnvFile, loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { LlmClient } from '../src/chat/llm.js';
import { ChatEngine } from '../src/chat/engine.js';
import { WebSearch } from '../src/search/web-search.js';

loadEnvFile();
const config = loadConfig({ env: process.env });
const logger = createLogger(config.logLevel);
const search = new WebSearch({ ...config.search, logger });
const engine = new ChatEngine(config, {
  logger,
  search,
  llm: new LlmClient(config.llm, { logger }),
});

const result = await engine.reply({
  platform: 'napcat',
  groupId: process.env.DEMO_GROUP_ID ?? 'YOUR_GROUP_ID',
  userId: 'research-test',
  userName: '测试群友',
  text: '帮我查一下工业级具身智能接大模型的开源框架和落地案例，给我几个方向',
  messageId: `research-${Date.now()}`,
  groupContext: '',
});

console.log(result.text);
