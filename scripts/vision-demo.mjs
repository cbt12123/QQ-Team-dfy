import { loadEnvFile, loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { LlmClient } from '../src/chat/llm.js';
import { ChatEngine } from '../src/chat/engine.js';
import { ImageService } from '../src/images/image-service.js';
import { ImageGenerator } from '../src/images/image-generator.js';

loadEnvFile();
const config = loadConfig({ env: process.env });
const logger = createLogger(config.logLevel);
const engine = new ChatEngine(config, {
  logger,
  llm: new LlmClient(config.llm, { logger }),
  vision: new ImageService({ ...config.vision, logger }),
  imageGenerator: new ImageGenerator({ ...config.imageGen, logger }),
});

const vision = await engine.reply({
  platform: 'napcat',
  groupId: 'g1',
  userId: '1318053457',
  userName: '爸爸',
  text: '看看这张图里是什么',
  images: ['https://image.pollinations.ai/prompt/a%20cute%20orange%20cat?width=512&height=512&nologo=true'],
  messageId: 'vision-demo',
});
console.log('VISION:', vision.text);

const image = await engine.reply({
  platform: 'napcat',
  groupId: 'g1',
  userId: '1318053457',
  userName: '爸爸',
  text: '画一张赛博朋克风格的西安城墙',
  messageId: 'image-demo',
});
console.log('IMAGE:', image.imageUrl);
