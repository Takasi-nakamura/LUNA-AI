// 最小限のキャッシュ：アプリ本体のみ。API通信・CDNは素通し（キャッシュしない）
const CACHE = 'luna-v6';
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
  './src/core/firebase-auth.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('luna-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Network-first for the app shell prevents stale HTML/CSS/JS after deployments.
  const isShell = e.request.mode === 'navigate' || /(?:^|\/)(?:index\.html|sw\.js)$/.test(url.pathname) || /\.(?:css|js)$/.test(url.pathname);
  e.respondWith((async () => {
    if (isShell) {
      try {
        const fresh = await fetch(e.request, { cache: 'no-cache' });
        if (fresh.ok && url.pathname !== '/sw.js') caches.open(CACHE).then((c) => c.put(e.request, fresh.clone()));
        return fresh;
      } catch (err) {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        throw err;
      }
    }
    const hit = await caches.match(e.request);
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
    return res;
  })());
});
