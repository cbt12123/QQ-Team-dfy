import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { loadEnvFile } from '../src/config.js';

loadEnvFile();

const url = process.env.NAPCAT_WS_URL;
const token = process.env.NAPCAT_ACCESS_TOKEN;
if (!url) throw new Error('NAPCAT_WS_URL 未配置');

const ws = new WebSocket(url, {
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
});
const pending = new Map();

function call(action, params = {}) {
  return new Promise((resolve, reject) => {
    const echo = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(echo);
      reject(new Error(`${action} 超时`));
    }, 10_000);
    pending.set(echo, { resolve, reject, timer });
    ws.send(JSON.stringify({ action, params, echo }));
  });
}

ws.on('message', (raw) => {
  const payload = JSON.parse(String(raw));
  const entry = payload.echo ? pending.get(payload.echo) : null;
  if (!entry) return;
  pending.delete(payload.echo);
  clearTimeout(entry.timer);
  if (payload.retcode === 0 || payload.status === 'ok') entry.resolve(payload.data);
  else entry.reject(new Error(payload.message || payload.wording || 'OneBot API 失败'));
});

ws.on('open', async () => {
  try {
    const login = await call('get_login_info');
    const groups = await call('get_group_list');
    console.log(JSON.stringify({ login, groups }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    ws.close();
  }
});

ws.on('error', (error) => {
  console.error(`WebSocket 错误：${error.message}`);
  process.exitCode = 1;
});
