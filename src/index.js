import { loadEnvFile } from './config.js';

loadEnvFile();

const { main } = await import('./app.js');

try {
  await main();
} catch (error) {
  console.error(`[qqbot] 启动失败：${error?.message ?? error}`);
  if (process.env.LOG_LEVEL === 'debug' && error?.stack) console.error(error.stack);
  process.exitCode = 1;
}
