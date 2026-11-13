import pg from 'pg';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { digest, token, failure } from './store.mjs';

const derive = promisify(scrypt);
const schemaSql = `
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,password_hash TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,generation INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,admin INTEGER NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,created BIGINT NOT NULL,rowid BIGSERIAL UNIQUE);
CREATE INDEX IF NOT EXISTS messages_owner ON messages(user_id,rowid);
CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,text TEXT NOT NULL,created BIGINT NOT NULL,rowid BIGSERIAL UNIQUE);
CREATE TABLE IF NOT EXISTS requests(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_id TEXT NOT NULL,state TEXT NOT NULL,generation INTEGER NOT NULL,response_id TEXT,error TEXT,input_hash TEXT NOT NULL,rowid BIGSERIAL UNIQUE,PRIMARY KEY(user_id,request_id));
ALTER TABLE requests ADD COLUMN IF NOT EXISTS started BIGINT NOT NULL DEFAULT ((EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT);
CREATE TABLE IF NOT EXISTS audio(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,mime TEXT NOT NULL,bytes BYTEA NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS applied_deletions(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS deletion_log(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,memory_id TEXT,created BIGINT NOT NULL);`;

// All callers use fixed application SQL; values always travel as bound parameters.
function qualify(sql, schema) {
  return sql.replace(/\b(FROM|JOIN|INTO|UPDATE|REFERENCES|TABLE IF NOT EXISTS|ALTER TABLE|ON)\s+(users|sessions|invites|messages|memories|requests|audio|applied_deletions|deletion_log|migration_meta)\b/gi, `$1 "${schema}".$2`);
}
export function sqlDatabase(client, schema = 'public') {
  return { prepare(sql) {
    let index = 0;
    const text = qualify(sql, schema).replace(/\?/g, () => '$' + ++index);
    return {
      get: async (...values) => (await client.query(text, values)).rows[0],
      all: async (...values) => (await client.query(text, values)).rows,
      run: async (...values) => ({ changes: (await client.query(text, values)).rowCount }),
    };
  } };
}

export async function applyPgDeletion(db, { id, userId, kind, memoryId, at = Date.now() }) {
  if (!['history', 'memory', 'memories'].includes(kind)) throw new Error('Invalid deletion journal record');
  await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(userId);
  if (await db.prepare('SELECT id FROM applied_deletions WHERE id=?').get(id)) return;
  await db.prepare('UPDATE users SET generation=generation+1 WHERE id=?').run(userId);
  await db.prepare('DELETE FROM messages WHERE user_id=?').run(userId);
  await db.prepare("UPDATE requests SET state='deleted',response_id=NULL,error='内容已删除' WHERE user_id=?").run(userId);
  if (kind === 'memories') await db.prepare('DELETE FROM memories WHERE user_id=?').run(userId);
  if (kind === 'memory') await db.prepare('DELETE FROM memories WHERE user_id=? AND id=?').run(userId, memoryId);
  await db.prepare('INSERT INTO deletion_log(id,user_id,kind,memory_id,created) VALUES(?,?,?,?,?)').run(id, userId, kind, memoryId || null, at);
  await db.prepare('INSERT INTO applied_deletions(id) VALUES(?)').run(id);
}

