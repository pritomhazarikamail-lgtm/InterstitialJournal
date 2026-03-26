'use strict';
const CACHE_NAME = 'journal-v8';
const SHELL_ASSETS = ['./', './index.html', './manifest.json', './journal_icon.png'];
const ALLOWED_CACHE_ORIGINS = [self.location.origin];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL_ASSETS)));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (!ALLOWED_CACHE_ORIGINS.includes(url.origin)) return;
    event.respondWith(
        fetch(request).then(response => {
            if (response.ok && response.type === 'basic') {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(c => c.put(request, clone));
            }
            return response;
        }).catch(() => caches.match(request))
    );
});