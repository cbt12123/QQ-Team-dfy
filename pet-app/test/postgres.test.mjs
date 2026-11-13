import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../postgres-store.mjs';
import { createApp } from '../server.mjs';
import { Store } from '../store.mjs';
import { migrateSqlite } from '../migrate-postgres.mjs';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const enabled = Boolean(process.env.PET_TEST_DATABASE_URL);
async function fixture(t) {
  const schema = 'qa_' + randomUUID().replaceAll('-', '');
  const store = await PostgresStore.open(process.env.PET_TEST_DATABASE_URL, { schema });
  const app = createApp({ store, secureCookies: false, chat: { reply: async ({ text }) => 'reply:' + text } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); const clean = await PostgresStore.open(process.env.PET_TEST_DATABASE_URL); await clean.pool.query(`DROP SCHEMA "${schema}" CASCADE`); await clean.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, cookie, body, method) {
    const r = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'X-Pet-Request': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  }
  async function register(username) { const r = await request('/api/register', null, { username, password: 'postgres-test-password-123', invite: await store.createInvite() }); assert.equal(r.status, 201); return r; }
  return { store, app, schema, request, register };
}

test('PostgreSQL persists private accounts, chat, memory and sessions across connections', { skip: !enabled }, async t => {
  const { store, schema, request, register } = await fixture(t);
  const a = await register('pg_alice'); const b = await register('pg_bob');
  assert.equal((await request('/api/memories', a.cookie, { text: 'only-alice-blueberry' })).status, 201);
  const sent = await request('/api/messages', a.cookie, { requestId: 'pg-message-001', text: ' hello PostgreSQL ' });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.message.text, 'reply:hello PostgreSQL');
  assert.equal((await request('/api/messages', b.cookie)).data.messages.length, 0);
  assert.equal((await request('/api/memories', b.cookie)).data.memories.length, 0);
  const reopened = await PostgresStore.open(process.env.PET_TEST_DATABASE_URL, { schema });
  try {
    assert.equal((await reopened.authenticate(a.cookie.slice('pet_session='.length))).id, a.data.user.id);
    assert.equal((await reopened.history(a.data.user.id)).length, 2);
    assert.equal((await reopened.memories(a.data.user.id))[0].text, 'only-alice-blueberry');
  } finally { await reopened.close(); }
  assert.equal((await request('/api/messages', a.cookie, { requestId: 'pg-message-001', text: ' hello PostgreSQL ' })).data.message.id, sent.data.message.id);
  assert.equal((await request('/api/history', a.cookie, undefined, 'DELETE')).status, 200);
  assert.equal((await request('/api/messages', a.cookie)).data.messages.length, 0);
});

test('PostgreSQL consumes an invitation once and prevents replies after deletion', { skip: !enabled }, async t => {
  const { store, register } = await fixture(t);
  const invite = await store.createInvite();
  const outcomes = await Promise.allSettled(['one', 'two'].map(username => store.register({ username, password: 'postgres-test-password-123', invite })));
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  const a = await register('deleted_user');
  const user = await store.authenticate(a.cookie.slice('pet_session='.length));
  await store.startMessage(user, 'delete-race-001', 'old private text');
  await store.erase(user.id, 'history');
  await assert.rejects(store.completeMessage(user, 'delete-race-001', { id: randomUUID(), role: 'assistant', text: 'must not return', created: Date.now() }), /清除|取消/);
  assert.equal((await store.history(user.id)).length, 0);
});

test('overlapping PostgreSQL app startup preserves an active request and only recovers expired work', { skip: !enabled }, async t => {
  const { store, schema, register } = await fixture(t);
  const account = await register('rolling_restart');
  const user = await store.authenticate(account.cookie.slice('pet_session='.length));
  await store.startMessage(user, 'still-running-001', 'active in old instance');
  const other = await PostgresStore.open(process.env.PET_TEST_DATABASE_URL, { schema });
  const newApp = createApp({ store: other, secureCookies: false });
  await newApp.ready;
  try {
    assert.equal((await store.db.prepare('SELECT state FROM requests WHERE request_id=?').get('still-running-001')).state, 'pending');
    await store.completeMessage(user, 'still-running-001', { id: randomUUID(), role: 'assistant', text: 'old instance completes', created: Date.now() });
    await store.startMessage(user, 'crashed-old-001', 'interrupted before restart');
    await store.db.prepare('UPDATE requests SET started=? WHERE request_id=?').run(Date.now() - 600000, 'crashed-old-001');
    await store.recoverPending(user.id);
    assert.equal((await store.db.prepare('SELECT state FROM requests WHERE request_id=?').get('crashed-old-001')).state, 'interrupted');
  } finally { await newApp.close(); }
});

test('SQLite migration preserves password login, ordering and memory, is repeatable and refuses merging', { skip: !enabled }, async t => {
  const { store, schema } = await fixture(t);
  const sourceDir = mkdtempSync(join(tmpdir(), 'dafeyu-pg-migration-'));
  const source = new Store(sourceDir);
  t.after(() => { source.close(); rmSync(sourceDir, { recursive: true, force: true }); });
  const user = await source.register({ username: 'migrated_user', password: 'postgres-test-password-123', invite: source.createInvite() });
  const oldCookie = source.newSession(user.id);
  source.addMemory(user.id, 'old erased memory');
  source.erase(user.id, 'memories');
  user.generation++;
  source.addMemory(user.id, 'remember my own account');
  source.startMessage(user, 'migration-001', 'first');
  source.completeMessage(user, 'migration-001', { id: randomUUID(), role: 'assistant', text: 'second', created: Date.now() });
  const options = { sourceDir, connectionString: process.env.PET_TEST_DATABASE_URL, schema };
  assert.equal((await migrateSqlite(options)).counts.messages, 2);
  assert.equal((await store.login('migrated_user', 'postgres-test-password-123')).id, user.id);
  assert.equal(await store.authenticate(oldCookie), undefined);
  assert.deepEqual((await store.history(user.id)).map(row => row.text), ['first', 'second']);
  assert.equal((await store.memories(user.id))[0].text, 'remember my own account');
  assert.equal((await migrateSqlite(options)).alreadyImported, true);
  source.addMemory(user.id, 'new changed source');
  await assert.rejects(migrateSqlite(options), /拒绝覆盖/);
  assert.equal((await store.memories(user.id)).length, 1);
});

test('migration replays a journal deletion that was not yet applied to SQLite', { skip: !enabled }, async t => {
  const { store, schema } = await fixture(t);
  const sourceDir = mkdtempSync(join(tmpdir(), 'dafeyu-pg-journal-'));
  const source = new Store(sourceDir);
  t.after(() => { source.close(); rmSync(sourceDir, { recursive: true, force: true }); });
  const user = await source.register({ username: 'erase_on_migration', password: 'postgres-test-password-123', invite: source.createInvite() });
  source.addMemory(user.id, 'must not be resurrected');
  appendFileSync(join(sourceDir, 'deletions.jsonl'), JSON.stringify({ id: randomUUID(), userId: user.id, kind: 'memories', at: Date.now() }) + '\n');
  await migrateSqlite({ sourceDir, connectionString: process.env.PET_TEST_DATABASE_URL, schema });
  assert.equal((await store.memories(user.id)).length, 0);
});
