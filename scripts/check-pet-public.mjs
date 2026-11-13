import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { PostgresStore } from '../pet-app/postgres-store.mjs';

const base = 'https://qqbot-public-web-test.onrender.com';
const proofPath = '.cache/pet-public-proof.json';
async function request(path, cookie, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'X-Pet-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000) });
  const data = await response.json();
  assert(response.ok, `Public request failed: ${response.status}`);
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
if (process.argv.includes('--resume')) {
  const proof = JSON.parse(readFileSync(proofPath));
  assert.equal((await request('/api/me', proof.aCookie)).data.user.id, proof.aId);
  assert.equal((await request('/api/messages', proof.aCookie)).data.messages.length, proof.messageCount);
  assert.equal((await request('/api/memories', proof.aCookie)).data.memories[0].text, proof.memory);
  assert.equal((await request('/api/messages', proof.bCookie)).data.messages.length, 0);
  console.log('PASS: public redeployment preserved login, histories and private memory in Neon');
} else if (process.argv.includes('--cleanup')) {
  const proof = JSON.parse(readFileSync(proofPath));
  const store = await PostgresStore.open(process.env.DATABASE_URL, { schema: process.env.PET_DATABASE_SCHEMA || 'dafeyu' });
  try {
    for (const id of [proof.aId, proof.bId]) await store.db.prepare("DELETE FROM users WHERE id=? AND username LIKE 'qa_pub_%'").run(id);
  } finally { await store.close(); }
  rmSync(proofPath);
  console.log('Removed only temporary public QA accounts');
} else {
  const health = await request('/health');
  assert.equal(health.data.mode, 'chat'); assert.equal(health.data.capabilities.chat, true);
  const store = await PostgresStore.open(process.env.DATABASE_URL, { schema: process.env.PET_DATABASE_SCHEMA || 'dafeyu' });
  let invites;
  try { invites = [await store.createInvite(), await store.createInvite()]; } finally { await store.close(); }
  const suffix = Date.now().toString(36);
  const a = await request('/api/register', null, { username: `qa_pub_a_${suffix}`, password: randomBytes(24).toString('hex'), invite: invites[0] });
  const b = await request('/api/register', null, { username: `qa_pub_b_${suffix}`, password: randomBytes(24).toString('hex'), invite: invites[1] });
  const send = async text => (await request('/api/messages', a.cookie, { requestId: randomUUID(), text })).data.message;
  const introduction = await send('请用中文介绍一下你自己，说出你的名字。');
  assert.match(introduction.text, /大肥鱼/); assert.doesNotMatch(introduction.text, /native-fixture:/);
  const memory = '当前账号的专用验证标识：海盐' + randomBytes(4).toString('hex');
  await request('/api/memories', a.cookie, { text: memory });
  const recall = await send('请说出我保存的专用验证标识。');
  assert(recall.text.includes(memory.split('：')[1]));
  assert.equal((await request('/api/messages', b.cookie)).data.messages.length, 0);
  assert.equal((await request('/api/memories', b.cookie)).data.memories.length, 0);
  const messageCount = (await request('/api/messages', a.cookie)).data.messages.length;
  writeFileSync(proofPath, JSON.stringify({ aCookie: a.cookie, bCookie: b.cookie, aId: a.data.user.id, bId: b.data.user.id, memory, messageCount }));
  console.log('PASS: public HTTPS registration/login, actual model reply, private memory and two-account isolation');
}
