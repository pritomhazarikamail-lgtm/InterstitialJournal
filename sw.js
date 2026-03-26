// InterstitialJournal/sw.js
const CACHE_NAME = 'journal-dynamic-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './journal_icon.png'
];

// Install: Save the assets to the pocket
self.addEventListener('install', (e) => {
  self.skipWaiting(); // Force the new Service Worker to take over immediately
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Activate: Clean up old caches if we ever DO change the name
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  return self.clients.claim(); // Immediately start controlling all open tabs
});

// Dynamic Fetch: Network-First Strategy
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // If the network is working, save a copy of the new version to the cache
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, resClone);
        });
        return response;
      })
      .catch(() => {
        // If the network fails (offline), return the cached version
        return caches.match(e.request);
      })
  );
});