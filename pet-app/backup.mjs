import { backup, DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { Store } from './store.mjs';

const magic = Buffer.from('DAFEYU-BACKUP-1\n');
function keyBytes(key) { if (typeof key !== 'string' || !/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('PET_BACKUP_KEY 必须是64位十六进制密钥'); return Buffer.from(key, 'hex'); }
function journalRecords(text) {
  return text.split('\n').filter(Boolean).map(line => {
    const value = JSON.parse(line);
    if (typeof value.id !== 'string' || typeof value.userId !== 'string' || !['history', 'memory', 'memories'].includes(value.kind) || (value.kind === 'memory' && typeof value.memoryId !== 'string')) throw new Error('删除记录格式损坏，拒绝恢复');
    return value;
  });
}
function safeTempCleanup(temp, parent) {
  if (!resolve(temp).startsWith(resolve(parent) + sep)) throw new Error('Unsafe temporary directory');
  rmSync(temp, { recursive: true, force: true });
}
export async function createBackup({ dataDir, destination, key, maxArchiveBytes = 256 * 1024 * 1024 }) {
  const secret = keyBytes(key); dataDir = resolve(dataDir); destination = resolve(destination);
  if (destination === dataDir || destination.startsWith(dataDir + sep)) throw new Error('备份必须放在应用数据目录之外，生产环境还须使用独立存储');
  mkdirSync(destination, { recursive: true });
  const temp = mkdtempSync(join(destination, '.snapshot-')); let source;
  try {
    source = new DatabaseSync(join(dataDir, 'pet.sqlite'), { readOnly: true });
    const snapshot = join(temp, 'snapshot.sqlite'); await backup(source, snapshot); source.close(); source = null;
    const db = new DatabaseSync(snapshot);
    db.exec('PRAGMA secure_delete=ON; DELETE FROM sessions; DELETE FROM invites; DELETE FROM audio; VACUUM;'); db.close();
    const journal = readFileSync(join(dataDir, 'deletions.jsonl'), 'utf8'); journalRecords(journal);
    const payload = Buffer.from(JSON.stringify({ version: 1, created: new Date().toISOString(), sqlite: readFileSync(snapshot).toString('base64'), journal }));
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv); cipher.setAAD(magic);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    if (encrypted.length + magic.length + 28 > Math.min(maxArchiveBytes, 256 * 1024 * 1024)) throw new Error('备份过大，未生成新档案且保留所有旧备份；请先迁移备份格式');
    const archive = join(destination, `pet-${Date.now()}-${randomUUID()}.dfbackup`);
    writeFileSync(archive, Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]), { mode: 0o600, flag: 'wx' });
    const archives = readdirSync(destination).filter(name => /^pet-\d+-[a-f0-9-]+\.dfbackup$/.test(name)).sort();
    for (const name of archives.slice(0, -7)) unlinkSync(join(destination, name));
    return archive;
  } finally { source?.close(); safeTempCleanup(temp, destination); }
}

export async function restoreBackup({ archive, dataDir, key, deletionJournal }) {
  const secret = keyBytes(key); dataDir = resolve(dataDir);
  if (existsSync(dataDir) && readdirSync(dataDir).length) throw new Error('只能恢复到空目录；不得覆盖运行中的数据库');
  if (!deletionJournal || !existsSync(deletionJournal)) throw new Error('必须提供最新独立删除日志，不能仅恢复旧快照');
  if (statSync(archive).size > 256 * 1024 * 1024) throw new Error('备份过大，需人工迁移');
  const bytes = readFileSync(archive), offset = magic.length;
  if (!bytes.subarray(0, offset).equals(magic)) throw new Error('备份格式不正确');
  const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(offset, offset + 12));
  decipher.setAAD(magic); decipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(offset + 28)), decipher.final()]).toString());
  if (payload.version !== 1 || typeof payload.sqlite !== 'string' || typeof payload.journal !== 'string') throw new Error('备份内容不正确');
  const currentJournal = readFileSync(deletionJournal, 'utf8');
  const records = new Map([...journalRecords(payload.journal), ...journalRecords(currentJournal)].map(record => [record.id, record]));
  mkdirSync(dataDir, { recursive: true });
  const databasePath = join(dataDir, 'pet.sqlite');
  writeFileSync(databasePath, Buffer.from(payload.sqlite, 'base64'), { mode: 0o600, flag: 'wx' });
  const check = new DatabaseSync(databasePath); const valid = Object.values(check.prepare('PRAGMA integrity_check').get())[0] === 'ok'; check.close();
  if (!valid) throw new Error('数据库完整性检查失败');
  const store = new Store(dataDir);
  try {
    for (const record of records.values()) store.applyDeletion(record);
    store.db.exec("DELETE FROM sessions; DELETE FROM invites; DELETE FROM audio; UPDATE requests SET state='interrupted',error='服务已恢复，请重新发送' WHERE state='pending';");
    writeFileSync(join(dataDir, 'deletions.jsonl'), [...records.values()].map(value => JSON.stringify(value)).join('\n') + (records.size ? '\n' : ''), { mode: 0o600 });
  } finally { store.close(); }
  return dataDir;
}
