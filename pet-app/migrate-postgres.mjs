import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresStore, applyPgDeletion } from './postgres-store.mjs';

const columns = {
  users: ['id', 'username', 'display_name', 'password_hash', 'admin', 'generation'],
  memories: ['id', 'user_id', 'text', 'created'],
  messages: ['id', 'user_id', 'request_id', 'role', 'text', 'created'],
  requests: ['user_id', 'request_id', 'state', 'generation', 'response_id', 'error', 'input_hash'],
};

export async function migrateSqlite({ sourceDir, connectionString, schema = 'dafeyu', excludeUsers = [] }) {
  const source = new DatabaseSync(join(resolve(sourceDir), 'pet.sqlite'), { readOnly: true });
  const snapshot = {};
  try {
    source.exec('BEGIN');
    snapshot.users = source.prepare('SELECT * FROM users ORDER BY id').all().filter(row => !excludeUsers.includes(row.username));
    const owners = new Set(snapshot.users.map(user => user.id));
    for (const table of ['memories', 'messages', 'requests']) snapshot[table] = source.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().filter(row => owners.has(row.user_id));
    snapshot.appliedDeletions = source.prepare('SELECT id FROM applied_deletions ORDER BY id').all().map(row => row.id);
    snapshot.deletions = readFileSync(join(resolve(sourceDir), 'deletions.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(record => owners.has(record.userId));
    source.exec('COMMIT');
  } finally { source.close(); }
  const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const target = await PostgresStore.open(connectionString, { schema });
  try {
    await target.db.prepare('CREATE TABLE IF NOT EXISTS migration_meta(source_hash TEXT PRIMARY KEY,completed BIGINT NOT NULL)').run();
    return await target.transaction(async db => {
      await db.prepare('SELECT pg_advisory_xact_lock(183620901)').get();
      const counts = Object.fromEntries(Object.keys(columns).map(table => [table, snapshot[table].length]));
      if (await db.prepare('SELECT source_hash FROM migration_meta WHERE source_hash=?').get(fingerprint)) return { alreadyImported: true, counts };
      if ((await db.prepare('SELECT count(*) n FROM users').get()).n !== 0) throw new Error('目标数据库已有账号，拒绝覆盖或合并');
      for (const [table, fields] of Object.entries(columns)) {
        const sql = `INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`;
        for (const original of snapshot[table]) {
          const row = { ...original };
          if (table === 'requests' && row.state === 'pending') { row.state = 'interrupted'; row.error = '迁移前请求未完成，请重新发送'; }
          await db.prepare(sql).run(...fields.map(field => row[field]));
        }
      }
      for (const record of snapshot.deletions) {
        if (snapshot.appliedDeletions.includes(record.id)) {
          await db.prepare('INSERT INTO deletion_log(id,user_id,kind,memory_id,created) VALUES(?,?,?,?,?)').run(record.id, record.userId, record.kind, record.memoryId || null, record.at);
          await db.prepare('INSERT INTO applied_deletions(id) VALUES(?)').run(record.id);
        } else await applyPgDeletion(db, record);
      }
      // Session cookies and invitations are deliberately not carried to a new public origin.
      await db.prepare('INSERT INTO migration_meta(source_hash,completed) VALUES(?,?)').run(fingerprint, Date.now());
      return { alreadyImported: false, counts };
    });
  } finally { await target.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('先在忽略的环境配置中设置 DATABASE_URL');
  const sourceDir = process.argv[2];
  if (!sourceDir || sourceDir.startsWith('--')) throw new Error('用法：node pet-app/migrate-postgres.mjs <SQLite数据目录> [--exclude-test-account]');
  try {
    console.log(JSON.stringify(await migrateSqlite({ sourceDir, connectionString: process.env.DATABASE_URL, schema: process.env.PET_DATABASE_SCHEMA || 'dafeyu', excludeUsers: process.argv.includes('--exclude-test-account') ? ['native-ui-test'] : [] })));
  } catch (error) { console.error(error.message.includes('目标数据库') ? error.message : '迁移失败，事务已回滚，请检查数据库和源数据'); process.exitCode = 1; }
}
