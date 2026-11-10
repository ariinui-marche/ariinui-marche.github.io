const CACHE = 'ariinui-marche-shell-v163';
const SHELL_PATHS = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
].map((p) => new URL(p, self.location).pathname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL_PATHS.map((p) => new URL(p, self.location)))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// Only serve the cached app shell offline — never intercept /data/*.json or the
// live Vercel API, those must always hit the network (live market data).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isShellRequest = url.origin === self.location.origin && SHELL_PATHS.includes(url.pathname);
  if (!isShellRequest) return;

  event.respondWith(
    // cache:'no-store' forces a real network round-trip, bypassing the browser's
    // HTTP disk cache — without this, GitHub Pages' Cache-Control can serve a
    // stale shell even though this handler looks like "network-first".
    fetch(event.request, { cache: 'no-store' })
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});

// Notifications push du module Alerte (envoyées par le serveur même application fermée / téléphone éteint puis rallumé)
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Alerte', {
    body: d.body || '',
    tag: d.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    vibrate: [300, 150, 300, 150, 600],
    requireInteraction: true, // reste affichée tant qu'on ne la ferme pas
    renotify: true, // une alerte de même étiquette re-sonne / re-vibre
    silent: false,
    timestamp: Date.now(),
    data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow((event.notification.data && event.notification.data.url) || '/');
  }));
});
