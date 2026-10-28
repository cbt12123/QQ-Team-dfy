import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PersonalMemory } from '../src/chat/personal-memory.js';
import { ChatEngine } from '../src/chat/engine.js';
import { silentLogger } from '../src/logger.js';

const privateEvent = (text, extra = {}) => ({ platform: 'napcat-private', groupId: 'private:u1', userId: 'u1', text, ...extra });
const groupEvent = (text = '这个呢', extra = {}) => ({ platform: 'napcat', groupId: 'g1', userId: 'u1', text, ...extra });
const fact = (text, extra = {}) => ({ kind: 'preference', key: '兴趣/摄影', text,
  evidence: text, visibility: 'ordinary', status: 'active', ...extra });
function fixture(items, options = {}) {
  return new PersonalMemory({ shareOrdinaryPrivate: true, logger: silentLogger,
    llm: { enabled: true, chat: async () => JSON.stringify({ items }) }, ...options });
}

test('ordinary private interests follow the same person into groups, never another person/provider', async () => {
  const memory = fixture([fact('我喜欢摄影')]);
  await memory.observe(privateEvent('我喜欢摄影'));
  assert.match(await memory.recall(groupEvent('摄影怎么玩')), /我喜欢摄影/);
  assert.equal(await memory.recall(groupEvent('摄影', { userId: 'u2' })), '');
  assert.equal(await memory.recall(groupEvent('摄影', { platform: 'official' })), '');
  memory.close();
});

test('sharing can be disabled without losing the private memory', async () => {
  const memory = fixture([fact('我喜欢摄影')], { shareOrdinaryPrivate: false });
  await memory.observe(privateEvent('我喜欢摄影'));
  assert.equal(await memory.recall(groupEvent()), '');
  assert.match(await memory.recall(privateEvent('喜欢什么')), /摄影/);
  memory.close();
});

test('sensitive or confidential messages remain private even when extraction marks them ordinary', async () => {
  for (const text of ['我明天去医院后去爬山', '我周末去爬山，这件事保密', '我准备骑行到幸福路123号']) {
    const memory = fixture([fact(text, { kind: 'plan' })]);
    await memory.observe(privateEvent(text));
    assert.equal(await memory.recall(groupEvent()), '');
    assert.match(await memory.recall(privateEvent('还记得吗')), /当时计划/);
    memory.close();
  }
});

test('group-specific facts stay in their group and the speaker private chat', async () => {
  const text = '我在做一个工作项目';
  const memory = fixture([fact(text, { kind: 'fact', key: '当前工作', visibility: 'private' })]);
  await memory.observe(groupEvent(text));
  assert.match(await memory.recall(groupEvent()), /工作项目/);
  assert.equal(await memory.recall(groupEvent('', { groupId: 'g2' })), '');
  assert.match(await memory.recall(privateEvent('工作怎么样')), /工作项目/);
  memory.close();
});

test('unsupported model claims and credentials are never saved as facts', async () => {
  let calls = 0;
  const memory = fixture([fact('我喜欢摄影', { evidence: '我喜欢游泳' })], {
    llm: { enabled: true, chat: async () => { calls++; return JSON.stringify({ items: [fact('我喜欢摄影', { evidence: '我喜欢游泳' })] }); } },
  });
  await memory.observe(privateEvent('我今天出去了'));
  assert.equal((await memory.list(privateEvent(''))).length, 0);
  await memory.observe(privateEvent('我的密码是123456，记住'));
  assert.equal(calls, 1);
  memory.close();
});

test('changed preferences replace old values; completed plans stop being conversation hooks', async () => {
  let items = [fact('我喜欢摄影')];
  const memory = fixture([], { llm: { enabled: true, chat: async () => JSON.stringify({ items }) } });
  await memory.observe(privateEvent('我喜欢摄影'));
  items = [fact('我不喜欢摄影了')];
  await memory.observe(privateEvent('我不喜欢摄影了'));
  assert.doesNotMatch(await memory.recall(groupEvent()), /记得：我喜欢摄影/);
  assert.match(await memory.recall(groupEvent()), /不喜欢摄影/);
  items = [fact('我已经去过爬山了', { kind: 'plan', key: '爬山计划', status: 'resolved' })];
  await memory.observe(privateEvent('我已经去过爬山了'));
  assert.doesNotMatch(await memory.recall(groupEvent()), /当时计划/);
  memory.close();
});

test('explicit confidentiality revokes previous sharing immediately', async () => {
  const memory = fixture([fact('我周末准备爬山', { kind: 'plan' })]);
  await memory.observe(privateEvent('我周末准备爬山'));
  assert.match(await memory.recall(groupEvent()), /爬山/);
  void memory.observe(privateEvent('刚才的事别往群里说'));
  assert.equal(await memory.recall(groupEvent()), '');
  memory.close();
});

test('a new private sensitive topic does not erase unrelated shareable interests', async () => {
  let items = [fact('我喜欢摄影')];
  const memory = fixture([], { llm: { enabled: true, chat: async () => JSON.stringify({ items }) } });
  await memory.observe(privateEvent('我喜欢摄影'));
  items = [fact('我明天去医院看病', { kind: 'plan', key: '就诊', visibility: 'private' })];
  await memory.observe(privateEvent('我明天去医院看病，这件事保密'));
  const recalled = await memory.recall(groupEvent());
  assert.match(recalled, /摄影/);
  assert.doesNotMatch(recalled, /医院/);
  memory.close();
});

