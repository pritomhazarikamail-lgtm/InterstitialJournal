/**
 * modules/reminders.js — Periodic check-in reminders via Web Notifications
 *
 * Only fires when the tab is hidden — no notification if the user is
 * already looking at the app. Uses a single `tag: 'checkin'` so
 * rapid-fire intervals stack into one notification, not a pile.
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

function _start(intervalMins) {
    _stop();
    _reminderInterval = setInterval(() => {
        if (document.visibilityState === 'visible') return; // app is open, skip
        try {
            new Notification('Interstitial Journal', {
                body:     'Time to check in — what are you working on?',
                icon:     '/InterstitialJournal/icon-192.png',
                tag:      'checkin',   // replaces previous instead of stacking
                renotify: true,
            });
        } catch (e) { /* notification blocked or unsupported */ }
    }, intervalMins * 60 * 1000);
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
