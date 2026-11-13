// Only fetch upstream-published, attributed animations. No upstream scripts are executed.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const commit = '4f53f8ca175b1a1d9611f58ffc523dd1e08db2ca';
const repo = 'PC2005-cloud/dsh-pet';
const destination = resolve('pet-app/public/assets');
const licenses = resolve('pet-app/public/licenses');
mkdirSync(destination, { recursive: true }); mkdirSync(licenses, { recursive: true });
async function download(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Dafeyu-noncommercial-asset-import' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const raw = `https://raw.githubusercontent.com/${repo}/${commit}/`;
const tree = JSON.parse((await download(`https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`)).toString());
if (tree.truncated) throw new Error('Incomplete upstream inventory');
const blobs = tree.tree.filter(x => x.type === 'blob' && /^dsh-pet\/assets\/webm\/[^/]+\.webm$/.test(x.path));
const actions = [];
const gitHash = data => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
let cursor = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < blobs.length) {
    const blob = blobs[cursor++]; const label = blob.path.split('/').at(-1).slice(0, -5);
    const id = blob.sha.slice(0, 20); const file = `${id}.webm`; const target = join(destination, file);
    let data = existsSync(target) ? readFileSync(target) : await download(raw + blob.path.split('/').map(encodeURIComponent).join('/'));
    if (gitHash(data) !== blob.sha) throw new Error(`Asset integrity mismatch: ${label}`);
    writeFileSync(target, data);
    const group = /^睡觉-/.test(label) ? '睡觉' : /^工作状态|写代码|记录/.test(label) ? '工作' : /^余额/.test(label) ? '余额' : /吃|涮火锅|开饭|零食/.test(label) ? '吃饭' : /碎碎念|哼歌/.test(label) ? '说话' : /点击|拖拽|伸懒腰|泡泡|转|呼吸|张望|跑|漂浮/.test(label) ? '互动' : '玩耍与节日';
    actions.push({ id, label, file, group, sha: blob.sha });
  }
}));
actions.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
writeFileSync(join(destination, 'actions.json'), JSON.stringify({ source: `https://github.com/${repo}`, commit, license: 'CC-BY-NC-SA-4.0; see licenses page', actions }, null, 2) + '\n');
writeFileSync(join(licenses, 'dsh-code-mit.txt'), await download(raw + 'LICENSE'));
writeFileSync(join(licenses, 'upstream-readme.txt'), await download(raw + 'README.md'));
writeFileSync(join(licenses, 'asset-notice.txt'), `大肥鱼动作素材\n来源：https://github.com/${repo}\n固定版本：${commit}\n动画作者：PC2005-cloud\n原型“溟月”：上善无形 https://space.bilibili.com/4456176\nDeepSeek版女仆鲸鱼娘设计：ZipZipPipe https://space.bilibili.com/4168597\n形象许可：CC BY-NC-SA 4.0 https://creativecommons.org/licenses/by-nc-sa/4.0/\n作者声明：https://www.bilibili.com/opus/1247156596114456581\n非商业使用；需署名，改编素材按相同方式共享。不是 DeepSeek 官方产品或形象。\n本项目仅将原始 WebM 重命名为内容标识，并制作动作分类/播放适配；未更改视频内容。\n未引入上游字体、表情包、音效或水印处理工具。\n`);
console.log(`Verified ${actions.length} animations; ${(blobs.reduce((n, x) => n + x.size, 0) / 1048576).toFixed(2)} MiB, commit ${commit}`);
