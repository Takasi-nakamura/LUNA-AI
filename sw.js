// 最小限のキャッシュ：アプリ本体のみ。API通信・CDNは素通し（キャッシュしない）
const CACHE = 'luna-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './src/styles/app.css',
  './src/main.js',
  './src/store/db.js',
  './src/store/config.js',
  './src/core/lse.js',
  './src/core/router.js',
  './src/core/memory.js',
  './src/core/skills.js',
  './src/core/tools.js',
  './src/core/orchestrator.js',
  './src/ui/dom.js',
  './src/ui/render.js',
  './src/ui/popups.js',
  './src/ui/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && url.pathname !== '/sw.js') caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
    )
  );
});
