// GR Poker service worker — caches the app for offline use.

const CACHE_NAME = 'gr-poker-v8.61';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './firebase-init.js',
  './icon-192.png',
  './icon-512.png',
  './vendor/react.production.min.js',
  './vendor/react-dom.production.min.js',
  './vendor/babel.min.js',
  // External dependencies cached after first fetch
  'https://cdn.tailwindcss.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS.filter((u) => !u.startsWith('http'))).catch(() => {})
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Never cache Firebase API endpoints (they need to hit the network for real-time data)
  if (req.url.includes('firestore.googleapis.com') ||
      req.url.includes('identitytoolkit.googleapis.com') ||
      req.url.includes('securetoken.googleapis.com') ||
      req.url.includes('firebaseappcheck.googleapis.com')) {
    return; // Let the browser handle it directly
  }

  // sounds.json and sounds/ files: bypass cache so updates take effect immediately
  if (req.url.includes('/sounds/')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  const isHTML = req.headers.get('accept')?.includes('text/html');
  if (isHTML) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (req.url.startsWith(self.location.origin) ||
                       req.url.includes('cdn.tailwindcss.com') ||
                       req.url.includes('gstatic.com/firebasejs'))) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      // If the network fetch fails and there was nothing cached either,
      // `cached` here is undefined — returning that to respondWith()
      // throws "Failed to convert value to 'Response'" and hangs the
      // request instead of just failing it (this is what stalled page
      // load into a permanent spinner when unpkg.com had a blip).
      }).catch(() => cached || Response.error());
    })
  );
});
