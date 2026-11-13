import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store, failure, publicUser, digest } from './store.mjs';
import { configuredChat } from './chat.mjs';
import { configuredVoice } from './voice.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mov': 'video/quicktime', '.txt': 'text/plain; charset=utf-8' };

async function readBody(req, limit = 32768, binary = false) {
  if (Number(req.headers['content-length']) > limit) throw failure(413, '内容过大');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw failure(413, '内容过大'); chunks.push(chunk); }
  const body = Buffer.concat(chunks);
  if (binary) return body;
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw failure(415, '请使用 JSON');
  try { const value = JSON.parse(body.toString('utf8') || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw failure(400, '请求格式不正确'); }
}

export function createApp({ dataDir, store: providedStore, secureCookies = true, publicUrl, chat, asr, tts, deletionMirrorDir, downloadsDir } = {}) {
  const store = providedStore || new Store(dataDir, { deletionMirrorDir });
  const ready = Promise.resolve(store.recoverPending ? store.recoverPending() : store.db.prepare("UPDATE requests SET state='interrupted',error='服务已重启，请重新发送' WHERE state='pending'").run());
  ready.catch(() => {}); // Startup caller and API requests observe initialization failures.
  const active = new Map();
  const voiceActive = new Map();
  const limits = new Map();
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const sessionCookie = (res, value, expired = false) => res.setHeader('Set-Cookie', `pet_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expired ? 0 : 2592000}${secureCookies ? '; Secure' : ''}`);
  const rate = (key, max, window = 900000) => {
    const now = Date.now();
    if (limits.size > 10000) for (const [k, entry] of limits) if (entry.until <= now) limits.delete(k);
    const previous = limits.get(key);
    const entry = previous?.until > now ? previous : { count: 0, until: now + window };
    if (++entry.count > max) throw failure(429, '操作太频繁，请稍后重试');
    limits.set(key, entry);
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    let path;
    try {
      path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/health') return json(res, 200, { status: 'ok', mode: 'chat', capabilities: { accounts: true, chat: Boolean(chat) } });
      await ready;
      if (downloadsDir && ['/downloads/dafeyu-android.apk', '/downloads/dafeyu-android.sha256'].includes(path)) {
        if (!['GET', 'HEAD'].includes(req.method)) throw failure(405, '不支持此操作');
        const filename = path.split('/').at(-1);
        const file = join(downloadsDir, filename);
        if (!existsSync(file)) throw failure(404, '下载暂不可用');
        res.writeHead(200, { 'Content-Type': filename.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'text/plain; charset=utf-8',
          'Content-Length': statSync(file).size, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') return res.end();
        const stream = createReadStream(file);
        stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy());
        return stream.pipe(res);
      }
      if (path.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        if (!['GET', 'HEAD'].includes(req.method)) {
          const expectedOrigin = publicUrl ? new URL(publicUrl).origin : `${secureCookies ? 'https' : 'http'}://${req.headers.host}`;
          if (req.headers['x-pet-request'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== expectedOrigin)) throw failure(403, '请求来源不受信任');
        }
        if (path === '/api/register' && req.method === 'POST') {
          rate(`auth:${req.socket.remoteAddress}`, 20);
          const user = await store.register(await readBody(req));
          sessionCookie(res, await store.newSession(user.id));
          return json(res, 201, { user: publicUser(user) });
        }
        if (path === '/api/login' && req.method === 'POST') {
          rate(`auth:${req.socket.remoteAddress}`, 20);
          const body = await readBody(req);
          const user = await store.login(body.username, body.password);
          sessionCookie(res, await store.newSession(user.id));
          return json(res, 200, { user: publicUser(user) });
        }
        const value = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('pet_session='))?.slice(12);
        const user = await store.authenticate(value);
        if (!user) throw failure(401, '请先登录');
        if (path === '/api/me' && req.method === 'GET') return json(res, 200, { user: publicUser(user), capabilities: { chat: Boolean(chat), asr: Boolean(asr), tts: Boolean(tts) } });
        if (path === '/api/logout' && req.method === 'POST') {
          await store.logout(value); sessionCookie(res, '', true); return json(res, 200, { ok: true });
        }
        if (path === '/api/invites' && req.method === 'POST') {
          if (!user.admin) throw failure(403, '仅管理员可生成邀请');
          rate(`invites:${user.id}`, 20, 3600000);
          return json(res, 201, { invite: await store.createInvite(), expiresInHours: 24 });
        }
        if (path === '/api/messages' && req.method === 'GET') {
          if (store.recoverPending) await store.recoverPending(user.id);
          return json(res, 200, { messages: await store.history(user.id), requests: await store.db.prepare('SELECT request_id AS "requestId",state,error FROM requests WHERE user_id=? ORDER BY rowid DESC LIMIT 50').all(user.id) });
        }
        if (path === '/api/memories' && req.method === 'GET') return json(res, 200, { memories: await store.memories(user.id) });
        if (path === '/api/memories' && req.method === 'POST') {
          rate(`memory:${user.id}`, 30, 60000);
          return json(res, 201, { memory: await store.addMemory(user.id, (await readBody(req)).text) });
        }
        if ((path === '/api/memories' || path === '/api/history' || /^\/api\/memories\/[a-f0-9-]+$/.test(path)) && req.method === 'DELETE') {
          const kind = path === '/api/history' ? 'history' : path === '/api/memories' ? 'memories' : 'memory';
          await store.erase(user.id, kind, kind === 'memory' ? path.split('/').at(-1) : undefined);
          active.get(user.id)?.abort();
          voiceActive.get(user.id)?.abort();
          return json(res, 200, { ok: true });
        }
        if (path === '/api/export' && req.method === 'GET') return json(res, 200, { user: publicUser(user), messages: await store.exportHistory(user.id), memories: await store.memories(user.id) });
        if (/^\/api\/audio\/[a-f0-9-]+$/.test(path) && req.method === 'GET') {
          const audio = await store.db.prepare('SELECT * FROM audio WHERE id=? AND user_id=? AND expires>?').get(path.split('/').at(-1), user.id, Date.now());
          if (!audio) throw failure(404, '语音已过期或不存在');
          res.writeHead(200, { 'Content-Type': audio.mime, 'Cache-Control': 'no-store' }); res.end(audio.bytes); return;
        }
        if ((path === '/api/transcribe' || /^\/api\/messages\/[a-f0-9-]+\/audio$/.test(path)) && req.method === 'POST') {
          const transcribing = path === '/api/transcribe';
          if (!(transcribing ? asr : tts)) throw failure(503, '此语音服务尚未配置');
          let message;
          if (!transcribing) {
            message = await store.db.prepare("SELECT * FROM messages WHERE id=? AND user_id=? AND role='assistant'").get(path.split('/')[3], user.id);
            if (!message) throw failure(404, '未找到此回复');
            const cached = await store.db.prepare('SELECT id FROM audio WHERE message_id=? AND user_id=? AND expires>?').get(message.id, user.id, Date.now());
            if (cached) return json(res, 201, { id: cached.id });
          }
          if (voiceActive.has(user.id) || voiceActive.size >= 5) throw failure(429, '语音正在处理中，请稍等');
          rate(`voice:${user.id}`, 10, 60000);
          const controller = new AbortController(); voiceActive.set(user.id, controller);
          try {
            let result;
            if (transcribing) {
              const mime = (req.headers['content-type'] || '').split(';')[0];
              if (!['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'].includes(mime)) throw failure(415, '不支持此录音格式');
              const bytes = await readBody(req, 8 * 1024 * 1024, true); if (!bytes.length) throw failure(400, '录音为空');
              result = await asr.transcribe(bytes, mime, { signal: controller.signal });
              if (typeof result !== 'string' || !result.trim() || result.length > 4000) throw failure(502, '没有识别到有效文字，请重录');
            } else result = await tts.synthesize(message.text.slice(0, 2000), { signal: controller.signal });
            if (controller.signal.aborted || (await store.db.prepare('SELECT generation FROM users WHERE id=?').get(user.id))?.generation !== user.generation) throw failure(409, '内容已清除，本次语音已取消');
            if (transcribing) return json(res, 200, { text: result });
            if (!result.bytes?.length || result.bytes.length > 10 * 1024 * 1024 || !['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm'].includes(result.mime)) throw failure(502, '语音生成失败');
            await store.db.prepare('DELETE FROM audio WHERE expires<?').run(Date.now());
            const id = randomUUID();
            await store.db.prepare('INSERT INTO audio VALUES(?,?,?,?,?,?)').run(id, user.id, message.id, result.mime, result.bytes, Date.now() + 600000);
            return json(res, 201, { id });
          } catch (err) { throw err.status ? err : failure(502, '语音服务暂不可用，可以继续使用文字'); }
          finally { voiceActive.delete(user.id); }
        }
        if (path === '/api/messages' && req.method === 'POST') {
          const { requestId, text } = await readBody(req);
          if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId) || typeof text !== 'string' || !text.trim() || text.length > 4000) throw failure(400, '消息需1～4000字，并包含有效请求标识');
          const prior = await store.db.prepare('SELECT * FROM requests WHERE user_id=? AND request_id=?').get(user.id, requestId);
          if (prior) {
            if (prior.input_hash !== digest(text)) throw failure(409, '请求标识已用于另一条消息');
            const message = prior.state === 'completed' && await store.db.prepare('SELECT id,role,text,created FROM messages WHERE id=? AND user_id=?').get(prior.response_id, user.id);
            if (message) return json(res, 200, { message });
            throw failure(409, prior.error || '此消息仍在处理，请刷新查看状态');
          }
          if (!chat) throw failure(503, '尚未配置云端对话模型，请联系管理员');
          if (active.has(user.id)) throw failure(409, '上一条消息还在回复，请稍等');
          if (active.size >= 5) throw failure(429, '大肥鱼正在忙，请稍后再试');
          rate(`chat:${user.id}`, 20, 60000);
          const controller = new AbortController(); active.set(user.id, controller);
          try {
            const history = (await store.history(user.id)).slice(-40).map(m => ({ role: m.role, content: m.text }));
            const memories = (await store.memories(user.id)).map(m => m.text);
            await store.startMessage(user, requestId, text);
            const answer = await chat.reply({ history, memories, text: text.trim(), signal: controller.signal });
            const current = await store.db.prepare('SELECT generation FROM users WHERE id=?').get(user.id);
            if (controller.signal.aborted || current?.generation !== user.generation) throw failure(409, '内容已清除，本次回复已取消');
            if (typeof answer !== 'string' || !answer.trim()) throw new Error('empty provider answer');
            const message = { id: randomUUID(), role: 'assistant', text: answer.trim().slice(0, 8000), created: Date.now() };
            await store.completeMessage(user, requestId, message);
            return json(res, 200, { message });
          } catch (error) {
            if (!controller.signal.aborted) await store.db.prepare("UPDATE requests SET state='failed',error='回复失败，请使用新的消息重新发送' WHERE user_id=? AND request_id=? AND state='pending'").run(user.id, requestId);
            throw error.status ? error : failure(502, '对话服务暂不可用，请稍后重新发送');
          } finally { active.delete(user.id); }
        }
        throw failure(404, '未找到此接口');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw failure(405, '不支持此操作');
      const relative = path === '/' ? 'index.html' : path.slice(1);
      if (!/^(?:index\.html|app\.js|actions\.js|styles\.css|sw\.js|manifest\.webmanifest|icon\.svg|licenses\.html|licenses\/[a-zA-Z0-9_.-]+\.txt|assets\/[a-zA-Z0-9_.-]+\.(?:json|webm|mov))$/.test(relative)) throw failure(404, '页面不存在');
      const file = join(here, 'public', relative);
      if (!existsSync(file)) throw failure(404, '页面不存在');
      const extension = relative.slice(relative.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务暂时出错，请稍后重试' });
      else res.end();
    }
  });
  server.requestTimeout = 90000;
  server.headersTimeout = 15000;
  return { server, store, ready, close: async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publicUrl = process.env.PET_PUBLIC_URL || 'http://127.0.0.1:8899';
  if (process.env.NODE_ENV === 'production' && ((!process.env.DATABASE_URL && !process.env.PET_DATA_DIR) || !publicUrl.startsWith('https://'))) throw new Error('生产环境必须配置持久数据存储和 HTTPS PET_PUBLIC_URL');
  if (process.env.RENDER && !process.env.DATABASE_URL) throw new Error('Render 公网账号必须配置持久数据库 DATABASE_URL');
  const store = process.env.DATABASE_URL ? await (await import('./postgres-store.mjs')).PostgresStore.open(process.env.DATABASE_URL, { schema: process.env.PET_DATABASE_SCHEMA || 'dafeyu' }) : undefined;
  const app = createApp({ store, downloadsDir: process.env.PET_DOWNLOADS_DIR, dataDir: process.env.PET_DATA_DIR || resolve(here, '../.cache/pet-app-data'), publicUrl, secureCookies: publicUrl.startsWith('https://'), chat: configuredChat(), deletionMirrorDir: process.env.PET_DELETION_MIRROR_DIR, ...configuredVoice() });
  await app.ready;
  app.server.listen(Number(process.env.PORT || 8899), process.env.PET_HOST || '127.0.0.1', () => console.log(`大肥鱼 PWA: ${publicUrl}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().then(() => process.exit(0)); });
}
