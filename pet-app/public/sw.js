const VERSION = 'dafeyu-shell-v1';
const ACTION_CACHE = 'dafeyu-actions-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/actions.js', '/icon.svg', '/manifest.webmanifest', '/licenses.html', '/assets/actions.json'];
self.addEventListener('install', event => { event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION && key !== ACTION_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (/^\/assets\/[a-f0-9]+\.webm$/.test(url.pathname)) {
    event.respondWith(caches.open(ACTION_CACHE).then(async cache => {
      const cached = await cache.match(url.pathname); if (cached) return cached;
      const response = await fetch(event.request);
      if (response.status === 200) { await cache.put(url.pathname, response.clone()); const keys = await cache.keys(); for (const old of keys.slice(0, -16)) await cache.delete(old); }
      return response;
    })); return;
  }
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(VERSION).then(cache => cache.put(url.pathname, copy))); }
    return response;
  }).catch(() => caches.match(url.pathname)));
});
