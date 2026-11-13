import * as http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node scripts/test-pet-native-stream.mjs <Godot executable>');
const server = http.createServer((req, res) => {
  if (req.url !== '/api/messages/stream' || req.method !== 'POST' || !req.headers.cookie?.startsWith('pet_session=fixture') || req.headers['x-pet-request'] !== '1') {
    res.writeHead(403); res.end('{}'); return;
  }
  if (req.headers.cookie === 'pet_session=fixture_redirect') { res.writeHead(302, {Location:'/forbidden'}); res.end(); return; }
  res.writeHead(200, {'Content-Type':'text/event-stream'});
  if (req.headers.cookie === 'pet_session=fixture_error') { res.end('event: error\ndata: {"error":"fixture error"}\n\n'); return; }
  if (req.headers.cookie === 'pet_session=fixture_large') { res.end('data: ' + 'x'.repeat(2 * 1024 * 1024)); return; }
  const first = Buffer.from('event: delta\r\ndata: {"text":"你"}\r\n\r\n');
  const split = first.indexOf(Buffer.from('你')) + 1;
  res.write(first.subarray(0, split));
  setTimeout(() => res.write(first.subarray(split, first.length - 1)), 35);
  setTimeout(() => res.write(first.subarray(first.length - 1)), 70);
  setTimeout(() => res.write('event: delta\ndata: {"text":"好"}\n\n'), 350);
  setTimeout(() => res.end('event: done\ndata: {"reply":"你好"}\n\n'), 700);
 });
await new Promise(resolve => server.listen(18946, '127.0.0.1', resolve));
try {
  const child = spawn(resolve(process.argv[2]), ['--headless', '--path', resolve(root, 'pet-native'), '--log-file', resolve(root, '.cache/pet-stream-contract.log'), '--script', 'res://stream_transport_tests.gd'], { stdio: 'inherit', windowsHide: true });
  const timer = setTimeout(() => child.kill(), 20000);
  try {
    const status = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    if (status !== 0) throw new Error('Native SSE transport failed: ' + status);
  } finally { clearTimeout(timer); }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
