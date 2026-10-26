import { loadEnvFile, loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { LlmClient } from '../src/chat/llm.js';
import { ChatEngine } from '../src/chat/engine.js';

loadEnvFile();
const config = loadConfig({ env: process.env });
const logger = createLogger(config.logLevel);
const engine = new ChatEngine(config, {
  logger,
  llm: new LlmClient(config.llm, { logger }),
});

const context = [
  '[最近群聊]',
  '小明: 我们准备做一个机器人项目，想接大模型',
  '小红: 你们打算本地部署还是走云端？',
  '小明: 还在看，主要担心延迟和成本',
  '小红: 那得看场景，先把需求收敛一下',
].join('\n');

const answer = await engine.proactiveReply({
  context,
  triggerText: '好像都是云端。',
});
console.log(answer ?? '<SKIP>');
