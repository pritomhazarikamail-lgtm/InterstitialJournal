// InterstitialJournal/sw.js  — production hardened
'use strict';

const CACHE_NAME = 'journal-v3';

// Only cache same-origin app shell assets.
// SECURITY: We deliberately do NOT cache googleapis.com requests — caching
// OAuth tokens or Drive API responses in the SW cache would be a security
// risk (any other SW-aware code on the same origin could read them).
const SHELL_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './journal_icon.png',
];

// SECURITY: Only serve cached responses for same-origin requests.
const ALLOWED_CACHE_ORIGINS = [self.location.origin];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
    );
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;

    // Only handle GET — never intercept POST/PATCH/DELETE (Drive API calls)
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // SECURITY: Do not cache or intercept cross-origin requests.
    // Drive API and Google auth flows always hit the real network.
    if (!ALLOWED_CACHE_ORIGINS.includes(url.origin)) return;

    // Network-first for same-origin requests; fall back to cache when offline
    event.respondWith(
        fetch(request)
            .then(response => {
                // SECURITY: Only cache clean same-origin successful responses.
                // Opaque (type !== 'basic') or error responses are never cached —
                // caching them would serve stale error pages or leak cross-origin data.
                if (response.ok && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});