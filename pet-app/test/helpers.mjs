import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

export async function fixture(t, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'pet-api-'));
  const app = createApp({ dataDir, secureCookies: false, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const request = async (path, { cookie, method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'X-Pet-Request': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const register = async (username, admin = false) => {
    const invite = app.store.createInvite({ admin });
    const response = await request('/api/register', { method: 'POST', body: { invite, username, password: 'a safe test password 123', displayName: username } });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response;
  };
  return { app, request, register, dataDir, base };
}
