const query = '具身智能 大模型 工业级 落地 开源框架';
const url = `https://www.so.com/s?q=${encodeURIComponent(query)}`;
const response = await fetch(url, {
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
  signal: AbortSignal.timeout(15000),
});
const html = await response.text();
const blocks = html.match(/<li class="res-list[\s\S]*?<\/li>/g) ?? [];
console.log('blocks', blocks.length);
for (const block of blocks.slice(0, 2)) {
  console.log('\n--- BLOCK ---');
  console.log(block.slice(0, 2500).replace(/\s+/g, ' '));
}
