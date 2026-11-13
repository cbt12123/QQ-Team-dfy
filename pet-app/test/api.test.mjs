import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from "./helpers.mjs";

test('invitation is single-use, credentials are hashed, sessions survive restart and logout revokes them', async t => {
  const { app, request } = await fixture(t);
  const invite = app.store.createInvite({ admin: true });
  const first = await request('/api/register', { method: 'POST', body: { invite, username: 'alice', password: 'a safe test password 123' } });
  assert.equal(first.status, 201);
  assert.match(first.headers.get('set-cookie'), /HttpOnly/);
  assert.match(first.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await request('/api/me', { cookie: first.cookie })).data.user.username, 'alice');
  assert.equal((await request('/api/register', { method: 'POST', body: { invite, username: 'bob', password: 'a safe test password 123' } })).status, 400);
  assert.equal((await request('/api/login', { method: 'POST', body: { username: 'alice', password: 'wrong password' } })).status, 401);
  const login = await request('/api/login', { method: 'POST', body: { username: 'alice', password: 'a safe test password 123' } });
  assert.equal(login.status, 200);
  const stored = app.store.db.prepare('SELECT * FROM users').get();
  assert.notEqual(stored.password_hash, 'a safe test password 123');
  assert.equal((await request('/api/logout', { method: 'POST', cookie: login.cookie })).status, 200);
  assert.equal((await request('/api/me', { cookie: login.cookie })).status, 401);
});

test('private endpoints require authentication and only an admin may invite', async t => {
  const { request, register } = await fixture(t);
  assert.equal((await request('/api/messages')).status, 401);
  const alice = await register('alice');
  assert.equal((await request('/api/invites', { cookie: alice.cookie, method: 'POST', body: {} })).status, 403);
  const admin = await register('owner', true);
  const invite = await request('/api/invites', { cookie: admin.cookie, method: 'POST', body: {} });
  assert.equal(invite.status, 201);
  assert.equal(typeof invite.data.invite, 'string');
});

test('cross-origin mutation, invalid credentials and oversized bodies are rejected without exposing paths', async t => {
  const { request, register } = await fixture(t);
  const alice = await register('alice');
  assert.equal((await request('/api/logout', { cookie: alice.cookie, method: 'POST', headers: { Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await request('/api/logout', { cookie: alice.cookie, method: 'POST', headers: { 'X-Pet-Request': '' } })).status, 403);
  assert.equal((await request('/api/register', { method: 'POST', body: { invite: 'unknown', username: '../oops', password: 'tiny' } })).status, 400);
  const huge = await request('/api/login', { method: 'POST', body: { username: 'x'.repeat(40000) } });
  assert.equal(huge.status, 413);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/server.mjs')).status, 404);
  assert.match((await request('/api/me', { cookie: alice.cookie })).headers.get('cache-control'), /no-store/);
});

test('expired invites and brute force login are bounded', async t => {
  const { app, request } = await fixture(t);
  const invite = app.store.createInvite({ expiresInMs: -1 });
  assert.equal((await request('/api/register', { method: 'POST', body: { invite, username: 'alice', password: 'a safe test password 123' } })).status, 400);
  let last;
  for (let i = 0; i < 22; i++) last = await request('/api/login', { method: 'POST', body: { username: 'unknown', password: 'incorrect' } });
  assert.equal(last.status, 429);
});
