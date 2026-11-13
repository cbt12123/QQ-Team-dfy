import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
test('open registration accepts credentials only without granting admin and preserves uniqueness', async t => {
  const { request, app } = await fixture(t, { openRegistration: true });
  const body = { username: 'open_user', password: 'a safe test password 123', admin: true };
  const registered = await request('/api/register', { method: 'POST', body });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.user.admin, false);
  assert.equal((await request('/api/register', { method: 'POST', body })).status, 409);
  assert.equal((await request('/api/register', { method: 'POST', body: { ...body, username: 'invalid_invite', invite: 'forged' } })).status, 400);
  const admin = await request('/api/register', { method: 'POST', body: { ...body, username: 'legacy_admin', invite: app.store.createInvite({ admin: true }) } });
  assert.equal(admin.data.user.admin, true);
  assert.equal((await request('/health')).data.capabilities.openRegistration, true);
});
test('private registration still requires invitation', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/register', { method: 'POST', body: { username: 'private_user', password: 'a safe test password 123' } })).status, 400);
});
