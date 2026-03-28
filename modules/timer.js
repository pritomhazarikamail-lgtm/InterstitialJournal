/**
 * modules/timer.js — Live clock and "time since last entry" nudge
 */

import { getLocalNotes } from './storage.js';

export function updateLiveClock() {
    const dateEl = document.getElementById('live-date');
    if (!dateEl) return;
    dateEl.textContent = new Date().toLocaleDateString([], {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
}

export function updateLiveTimer() {
    const nudge = document.getElementById('time-blindness-nudge');
    if (!nudge) return;
    const notes = getLocalNotes();
    if (notes.length > 0) {
        const last = notes.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
        const mins = Math.floor((Date.now() - new Date(last.timestamp)) / 60000);
        nudge.textContent = mins < 1 ? '✨ Just logged.' : `⏳ ${mins}m since last entry.`;
    }
}
