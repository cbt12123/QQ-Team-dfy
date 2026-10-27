import { loadEnvFile, loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { BreezeVoiceService } from '../src/voice/breeze.js';

loadEnvFile();
const config = loadConfig({ env: process.env });
const logger = createLogger(config.logLevel);
const breeze = new BreezeVoiceService({ ...config.breeze, logger });
const started = Date.now();
const result = await breeze.synthesize('爸爸，今天西安有点凉，你写代码别忘了喝水，也别老是熬夜。');
console.log({ ...result, ms: Date.now() - started });
