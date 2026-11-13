import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = resolve('.');
const target = resolve('.cache/render-public-web-source');
if (!existsSync(join(target, '.git'))) throw new Error('缺少已有 Render 发布仓库，拒绝写入其他路径');
const require = createRequire(import.meta.url);
const esbuild = require(join(root, '.cache/pet-render-build/node_modules/esbuild'));
mkdirSync(join(target, 'pet-app'), { recursive: true });
for (const name of ['server.mjs', 'store.mjs', 'chat.mjs', 'voice.mjs']) cpSync(join(root, 'pet-app', name), join(target, 'pet-app', name));
cpSync(join(root, 'pet-app/public'), join(target, 'pet-app/public'), { recursive: true });
cpSync(join(root, 'deploy/pet-render-server.mjs'), join(target, 'server.mjs'));
// The existing Render build command is syntax-only; ship a pinned, locally bundled pg driver.
const build = await esbuild.build({ entryPoints: [join(root, 'pet-app/postgres-store.mjs')], outfile: join(target, 'pet-app/postgres-store.mjs'), bundle: true,
  platform: 'node', format: 'esm', target: 'node24', external: ['pg-native'], metafile: true, legalComments: 'eof',
  banner: { js: "import { createRequire as __petCreateRequire } from 'node:module'; const require = __petCreateRequire(import.meta.url);" } });
const packages = new Set(Object.keys(build.metafile.inputs).filter(path => path.includes('node_modules/')).map(path => path.split('node_modules/')[1].split('/')[0]));
const notices = [];
for (const name of [...packages].sort()) {
  const directory = join(root, 'pet-app/node_modules', name);
  const metadata = JSON.parse(readFileSync(join(directory, 'package.json')));
  const license = readdirSync(directory).find(file => /^licen[cs]e(?:\.|$)/i.test(file));
  notices.push(`${name} ${metadata.version}\nLicense: ${metadata.license}\n${license ? readFileSync(join(directory, license), 'utf8') : 'See upstream package license.'}\n`);
}
mkdirSync(join(target, 'pet-app/public/licenses'), { recursive: true });
writeFileSync(join(target, 'pet-app/public/licenses/postgres-driver.txt'), notices.join('\n---\n\n').trimEnd() + '\n');
writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'dafeyu-public-chat', private: true, type: 'module', scripts: { start: 'node server.mjs' }, engines: { node: '>=24 <25' } }, null, 2) + '\n');
const version = JSON.parse(readFileSync(join(root, 'pet-native/version.json'), 'utf8'));
if (!Number.isInteger(version.version_code) || version.version_code < 1 || typeof version.version_name !== 'string' || version.package_name !== 'com.dafeyu.pet') throw new Error('无效的 Android 版本元数据');
const presets = readFileSync(join(root, 'pet-native/export_presets.cfg'), 'utf8');
for (const [pattern, expected] of [[/^version\/code=(\d+)$/gm, String(version.version_code)], [/^version\/name="([^"]+)"$/gm, version.version_name]]) {
  const matches = [...presets.matchAll(pattern)];
  if (matches.length !== 2 || matches.some(match => match[1] !== expected)) throw new Error('Android 导出预设与版本元数据不一致');
}
const publicUrl = process.env.PET_PUBLIC_URL || 'https://qqbot-public-web-test.onrender.com';
if (new URL(publicUrl).protocol !== 'https:') throw new Error('Android 更新地址必须使用 HTTPS');
const artifacts = {};
mkdirSync(join(target, 'public/downloads'), { recursive: true });
for (const [architecture, filename] of [['arm64', 'dafeyu-android.apk'], ['x86_64', 'dafeyu-android-x86_64.apk']]) {
  const apk = readFileSync(join(root, `artifacts/dafeyu-native-${architecture}-debug.apk`));
  const sha256 = createHash('sha256').update(apk).digest('hex');
  writeFileSync(join(target, 'public/downloads', filename), apk);
  writeFileSync(join(target, 'public/downloads', filename.replace('.apk', '.sha256')), sha256 + '  ' + filename + '\n');
  artifacts[architecture] = { url: new URL('/downloads/' + filename, publicUrl).href, sha256, size: apk.length };
}
writeFileSync(join(target, 'public/downloads/app-release.json'), JSON.stringify({ ...version, artifacts }, null, 2) + '\n');
console.log(JSON.stringify({ prepared: true, bundledPackages: packages.size, artifacts, secretsCopied: false }));
