// Public animation preview only: no accounts, database, model calls or audio uploads.
import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', json: 'application/json', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', webm: 'video/webm', txt: 'text/plain; charset=utf-8' };
function preview(page) {
  return page.replace('来，坐一会儿。', '先和大肥鱼玩一会儿。')
    .replace('登录后，我会记得属于你的故事。', '点击左边的按钮，试试吃饭、伸懒腰、吐泡泡和睡觉。手机上可以往下滑，打开更多动作。')
    .replace('<div class="auth-tabs">', '<div class="auth-tabs" hidden>')
    .replace('<form id="auth-form">', '<form id="auth-form" hidden>')
    .replace('A SPACE JUST FOR YOU', 'ANIMATION PREVIEW')
    .replace('聊天与录音由云端服务处理，必要内容会发送给所配置的模型及语音服务商。账号记录分别保存；服务器运维可能接触数据，并非端到端加密。', '当前是公开动作预览，不接收账号、聊天或录音数据。多人聊天、个人记忆和语音的开发版已完成基础验证，正式服务尚未上线。')
    .replace('<p class="privacy-copy">', '<div class="notice">114 段动作 · 点击互动 · 睡眠与唤醒<br>动作在设备上播放，不会调用模型。<br>苹果设备的透明视频仍待实测。</div><p class="privacy-copy">');
}
http.createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"status":"ok","mode":"animation-preview"}'); }
  if (path.startsWith('/api/')) { res.writeHead(path === '/api/me' ? 401 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ error: '这里只提供动作预览，暂不开放账号和聊天' })); }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  // Explicit download allowlist; never serve arbitrary repository files.
  if (['/downloads/dafeyu-android.apk', '/downloads/dafeyu-android.sha256'].includes(path)) {
    const file = join(root, path.slice(1));
    if (!existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': path.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'text/plain; charset=utf-8',
      'Content-Length': statSync(file).size,
      'Content-Disposition': `attachment; filename="${path.split('/').at(-1)}"`,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    return stream.pipe(res);
  }
  const relative = path === '/' ? 'index.html' : path.slice(1);
  if (!/^(?:index\.html|app\.js|actions\.js|styles\.css|sw\.js|manifest\.webmanifest|icon\.svg|licenses\.html|licenses\/[a-zA-Z0-9_.-]+\.txt|assets\/[a-zA-Z0-9_.-]+\.(?:json|webm))$/.test(relative) || !existsSync(join(root, relative))) { res.writeHead(404); return res.end('Not found'); }
  const content = relative === 'index.html' ? preview(readFileSync(join(root, relative), 'utf8')) : readFileSync(join(root, relative));
  res.writeHead(200, { 'Content-Type': types[relative.split('.').at(-1)] || 'application/octet-stream', 'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : content);
}).listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log('Public animation preview listening'));
