import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchQuery,
  parseSearchResults,
  WebSearch,
} from '../src/search/web-search.js';
import { silentLogger } from '../src/logger.js';

const SAMPLE_HTML = `
<li class="res-list" data-result-type="normal">
  <h3 class="res-title " > <a href="https://www.so.com/link?m=abc" data-mdurl="https://example.com/a" target="_blank">具身智能<em>大模型</em>落地案例</a></h3>
  <p class="res-desc">这是一段<em>搜索摘要</em>。</p>
</li>
<li class="res-list">
  <h3 class="res-title " > <a href="https://www.so.com/link?m=def" data-mdurl="https://example.com/b">开源框架</a></h3>
  <p class="res-desc">第二个结果。</p>
</li>
`;

test('parseSearchResults extracts titles, snippets and real URLs', () => {
  const results = parseSearchResults(SAMPLE_HTML);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, '具身智能 大模型 落地案例');
  assert.equal(results[0].url, 'https://example.com/a');
  assert.match(results[0].snippet, /搜索摘要/);
  assert.equal(results[1].url, 'https://example.com/b');
});

test('buildSearchQuery removes chat filler words', () => {
  assert.equal(buildSearchQuery('帮我查查资料，具身智能大模型工业级落地'), '具身智能大模型工业级落地');
});

test('WebSearch caches results and treats search results as data', async () => {
  let calls = 0;
  const search = new WebSearch({
    logger: silentLogger,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        async text() {
          return SAMPLE_HTML;
        },
      };
    },
  });

  const first = await search.search('具身智能 资料');
  const second = await search.search('具身智能 资料');
  assert.equal(calls, 1);
  assert.equal(first.length, 2);
  assert.deepEqual(second, first);
  assert.match(search.formatForPrompt(first), /联网搜索结果/);
});

test('WebSearch only triggers on research-like messages', () => {
  const search = new WebSearch({ logger: silentLogger });
  assert.equal(search.shouldSearch('帮我查一下具身智能的资料'), true);
  assert.equal(search.shouldSearch('今天吃什么'), false);
});
