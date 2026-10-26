import { loadEnvFile, loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { LlmClient } from '../src/chat/llm.js';
import { ChatEngine } from '../src/chat/engine.js';
import { ConversationStore } from '../src/chat/memory.js';

loadEnvFile();
const config = loadConfig({ env: process.env });
const logger = createLogger(config.logLevel);
const llm = new LlmClient(config.llm, { logger });
const engine = new ChatEngine(config, {
  logger,
  llm,
  memory: new ConversationStore({
    maxTurns: config.maxHistoryTurns,
    ttlMs: config.historyTtlMs,
  }),
});

const result = await engine.reply({
  platform: 'napcat',
  groupId: process.env.DEMO_GROUP_ID ?? 'YOUR_GROUP_ID',
  userId: 'test-user',
  userName: '测试群友',
  text: '用一句群友的口吻跟我打个招呼，别太长。',
  messageId: 'local-test',
  reply: async () => {},
});
console.log(result.text);
