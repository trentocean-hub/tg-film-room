// Offline cache so the app opens from the Home Screen without a connection.
// Bump VERSION whenever you change app files, so iPads pick up the new version.
const VERSION = 'film-room-v2';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'manifest.webmanifest',
  'assets/tg-portrait.png', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.url.startsWith('blob:')) return;
  // Network first for app files (so updates show up), cache as fallback; fonts cached as they load.
  e.respondWith(fetch(req).then(res => {
    if (res.ok && (new URL(req.url).origin === location.origin || req.url.includes('fonts.g'))) {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req)));
});
