/**
 * modules/reminders.js — Periodic check-in reminders via Web Notifications
 *
 * Only fires when the tab is hidden — no notification if the user is
 * already looking at the app. Uses a single `tag: 'checkin'` so
 * rapid-fire intervals stack into one notification, not a pile.
 *
 * Mobile note: Android Chrome and iOS (16.4+ PWA) require notifications to
 * be sent via ServiceWorkerRegistration.showNotification(), not the page-level
 * new Notification() constructor. We try the SW path first and fall back to
 * the direct constructor for desktop browsers without a SW.
 */

import { showToast } from './toast.js';

let _reminderInterval = null;

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

function _start(intervalMins) {
    _stop();
    _reminderInterval = setInterval(_notify, intervalMins * 60 * 1000);
}

function _stop() {
    if (_reminderInterval) { clearInterval(_reminderInterval); _reminderInterval = null; }
}

function _updateHint(mins) {
    const hint = document.getElementById('reminder-hint');
    if (!hint) return;
    hint.textContent = mins === 0
        ? 'Off'
        : `Nudge every ${mins}m when away`;
}
