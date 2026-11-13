import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';
test('release endpoint serves only a fixed local manifest before database readiness', async t => {
  const { request, dataDir } = await fixture(t);
  assert.equal((await request('/api/app/version')).status, 503);
  const server = await fixture(t, { downloadsDir: dataDir, store: { recoverPending: () => new Promise(() => {}), close() {} } });
  const manifest = { package_name: 'com.dafeyu.pet', version_code: 5, version_name: '0.2.0', release_notes: 'test', artifacts: { arm64: { url: 'https://example.com/downloads/dafeyu-android.apk', sha256: 'a'.repeat(64), size: 4 } } };
  writeFileSync(join(dataDir, 'app-release.json'), JSON.stringify(manifest));
  const response = await server.request('/api/app/version');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(response.data, manifest);
  assert.equal((await server.request('/api/app/version', { method: 'POST', body: {} })).status, 405);
  writeFileSync(join(dataDir, 'dafeyu-android-x86_64.apk'), 'test');
  // Downloads require readiness; the normal fixture verifies the additional architecture.
  const downloads = await fixture(t, { downloadsDir: dataDir });
  const apk = await downloads.request('/downloads/dafeyu-android-x86_64.apk');
  assert.equal(apk.status, 200);
  assert.equal(apk.data, 'test');
});