test('a plan completed in a group resolves the earlier private plan across scenes', async () => {
  let items = [fact('我周末准备爬山', { kind: 'plan', key: '周末爬山' })];
  let request;
  const memory = fixture([], { llm: { enabled: true, chat: async o => {
    request = JSON.parse(o.userText); return JSON.stringify({ items });
  } } });
  await memory.observe(privateEvent('我周末准备爬山'));
  items = [fact('已经完成了', { kind: 'plan', key: '周末爬山', status: 'resolved' })];
  await memory.observe(groupEvent('已经完成了'));
  assert.equal(request.prior[0].key, '周末爬山');
  assert.equal(await memory.recall(privateEvent('好无聊啊'), { proactive: true }), '');
  assert.equal(await memory.recall(groupEvent('好无聊啊', { groupId: 'g2' }), { proactive: true }), '');
  memory.close();
});

test('forgetting cancels in-flight writes and never deletes another user records', async () => {
  let finish;
  const memory = fixture([], { llm: { enabled: true, chat: () => new Promise(resolve => { finish = resolve; }) } });
  const pending = memory.observe(privateEvent('我喜欢摄影'));
  await new Promise(resolve => setImmediate(resolve));
  memory.forget(privateEvent(''));
  finish(JSON.stringify({ items: [fact('我喜欢摄影')] }));
  await pending;
  assert.equal((await memory.list(privateEvent(''))).length, 0);
  memory.close();
  const other = fixture([fact('我喜欢摄影')]);
  await other.observe(privateEvent('我喜欢摄影', { userId: 'u2' }));
  assert.equal(other.forget(privateEvent('')), 0);
  assert.equal((await other.list(privateEvent('', { userId: 'u2' }))).length, 1);
  other.close();
});

test('repeated proactive questions are suppressed for a day while direct recall stays available', async () => {
  let now = Date.parse('2026-10-29T03:00:00Z');
  const memory = fixture([fact('我周末准备爬山', { kind: 'plan' })], { now: () => now });
  await memory.observe(privateEvent('我周末准备爬山'));
  assert.match(await memory.recall(groupEvent('好无聊啊'), { proactive: true }), /爬山/);
  memory.noteDiscussed(groupEvent(), '周末准备爬山的路线选好了吗');
  assert.equal(await memory.recall(groupEvent('好无聊啊'), { proactive: true }), '');
  assert.match(await memory.recall(groupEvent('爬山')), /爬山/);
  now += 86_400_001;
  assert.match(await memory.recall(groupEvent('好无聊啊'), { proactive: true }), /爬山/);
  now += 7 * 86_400_000;
  assert.equal(await memory.recall(groupEvent()), '');
  memory.close();
});

test('memories persist across restarts and disabling sharing also hides previously shared private items', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-personal-'));
  const filePath = join(dir, 'personal-memory.json');
  try {
    const memory = fixture([fact('我喜欢摄影')], { filePath });
    await memory.observe(privateEvent('我喜欢摄影'));
    memory.close();
    assert.equal(JSON.parse(readFileSync(filePath)).version, 1);
    const reloaded = fixture([], { filePath, shareOrdinaryPrivate: false });
    assert.match(await reloaded.recall(privateEvent('')), /摄影/);
    assert.equal(await reloaded.recall(groupEvent()), '');
    reloaded.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('one-time private history migration does not resurrect explicitly forgotten memories', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-import-'));
  try {
    const source = join(dir, 'conversations.json'); const filePath = join(dir, 'personal-memory.json');
    writeFileSync(source, JSON.stringify({ entries: { 'napcat-private:private:u1:u1': {
      updatedAt: Date.now(), messages: [{ role: 'user', content: '我喜欢摄影' }, { role: 'assistant', content: '我喜欢跑步' }],
    } } }));
    const memory = fixture([fact('我喜欢摄影')], { filePath });
    await memory.importRecentPrivate(source);
    assert.equal((await memory.list(privateEvent(''))).length, 1);
    memory.forget(privateEvent(''));
    memory.close();
    const reloaded = fixture([fact('我喜欢摄影')], { filePath });
    await reloaded.importRecentPrivate(source);
    assert.equal((await reloaded.list(privateEvent(''))).length, 0);
    reloaded.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('engine uses personal memory for direct and proactive replies and provides memory controls', async () => {
  const memory = fixture([fact('我喜欢摄影')]);
  await memory.observe(privateEvent('我喜欢摄影'));
  const calls = [];
  const engine = new ChatEngine({ botName: '鱼', replyMaxChars: 800, replyMaxParts: 2 }, {
    personalMemory: memory, logger: silentLogger,
    llm: { enabled: true, chat: async (options) => { calls.push(options); return '最近拍了什么照片？'; } },
  });
  await engine.reply(groupEvent('还记得我的兴趣吗'));
  assert.match(calls[0].personalMemory, /摄影/);
  await engine.proactiveReply({ groupId: 'g1', userId: 'u1', triggerText: '好无聊啊' });
  // Direct answer just discussed photography, so it should not be reintroduced immediately.
  assert.equal(calls[1].personalMemory, '');
  assert.match((await engine.reply(groupEvent('/memory'))).text, /摄影/);
  assert.match((await engine.reply(groupEvent('/forget 摄影'))).text, /已删除 1 条/);
  assert.equal((await memory.list(privateEvent(''))).length, 0);
  memory.close();
});
