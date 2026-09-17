// Bumping CACHE_NAME invalidates all previously cached assets and forces
// a fresh download on the next load - do this whenever any cached file changes.
const CACHE_NAME = 'bubble-sweeper-v2';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.webmanifest',
  './cardboard-bg2-compressed.jpg',
  './tape.png',
  './bgm-full.mp3',
  './pop.mp3',
  './multipop.mp3',
  './warning.mp3',
  './warning-reversed2.mp3',
  './warning-denied.mp3',
  './lose.mp3',
  './winner.mp3',
  './new.mp3',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Cache-first, falling back to network (and caching the result for next time).
// This is what makes the game playable fully offline once it's been loaded once.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      }).catch(() => {
        // Both cache and network failed (e.g. offline + not yet cached) -
        // nothing sensible to return, let the request fail normally.
      });
    })
  );
});
