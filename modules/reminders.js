/**
 * modules/reminders.js — Periodic check-in reminders via Web Notifications
 *
 * Only fires when the tab is hidden — no notification if the user is
 * already looking at the app. Uses a single `tag: 'checkin'` so
 * rapid-fire intervals stack into one notification, not a pile.
 *
 * Mobile reliability: setInterval is suspended when the tab is backgrounded
 * on Android/iOS. Instead we use visibilitychange + a stored last-fire
 * timestamp so the check fires when the user leaves and when they return,
 * regardless of how long the tab was suspended.
 *
 * Mobile note: Android Chrome and iOS (16.4+ PWA) require notifications to
 * be sent via ServiceWorkerRegistration.showNotification(), not the page-level
 * new Notification() constructor. We try the SW path first and fall back to
 * the direct constructor for desktop browsers without a SW.
 */

import { showToast } from './toast.js';

const LAST_FIRE_KEY = 'reminder_last_fire';
let _intervalMins   = 0;
let _listenerAdded  = false;

export function initReminders() {
    const sel = document.getElementById('reminder-select');
    if (!sel) return;

    const saved = parseInt(localStorage.getItem('checkin_interval') || '0', 10);
    sel.value = String(saved);
    _updateHint(saved);

    // Restore active reminder if permission is already granted
    if (saved > 0 && 'Notification' in window && Notification.permission === 'granted') {
        _start(saved);
    }

    sel.addEventListener('change', async function () {
        const mins = parseInt(this.value, 10);
        localStorage.setItem('checkin_interval', String(mins));
        _updateHint(mins);

        if (mins === 0) { _stop(); return; }

        if (!('Notification' in window)) {
            showToast('Notifications not supported on this browser');
            this.value = '0';
            localStorage.setItem('checkin_interval', '0');
            _updateHint(0);
            return;
        }

        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            showToast('Allow notifications in browser settings to use reminders');
            this.value = '0';
            localStorage.setItem('checkin_interval', '0');
            _updateHint(0);
            return;
        }

        _start(mins);
        showToast(`Reminder set — nudge every ${mins}m 🔔`);
    });
}

/** Send a notification via the Service Worker (mobile-compatible). */
async function _notify() {
    if (document.visibilityState === 'visible') return; // app is open, skip

    localStorage.setItem(LAST_FIRE_KEY, String(Date.now()));

    const payload = {
        body:     'Time to check in — what are you working on?',
        icon:     '/InterstitialJournal/icon-192.png',
        badge:    '/InterstitialJournal/icon-120.png', // Android status-bar icon
        tag:      'checkin',   // replaces previous instead of stacking
        renotify: true,
    };

    // SW path — required on Android Chrome and iOS 16.4+ PWA
    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification('Interstitial Journal', payload);
            return;
        } catch { /* fall through to direct constructor */ }
    }

    // Desktop fallback
    try {
        new Notification('Interstitial Journal', payload);
    } catch { /* permission revoked or unsupported */ }
}

/**
 * Check whether enough time has passed since the last fire.
 * Called on visibilitychange (both hide and show).
 */
function _checkAndMaybeNotify() {
    if (_intervalMins <= 0) return;
    const last    = parseInt(localStorage.getItem(LAST_FIRE_KEY) || '0', 10);
    const elapsed = Date.now() - last;
    if (elapsed >= _intervalMins * 60 * 1000) {
        _notify();
    }
}

function _start(intervalMins) {
    _stop();
    _intervalMins = intervalMins;
    localStorage.setItem(LAST_FIRE_KEY, String(Date.now())); // reset timer on start

    // visibilitychange fires reliably on mobile even when setInterval is frozen.
    // Fire when tab goes to background (user leaves app) AND when tab comes back
    // (catches the case where the tab was suspended for a long time).
    if (!_listenerAdded) {
        _listenerAdded = true;
        document.addEventListener('visibilitychange', _checkAndMaybeNotify);
    }
}

function _stop() {
    _intervalMins = 0;
}

function _updateHint(mins) {
    const hint = document.getElementById('reminder-hint');
    if (!hint) return;
    hint.textContent = mins === 0
        ? 'Off'
        : `Nudge every ${mins}m when away`;
}
