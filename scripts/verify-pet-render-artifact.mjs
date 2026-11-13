import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const root = resolve('.cache/render-public-web-source');
const values = [['model key', process.env.LLM_API_KEY], ['database URL', process.env.DATABASE_URL]];
if (values.some(([, value]) => !value)) throw new Error('验证前需加载本机模型和数据库配置');
values.push(['database password', decodeURIComponent(new URL(process.env.DATABASE_URL).password)]);
let files = 0;
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { walk(path); continue; }
    if (entry.name.startsWith('.env')) throw new Error('发布目录包含环境配置文件');
    const bytes = readFileSync(path);
    for (const [name, secret] of values) if (secret && bytes.includes(Buffer.from(secret))) throw new Error(`发布文件包含 ${name}: ${relative(root, path)}`);
    files++;
  }
}
walk(root);
console.log(JSON.stringify({ checkedFiles: files, secretScanPassed: true }));
