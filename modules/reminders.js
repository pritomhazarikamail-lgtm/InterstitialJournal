/**
 * modules/reminders.js — Periodic check-in reminders via Web Notifications
 *
 * HOW IT WORKS (two-layer approach):
 *
 * 1. SERVICE WORKER layer (primary, background-capable):
 *    On any interval change, we post SET_REMINDER to the SW. The SW
 *    maintains a setTimeout chain in its own scope and fires
 *    showNotification() — this works even when the tab is in the
 *    background or the screen is off (as long as the SW is alive).
 *    The page re-sends the stored interval on every load so the SW
 *    always has the current setting after a restart.
 *
 * 2. visibilitychange layer (belt-and-suspenders, desktop fallback):
 *    Still used as a secondary check in case the SW timer drifts or
 *    the SW was killed and restarted (it loses its in-memory timer).
 *    This path uses registration.showNotification() so it works on
 *    mobile PWA as well as desktop.
 *
 * The SW is the source of truth for background notifications. The page
 * side is only a fallback and never fires a notification while the app
 * is in the foreground (visibilityState === 'visible' guard).
 */

import { showToast } from './toast.js';

const LAST_FIRE_KEY = 'reminder_last_fire';
let _intervalMins   = 0;
let _listenerAdded  = false;

/* Tell the service worker about the current reminder interval.
   The SW uses this to run its own timer that survives tab backgrounding. */
async function _syncToSW(intervalMins) {
    if (!('serviceWorker' in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        if (reg.active) {
            reg.active.postMessage({ type: 'SET_REMINDER', intervalMins });
        }
    } catch (e) {
        console.warn('[reminders] Could not message SW:', e);
    }
}

export function initReminders() {
    // Restore active reminder on load — no DOM dependency
    const saved = parseInt(localStorage.getItem('checkin_interval') || '0', 10);
    if (saved > 0 && 'Notification' in window && Notification.permission === 'granted') {
        _start(saved);
    }
}

/**
 * Called by the profile preferences select when the user changes the interval.
 * Returns true if the reminder was set, false if permission was denied.
 */
export async function setReminderInterval(mins) {
    if (mins === 0) {
        localStorage.setItem('checkin_interval', '0');
        _stop();
        return true;
    }

    if (!('Notification' in window)) {
        showToast('Notifications not supported on this browser');
        return false;
    }

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
        showToast('Allow notifications in browser settings to use reminders');
        return false;
    }

    localStorage.setItem('checkin_interval', String(mins));
    _start(mins);
    showToast(`Reminder set — nudge every ${mins}m 🔔`);
    return true;
}

/** Send a notification via the Service Worker (mobile-compatible fallback). */
async function _notify() {
    if (document.visibilityState === 'visible') return;

    localStorage.setItem(LAST_FIRE_KEY, String(Date.now()));

    const payload = {
        body:     'Time to check in — what are you working on?',
        icon:     '/InterstitialJournal/icon-192.png',
        badge:    '/InterstitialJournal/icon-120.png',
        tag:      'checkin',
        renotify: true,
    };

    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification('Interstitial Journal', payload);
            return;
        } catch { /* fall through */ }
    }

    try { new Notification('Interstitial Journal', payload); } catch { /* unsupported */ }
}

/** visibilitychange fallback: fire if enough time has elapsed. */
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
    localStorage.setItem(LAST_FIRE_KEY, String(Date.now()));

    // Primary: delegate to service worker for true background notifications
    _syncToSW(intervalMins);

    // Fallback: visibilitychange path (desktop, or when SW timer is reset)
    if (!_listenerAdded) {
        _listenerAdded = true;
        document.addEventListener('visibilitychange', _checkAndMaybeNotify);
    }
}

function _stop() {
    _intervalMins = 0;
    // Tell the SW to cancel its timer too
    _syncToSW(0);
}

