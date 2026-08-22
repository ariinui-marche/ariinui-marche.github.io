const CACHE = 'ariinui-marche-shell-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
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
  const isShellRequest = url.origin === self.location.origin && SHELL.some((p) => url.pathname.endsWith(p.replace('./', '')));
  if (!isShellRequest) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
