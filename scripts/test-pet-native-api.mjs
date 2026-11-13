import { createApp } from '../pet-app/server.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/test-pet-native-api.mjs <Godot executable>');
const directory = mkdtempSync(join(tmpdir(), 'dafeyu-contract-'));
const fixture = join(root, '.cache/pet-native-api-fixture.json');
const app = createApp({
  openRegistration: true,
  dataDir: directory,
  secureCookies: false,
  chat: { stream: async ({ text, onDelta, signal }) => {
    if (text.includes('late-private')) await new Promise(resolve => setTimeout(resolve, 300));
    signal?.throwIfAborted();
    const answer = 'native-fixture:' + text;
    for (const chunk of [answer.slice(0, 8), answer.slice(8)]) { onDelta(chunk); await new Promise(resolve => setTimeout(resolve, 15)); }
    return answer;
  }, reply: async ({ text }) => {
    if (text.includes('late-private')) await new Promise(resolve => setTimeout(resolve, 300));
    return 'native-fixture:' + text;
  } },
});
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  mkdirSync(join(root, '.cache'), { recursive: true });
  writeFileSync(fixture, JSON.stringify({ base: `http://127.0.0.1:${app.server.address().port}` }));
  const child = spawn(resolve(executable), ['--headless', '--path', join(root, 'pet-native'), '--log-file', join(root, '.cache/pet-native-api-contract.log'), '--script', 'res://api_contract_tests.gd'], { stdio: 'inherit', windowsHide: true });
  const timeout = setTimeout(() => child.kill(), 20000);
  try {
    const status = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    if (status !== 0) throw new Error(`Native HTTP contract test failed: ${status}`);
  } finally { clearTimeout(timeout); }
} finally {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
  rmSync(fixture, { force: true });
}
