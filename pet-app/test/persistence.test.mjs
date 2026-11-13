import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.mjs';
import { createApp } from '../server.mjs';

test('accounts, sessions and memories persist; an interrupted request is not silently recharged after restart', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'pet-restart-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const store = new Store(dataDir);
  const user = await store.register({ invite: store.createInvite(), username: 'alice', password: 'a safe test password 123' });
  const cookie = store.newSession(user.id); store.addMemory(user.id, '喜欢蓝莓');
  store.db.prepare("INSERT INTO requests(user_id,request_id,state,generation,input_hash) VALUES(?,?,'pending',0,'test-hash')").run(user.id, 'pending-001');
  store.close();
  const app = createApp({ dataDir, secureCookies: false });
  assert.equal(app.store.authenticate(cookie).id, user.id);
  assert.equal(app.store.memories(user.id)[0].text, '喜欢蓝莓');
  assert.equal(app.store.db.prepare('SELECT state FROM requests WHERE request_id=?').get('pending-001').state, 'interrupted');
  await app.close();
});
