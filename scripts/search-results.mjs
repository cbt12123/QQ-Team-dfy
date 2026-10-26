import { WebSearch } from '../src/search/web-search.js';
import { silentLogger } from '../src/logger.js';

const search = new WebSearch({ logger: silentLogger, maxResults: 8 });
for (const query of [
  '具身智能 大模型 工业级 落地 开源框架',
  '具身智能 大模型 VLA RT-2 工业 机器人',
]) {
  const results = await search.search(query);
  console.log('\nQUERY', query, 'RESULTS', results.length);
  for (const result of results) console.log('-', result.title, '|', result.url);
}