export class PostgresStore {
  static async open(connectionString, { schema = 'public' } = {}) {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema');
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    for (const option of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(option);
    const pool = new pg.Pool({ connectionString: url.href, ssl: local ? false : { rejectUnauthorized: true },
      max: 4, idleTimeoutMillis: 10000, connectionTimeoutMillis: 20000, statement_timeout: 15000,
      application_name: 'dafeyu',
      types: { getTypeParser: (oid, format) => oid === 20 ? Number : pg.types.getTypeParser(oid, format) } });
    pool.on('error', () => { /* Failed idle connections are removed; a later request reconnects. */ });
    const store = new PostgresStore(pool, schema);
    try {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await pool.query(qualify(schemaSql, schema));
      await store.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
      await store.db.prepare('DELETE FROM invites WHERE expires < ?').run(Date.now());
      await store.db.prepare('DELETE FROM audio WHERE expires < ?').run(Date.now());
      return store;
    } catch (error) { await pool.end(); throw error; }
  }
  constructor(pool, schema) { this.pool = pool; this.schema = schema; this.db = sqlDatabase(pool, schema); }
  async recoverPending(userId) {
    // Provider timeout is 45s and database statements are bounded to 15s. A five-minute
    // grace period preserves live requests during overlapping Render deployments.
    return this.db.prepare("UPDATE requests SET state='interrupted',error='服务已重启，请重新发送' WHERE state='pending' AND started<?" + (userId ? ' AND user_id=?' : ''))
      .run(Date.now() - 300000, ...(userId ? [userId] : []));
  }
  async transaction(action) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(sqlDatabase(client, this.schema));
      await client.query('COMMIT');
      return result;
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
  }
  async createInvite({ admin = false, expiresInMs = 86400000 } = {}) {
    const value = token();
    await this.db.prepare('INSERT INTO invites(hash,admin,expires) VALUES(?,?,?)').run(digest(value), admin ? 1 : 0, Date.now() + expiresInMs);
    return value;
  }
  async register({ invite, username, password, displayName }) {
    username = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!/^[a-z0-9_-]{3,32}$/.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 128 ||
      typeof invite !== 'string' || invite.length > 100 || (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 32))) throw failure(400, '用户名需3～32位，密码需12～128位，昵称最多32字');
    const salt = randomBytes(16).toString('hex');
    const hash = `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
    try {
      return await this.transaction(async db => {
        const invitation = await db.prepare('DELETE FROM invites WHERE hash=? AND expires>? RETURNING admin').get(digest(invite), Date.now());
        if (!invitation) throw failure(400, '邀请已失效或已使用');
        const id = randomUUID();
        await db.prepare('INSERT INTO users(id,username,display_name,password_hash,admin) VALUES(?,?,?,?,?)').run(id, username, (displayName || username).trim(), hash, invitation.admin);
        return db.prepare('SELECT * FROM users WHERE id=?').get(id);
      });
    } catch (error) { if (error.code === '23505') throw failure(409, '此用户名已被使用'); throw error; }
  }
  async login(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 128) throw failure(401, '用户名或密码不正确');
    const user = await this.db.prepare('SELECT * FROM users WHERE username=?').get(username.trim().toLowerCase());
    const [salt, expected] = (user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual = await derive(password, salt, 64);
    if (!user || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) throw failure(401, '用户名或密码不正确');
    return user;
  }
  async newSession(userId) {
    const value = token();
    await this.db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(digest(value), userId, Date.now() + 30 * 86400000);
    return value;
  }
  async authenticate(value) {
    if (!value || value.length > 100) return null;
    return this.db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>?').get(digest(value), Date.now());
  }
  async logout(value) { await this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(value || '')); }
  async history(userId) { return (await this.db.prepare('SELECT id,role,text,created FROM messages WHERE user_id=? ORDER BY rowid DESC LIMIT 500').all(userId)).reverse(); }
  async exportHistory(userId) { return this.db.prepare('SELECT id,role,text,created FROM messages WHERE user_id=? ORDER BY rowid').all(userId); }
  async memories(userId) { return this.db.prepare('SELECT id,text,created FROM memories WHERE user_id=? ORDER BY created,rowid').all(userId); }
  async addMemory(userId, text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 500) throw failure(400, '记忆需1～500字');
    return this.transaction(async db => {
      await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(userId);
      if ((await db.prepare('SELECT count(*) n FROM memories WHERE user_id=?').get(userId)).n >= 100) throw failure(400, '最多保存100条记忆，请先整理');
      const memory = { id: randomUUID(), text: text.trim(), created: Date.now() };
      await db.prepare('INSERT INTO memories(id,user_id,text,created) VALUES(?,?,?,?)').run(memory.id, userId, memory.text, memory.created);
      return memory;
    });
  }
  async erase(userId, kind, memoryId) {
    if (!['history', 'memory', 'memories'].includes(kind)) throw failure(400, '删除类型不正确');
    await this.transaction(async db => {
      await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(userId);
      if (kind === 'memory' && !await db.prepare('SELECT id FROM memories WHERE id=? AND user_id=?').get(memoryId, userId)) throw failure(404, '未找到此记忆');
      await applyPgDeletion(db, { id: randomUUID(), userId, kind, memoryId });
    });
  }
  async startMessage(user, requestId, text) {
    try {
      await this.transaction(async db => {
        const current = await db.prepare('SELECT generation FROM users WHERE id=? FOR UPDATE').get(user.id);
        if (current?.generation !== user.generation) throw failure(409, '内容已清除，本次回复已取消');
        await db.prepare("INSERT INTO requests(user_id,request_id,state,generation,input_hash) VALUES(?,?,'pending',?,?)").run(user.id, requestId, user.generation, digest(text));
        await db.prepare('INSERT INTO messages(id,user_id,request_id,role,text,created) VALUES(?,?,?,?,?,?)').run(randomUUID(), user.id, requestId, 'user', text.trim(), Date.now());
      });
    } catch (error) { if (error.code === '23505') throw failure(409, '此消息已提交，请刷新查看状态'); throw error; }
  }
  async completeMessage(user, requestId, message) {
    await this.transaction(async db => {
      const current = await db.prepare('SELECT generation FROM users WHERE id=? FOR UPDATE').get(user.id);
      const request = await db.prepare('SELECT state FROM requests WHERE user_id=? AND request_id=?').get(user.id, requestId);
      if (current?.generation !== user.generation || request?.state !== 'pending') throw failure(409, '内容已清除，本次回复已取消');
      await db.prepare('INSERT INTO messages(id,user_id,request_id,role,text,created) VALUES(?,?,?,?,?,?)').run(message.id, user.id, requestId, message.role, message.text, message.created);
      await db.prepare("UPDATE requests SET state='completed',response_id=? WHERE user_id=? AND request_id=?").run(message.id, user.id, requestId);
    });
  }
  async close() { await this.pool.end(); }
}
