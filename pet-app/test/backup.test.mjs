import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.mjs';
import { createBackup, restoreBackup } from '../backup.mjs';

test('encrypted snapshot restores accounts and memory but never active sessions; latest deletions override an older snapshot', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pet-backup-')); const dataDir = join(root, 'live'), destination = join(root, 'offsite'), key = 'ab'.repeat(32);
  const store = new Store(dataDir);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const invite = store.createInvite({ admin: true });
  const alice = await store.register({ invite, username: 'alice', password: 'a safe test password 123' });
  store.newSession(alice.id); store.addMemory(alice.id, '原始秘密-blueberry');
  const archive = await createBackup({ dataDir, destination, key });
  assert.equal(readFileSync(archive).includes(Buffer.from('原始秘密-blueberry')), false);
  const plainRestore = join(root, 'restore-before-delete');
  await restoreBackup({ archive, dataDir: plainRestore, key, deletionJournal: join(dataDir, 'deletions.jsonl') });
  const restored = new Store(plainRestore);
  assert.equal(restored.memories(alice.id).length, 1);
  assert.equal(restored.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  restored.close();
  store.erase(alice.id, 'memories');
  const afterRestore = join(root, 'restore-after-delete');
  await restoreBackup({ archive, dataDir: afterRestore, key, deletionJournal: join(dataDir, 'deletions.jsonl') });
  const after = new Store(afterRestore);
  assert.equal(after.memories(alice.id).length, 0);
  assert.equal((await after.login('alice', 'a safe test password 123')).id, alice.id);
  after.close();
});

test('tampered backups, wrong keys, unsafe destinations and restore into existing data are rejected', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pet-backup-')); const dataDir = join(root, 'live'), destination = join(root, 'offsite'), key = 'ab'.repeat(32);
  const store = new Store(dataDir);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const archive = await createBackup({ dataDir, destination, key });
  const corrupted = Buffer.from(readFileSync(archive)); corrupted[corrupted.length - 1] ^= 1; const broken = join(root, 'broken.dfbackup'); writeFileSync(broken, corrupted);
  await assert.rejects(restoreBackup({ archive: broken, dataDir: join(root, 'bad'), key, deletionJournal: join(dataDir, 'deletions.jsonl') }));
  await assert.rejects(restoreBackup({ archive, dataDir: join(root, 'wrong-key'), key: 'cd'.repeat(32), deletionJournal: join(dataDir, 'deletions.jsonl') }));
  await assert.rejects(createBackup({ dataDir, destination: join(dataDir, 'backup'), key }));
  await assert.rejects(restoreBackup({ archive, dataDir, key, deletionJournal: join(dataDir, 'deletions.jsonl') }));
  await assert.rejects(restoreBackup({ archive, dataDir: join(root, 'missing-journal'), key }));
});

test('restoring a recent snapshot does not replay deletions already applied before new memories', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pet-backup-')); const dataDir = join(root, 'live'), destination = join(root, 'offsite'), key = 'ab'.repeat(32);
  const store = new Store(dataDir);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const user = await store.register({ invite: store.createInvite(), username: 'alice', password: 'a safe test password 123' });
  store.addMemory(user.id, 'old'); store.erase(user.id, 'memories'); store.addMemory(user.id, 'new');
  const archive = await createBackup({ dataDir, destination, key });
  const target = join(root, 'restored'); await restoreBackup({ archive, dataDir: target, key, deletionJournal: join(dataDir, 'deletions.jsonl') });
  const after = new Store(target); assert.equal(after.memories(user.id)[0].text, 'new'); after.close();
});

test('oversized new backups fail before rotation and preserve the last recoverable archive', async t => {
  const root = mkdtempSync(join(tmpdir(), 'pet-backup-')); const dataDir = join(root, 'live'), destination = join(root, 'offsite'), key = 'ab'.repeat(32);
  const store = new Store(dataDir); t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const previous = await createBackup({ dataDir, destination, key });
  await assert.rejects(createBackup({ dataDir, destination, key, maxArchiveBytes: 1 }), /过大/);
  assert.deepEqual(readdirSync(destination), [previous.split(/[\\/]/).at(-1)]);
});
