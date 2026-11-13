import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const derive = promisify(scrypt);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const publicUser = user => ({ id: user.id, username: user.username, displayName: user.display_name, admin: Boolean(user.admin) });
export function failure(status, message) { return Object.assign(new Error(message), { status }); }

export class Store {
  constructor(dataDir, { deletionMirrorDir } = {}) {
    this.dataDir = dataDir;
    this.deletionMirrorDir = deletionMirrorDir;
    mkdirSync(dataDir, { recursive: true });
    if (!existsSync(join(dataDir, 'deletions.jsonl'))) writeFileSync(join(dataDir, 'deletions.jsonl'), '', { mode: 0o600 });
    if (deletionMirrorDir) mkdirSync(deletionMirrorDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'pet.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, admin INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_owner ON messages(user_id,created);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_id TEXT NOT NULL, state TEXT NOT NULL, response_id TEXT, error TEXT, generation INTEGER NOT NULL, input_hash TEXT NOT NULL,
        PRIMARY KEY(user_id,request_id));
      CREATE TABLE IF NOT EXISTS audio (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, mime TEXT NOT NULL, bytes BLOB NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS applied_deletions (id TEXT PRIMARY KEY);
      DELETE FROM sessions WHERE expires < ${Date.now()};
      DELETE FROM invites WHERE expires < ${Date.now()};
      DELETE FROM audio WHERE expires < ${Date.now()};`);
  }
  createInvite({ admin = false, expiresInMs = 86400000 } = {}) {
    const value = token();
    this.db.prepare('INSERT INTO invites VALUES(?,?,?)').run(digest(value), admin ? 1 : 0, Date.now() + expiresInMs);
    return value;
  }
  async register({ invite = "", username, password, displayName }, { allowWithoutInvite = false } = {}) {
    username = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!/^[a-z0-9_-]{3,32}$/.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 128 ||
      typeof invite !== 'string' || invite.length > 100 || (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 32))) {
      throw failure(400, '用户名需3～32位英文字母、数字、横线或下划线；密码需12～128位，昵称最多32字');
    }
    const salt = randomBytes(16).toString('hex');
    const hash = `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const invitation = !invite && allowWithoutInvite ? { admin: 0 } : this.db.prepare('SELECT * FROM invites WHERE hash=? AND expires>?').get(digest(invite), Date.now());
      if (!invitation) throw failure(400, '邀请已失效或已使用');
      if (this.db.prepare('SELECT id FROM users WHERE username=?').get(username)) throw failure(409, '此用户名已被使用');
      const id = randomUUID();
      this.db.prepare('INSERT INTO users(id,username,display_name,password_hash,admin) VALUES(?,?,?,?,?)')
        .run(id, username, (displayName || username).trim(), hash, invitation.admin);
      this.db.prepare('DELETE FROM invites WHERE hash=?').run(digest(invite));
      this.db.exec('COMMIT');
      return this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async login(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 128) throw failure(401, '用户名或密码不正确');
    const user = this.db.prepare('SELECT * FROM users WHERE username=?').get(username.trim().toLowerCase());
    const [salt, expected] = (user?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual = await derive(password, salt, 64);
    if (!user || !timingSafeEqual(actual, Buffer.from(expected, 'hex'))) throw failure(401, '用户名或密码不正确');
    return user;
  }
  newSession(userId) {
    const value = token();
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(value), userId, Date.now() + 30 * 86400000);
    return value;
  }
  authenticate(value) {
    if (!value || value.length > 100) return null;
    return this.db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>?')
      .get(digest(value), Date.now());
  }
  logout(value) { this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(value || '')); }
  history(userId) { return this.db.prepare('SELECT id,role,text,created FROM messages WHERE user_id=? ORDER BY rowid DESC LIMIT 500').all(userId).reverse(); }
  exportHistory(userId) { return this.db.prepare('SELECT id,role,text,created FROM messages WHERE user_id=? ORDER BY rowid').all(userId); }
  memories(userId) { return this.db.prepare('SELECT id,text,created FROM memories WHERE user_id=? ORDER BY created,rowid').all(userId); }
  addMemory(userId, text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 500) throw failure(400, '记忆需1～500字');
    if (this.memories(userId).length >= 100) throw failure(400, '最多保存100条记忆，请先整理');
    const memory = { id: randomUUID(), text: text.trim(), created: Date.now() };
    this.db.prepare('INSERT INTO memories VALUES(?,?,?,?)').run(memory.id, userId, memory.text, memory.created);
    return memory;
  }
  erase(userId, kind, memoryId) {
    if (kind === 'memory' && !this.db.prepare('SELECT id FROM memories WHERE id=? AND user_id=?').get(memoryId, userId)) throw failure(404, '未找到此记忆');
    // The durable deletion journal travels independently of snapshots; restore replays all entries.
    const record = { id: randomUUID(), userId, kind, memoryId: memoryId || null, at: Date.now() };
    const line = JSON.stringify(record) + '\n';
    appendFileSync(join(this.dataDir, 'deletions.jsonl'), line, { mode: 0o600, flush: true });
    if (this.deletionMirrorDir) appendFileSync(join(this.deletionMirrorDir, 'deletions.jsonl'), line, { mode: 0o600, flush: true });
    this.applyDeletion(record);
  }
  applyDeletion({ id, userId, kind, memoryId }) {
    if (id && this.db.prepare('SELECT id FROM applied_deletions WHERE id=?').get(id)) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE users SET generation=generation+1 WHERE id=?').run(userId);
      this.db.prepare('DELETE FROM messages WHERE user_id=?').run(userId);
      this.db.prepare("UPDATE requests SET state='deleted',response_id=NULL,error='内容已删除' WHERE user_id=?").run(userId);
      if (kind === 'memories') this.db.prepare('DELETE FROM memories WHERE user_id=?').run(userId);
      if (kind === 'memory') this.db.prepare('DELETE FROM memories WHERE user_id=? AND id=?').run(userId, memoryId);
      if (id) this.db.prepare('INSERT INTO applied_deletions VALUES(?)').run(id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  startMessage(user, requestId, text) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT generation FROM users WHERE id=?').get(user.id)?.generation !== user.generation) throw failure(409, '内容已清除，本次回复已取消');
      this.db.prepare("INSERT INTO requests(user_id,request_id,state,generation,input_hash) VALUES(?,?,'pending',?,?)").run(user.id, requestId, user.generation, digest(text));
      this.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(randomUUID(), user.id, requestId, 'user', text.trim(), Date.now());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  completeMessage(user, requestId, message) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT generation FROM users WHERE id=?').get(user.id);
      const request = this.db.prepare('SELECT state FROM requests WHERE user_id=? AND request_id=?').get(user.id, requestId);
      if (current?.generation !== user.generation || request?.state !== 'pending') throw failure(409, '内容已清除，本次回复已取消');
      this.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(message.id, user.id, requestId, message.role, message.text, message.created);
      this.db.prepare("UPDATE requests SET state='completed',response_id=? WHERE user_id=? AND request_id=?").run(message.id, user.id, requestId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
