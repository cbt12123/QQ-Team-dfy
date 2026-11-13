import { resolve } from 'node:path';
import { createApp } from './pet-app/server.mjs';
import { PostgresStore } from './pet-app/postgres-store.mjs';
import { configuredChat } from './pet-app/chat.mjs';
import { configuredVoice } from './pet-app/voice.mjs';

if (!process.env.DATABASE_URL || !process.env.LLM_API_KEY) throw new Error('公网聊天需要配置持久数据库和模型密钥');
const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.PET_PUBLIC_URL;
if (!publicUrl?.startsWith('https://')) throw new Error('公网服务必须使用 HTTPS');
const store = await PostgresStore.open(process.env.DATABASE_URL, { schema: process.env.PET_DATABASE_SCHEMA || 'dafeyu' });
const app = createApp({ store, openRegistration: true, publicUrl, secureCookies: true, chat: configuredChat(), ...configuredVoice(), downloadsDir: resolve('public/downloads') });
await app.ready;
app.server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log('大肥鱼公网聊天服务已启动'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
