/**
 * modules/timer.js — Live clock and "time since last entry" nudge
 */

import { getLocalNotes } from './storage.js';

export function updateLiveClock() {
    const dateEl = document.getElementById('live-date');
    if (!dateEl) return;
    const now  = new Date();
    const date = now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    dateEl.textContent = `${date} · ${time}`;
}

export function updateLiveTimer() {
    const nudge = document.getElementById('time-blindness-nudge');
    if (!nudge) return;
    const notes = getLocalNotes();
    if (notes.length === 0) { nudge.textContent = ''; return; }
    const last = notes.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
    const mins = Math.floor((Date.now() - new Date(last.timestamp)) / 60000);
    // Only show the nudge when it's been a while — below that threshold it's noise
    nudge.textContent = mins >= 60 ? `⏳ ${mins >= 120 ? Math.floor(mins / 60) + 'h' : mins + 'm'} since last entry` : '';
}
