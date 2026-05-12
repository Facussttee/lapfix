const CACHE_NAME = 'lapfix-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './main.js',
  './manifest.json',
  'https://unpkg.com/dexie/dist/dexie.js',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cache hit or fetch from network
        return response || fetch(event.request);
      })
  );
});