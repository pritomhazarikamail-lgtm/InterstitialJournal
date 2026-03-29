'use strict';

/* ============================================================
 * Interstitial Journal — Service Worker  v27
 *
 * NEW in v27:
 *  • Background check-in notifications via SW message channel.
 *    The page sends 'SET_REMINDER' with an intervalMins value.
 *    The SW stores it and uses a self-scheduling setTimeout chain
 *    so notifications fire even when the tab is fully backgrounded
 *    or the browser is sleeping (as long as the SW is alive).
 *    On mobile, the SW may be killed; on PWA installs it survives
 *    much longer. This is the best achievable without Periodic
 *    Background Sync (which requires special browser permission).
 *
 *  • The page-side reminders.js still handles the visibilitychange
 *    path as a belt-and-suspenders fallback for desktop.
 * ============================================================ */

const CACHE_VERSION = 'journal-v28';

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
    './modules/profile.js',
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

/* ── Reminder state ──────────────────────────────────────────────────────── */
// Stored in SW scope (not IndexedDB) for simplicity — survives across messages
// within a SW lifecycle but resets if the SW is killed and restarted.
// The page always re-sends SET_REMINDER on load so this is self-healing.
let _reminderIntervalMins = 0;
let _reminderTimer = null;

function _scheduleNextReminder() {
    clearTimeout(_reminderTimer);
    if (_reminderIntervalMins <= 0) return;

    _reminderTimer = setTimeout(async () => {
        // Only notify if no client is currently visible (app is in background)
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
        const anyVisible = clients.some(c => c.visibilityState === 'visible');

        if (!anyVisible) {
            await self.registration.showNotification('Interstitial Journal', {
                body:     'Time to check in — what are you working on?',
                icon:     '/InterstitialJournal/icon-192.png',
                badge:    '/InterstitialJournal/icon-120.png',
                tag:      'checkin',
                renotify: true,
            });
        }

        // Always reschedule so notifications keep firing
        _scheduleNextReminder();
    }, _reminderIntervalMins * 60 * 1000);
}

/* ── Install ─────────────────────────────────────────────────────────────── */
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(c => c.addAll(SHELL_ASSETS))
            .catch(err => console.error('[SW] Pre-cache failed:', err))
    );
});

/* ── Activate ────────────────────────────────────────────────────────────── */
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

/* ── Message channel ─────────────────────────────────────────────────────── */
self.addEventListener('message', event => {
    const { data } = event;

    if (data === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }

    // Page sends this when reminder interval changes (including 0 = off)
    if (data?.type === 'SET_REMINDER') {
        _reminderIntervalMins = Number(data.intervalMins) || 0;
        clearTimeout(_reminderTimer);
        _reminderTimer = null;
        if (_reminderIntervalMins > 0) _scheduleNextReminder();
        return;
    }
});

/* ── Notification click — focus/open the app ─────────────────────────────── */
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            for (const client of clients) {
                if (client.url.includes('InterstitialJournal') && 'focus' in client) {
                    return client.focus();
                }
            }
            return self.clients.openWindow('/InterstitialJournal/');
        })
    );
});

/* ── Fetch ───────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (!url.protocol.startsWith('http')) return;

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