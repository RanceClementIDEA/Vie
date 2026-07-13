/* ════════════════════════════════════════════
   SUIVI DE VIE — Service Worker
   Cache de l'app shell + stratégie stale-while-revalidate.
   Incrémentez CACHE_NAME à chaque mise à jour des fichiers.
════════════════════════════════════════════ */

const CACHE_NAME = 'suivi-vie-v2.0.1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Ne gérer que les GET même origine (Firebase & CDN passent en direct)
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetched = fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
