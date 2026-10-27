import { loadEnvFile, loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { SingingService } from '../src/singing/singing.js';

loadEnvFile();
const config = loadConfig({ env: process.env });
const logger = createLogger(config.logLevel);
const singing = new SingingService({ ...config.singing, logger });
const result = await singing.sing('唱一首小星星');
console.log(result);
