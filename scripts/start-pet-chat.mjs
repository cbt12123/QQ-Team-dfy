import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

async function start() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  process.loadEnvFile(join(root, 'pet-app/.env'));
  if (!process.env.LLM_API_KEY) throw new Error('请先在 pet-app/.env 配置真实聊天模型');
  const address = process.env.PET_PUBLIC_URL || 'http://127.0.0.1:8899';
  try {
    const health = await fetch(new URL('/health', address), { signal: AbortSignal.timeout(1000) });
    await health.arrayBuffer();
    if (health.ok) { console.log('大肥鱼服务已在运行：' + address); return; }
  } catch { /* No running instance. */ }
  mkdirSync(join(root, '.cache'), { recursive: true });
  const output = openSync(join(root, '.cache/pet-chat-server.log'), 'a');
  const errors = openSync(join(root, '.cache/pet-chat-server-error.log'), 'a');
  const child = spawn(process.execPath, ['--env-file=pet-app/.env', 'pet-app/server.mjs'], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, errors],
  });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  let exited = false;
  child.once('exit', () => { exited = true; });
  let ready = false;
  for (let attempt = 0; attempt < 30 && !exited; attempt++) {
    try {
      const response = await fetch(new URL('/health', address), { signal: AbortSignal.timeout(500) });
      await response.arrayBuffer();
      if (response.ok) { ready = true; break; }
    } catch { /* Give the child time to bind its port. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) {
    child.kill(); child.unref();
    closeSync(output); closeSync(errors);
    throw new Error('后台服务未就绪，请检查 .cache/pet-chat-server-error.log');
  }
  writeFileSync(join(root, '.cache/pet-chat-server.pid'), String(child.pid));
  closeSync(output); closeSync(errors);
  child.unref();
  console.log('大肥鱼后台服务已启动：' + address);
}

await start();
