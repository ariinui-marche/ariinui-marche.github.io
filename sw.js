const CACHE = 'ariinui-marche-shell-v4';
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
