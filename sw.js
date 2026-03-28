'use strict';

/* ============================================================
 * Interstitial Journal — Service Worker  v19
 *
 * Strategy: Cache-first for shell assets, stale-while-revalidate
 * for fonts/CDN, network-first (with cache fallback) for
 * everything else. This keeps the app snappy offline while
 * still picking up shell updates promptly.
 *
 * Edge-case fixes vs v15:
 *  • Opaque (cross-origin) responses are never cached — they can
 *    lock users onto stale CDN resources with no way to bust.
 *  • Range-request responses (206) are never cached — they are
 *    partial and cannot be reconstructed later.
 *  • activate now also sweeps any old "journal-v*" entries so
 *    stale caches don't accumulate across versions.
 *  • postMessage 'SKIP_WAITING' lets the page trigger a takeover
 *    without a full reload cycle (used by the "Update available"
 *    toast in index.html).
 *  • Fonts are served cache-first (they never change for a given
 *    URL), CDN assets stale-while-revalidate so the LLM loader
 *    always gets a fresh module on the next visit without blocking
 *    the current one.
 * ============================================================ */

const CACHE_VERSION = 'journal-v24';

const SHELL_ASSETS = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './manifest.json',
    './modules/state.js',
    './modules/storage.js',
    './modules/modal.js',
    './modules/toast.js',
    './modules/timer.js',
    './modules/write.js',
    './modules/crud.js',
    './modules/drive.js',
    './modules/calendar.js',
    './modules/pomodoro.js',
    './modules/ai.js',
    './modules/search.js',
    './modules/nav.js',
    './modules/reminders.js',
    './modules/intention.js',
    './modules/draft.js',
    './modules/haptic.js',
    './modules/voice.js',
    './modules/weekly.js',
    './icon-192.webp',
    './icon-192.png',
    './icon-512.png',
    './icon-180.png',
    './icon-152.png',
    './icon-120.png',
];

const CDN_ORIGINS = [
    'https://cdn.jsdelivr.net',
    'https://esm.run',
    'https://esm.sh',
];

const FONT_ORIGINS = [
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
];

/* ── Install ─────────────────────────────────────────────── */
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(c => c.addAll(SHELL_ASSETS))
            .catch(err => console.error('[SW] Pre-cache failed:', err))
    );
});

/* ── Activate ────────────────────────────────────────────── */
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_VERSION)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

/* ── Message channel ─────────────────────────────────────── */
self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

/* ── Fetch ───────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (!url.protocol.startsWith('http')) return;

    // Never intercept auth / Drive API calls
    if (url.hostname.endsWith('googleapis.com') ||
        url.hostname.endsWith('accounts.google.com')) return;

    if (FONT_ORIGINS.some(o => url.href.startsWith(o))) {
        event.respondWith(cacheFirst(request));
        return;
    }

    if (CDN_ORIGINS.some(o => url.href.startsWith(o))) {
        event.respondWith(staleWhileRevalidate(request));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(networkFirst(request));
        return;
    }
});

/* ─────────────────────── Strategies ────────────────────── */

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return fetchAndCache(request);
}

async function staleWhileRevalidate(request) {
    const cache  = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request).then(response => {
        if (isCacheable(response)) cache.put(request, response.clone());
        return response;
    }).catch(() => null);

    return cached || await fetchPromise;
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (isCacheable(response)) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        return cached || new Response('Offline — please reconnect.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
        });
    }
}

async function fetchAndCache(request) {
    const response = await fetch(request);
    if (isCacheable(response)) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, response.clone());
    }
    return response;
}

function isCacheable(response) {
    return response &&
           response.status === 200 &&
           (response.type === 'basic' || response.type === 'cors');
}