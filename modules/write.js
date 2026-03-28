/**
 * modules/write.js — Write-page helpers: Next Up field and Recent Strip
 */

import { getLocalNotes } from './storage.js';

/* ── Next Up ──────────────────────────────────────────────────────────────── */

export function getNextUp()    { return localStorage.getItem('next_up') || ''; }
export function setNextUp(val) { localStorage.setItem('next_up', val.slice(0, 200)); }
export function clearNextUp()  { localStorage.removeItem('next_up'); }

export function initNextUp() {
    const noteInput  = document.getElementById('note-input');
    const nextUpInput = document.getElementById('next-up-input');
    const saved = getNextUp();
    if (saved) {
        noteInput.placeholder = saved;
        nextUpInput.value     = '';
    }
}

/* ── Recent Strip ─────────────────────────────────────────────────────────── */

export function renderRecentStrip() {
    const strip  = document.getElementById('recent-strip');
    const listEl = document.getElementById('recent-notes-list');

    // Partial sort: find the 3 most recent in O(n) rather than sorting all
    const allNotes = (() => {
        const ns   = getLocalNotes();
        const top3 = [];
        for (const n of ns) {
            top3.push(n);
            if (top3.length > 3) {
                top3.sort((a, b) => b.timestamp > a.timestamp ? 1 : -1);
                top3.pop();
            }
        }
        return top3.sort((a, b) => b.timestamp > a.timestamp ? 1 : -1);
    })();

    listEl.innerHTML = '';
    if (allNotes.length === 0) { strip.style.display = 'none'; return; }
    strip.style.display = 'block';

    allNotes.forEach(n => {
        const card      = document.createElement('div');
        const typeClass = n.content.startsWith('🏆') || n.content.startsWith('✅') ? 'type-win'
                        : n.content.startsWith('☐') ? 'type-todo'
                        : n.content.startsWith('🚫') ? 'type-block'
                        : '';
        card.className = `recent-note-card ${typeClass}`;

        const timeEl = document.createElement('div');
        timeEl.className   = 'recent-note-time';
        timeEl.textContent = new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const textEl = document.createElement('div');
        textEl.className   = 'recent-note-text';
        textEl.textContent = n.content.replace(/\n/g, ' ');

        card.append(timeEl, textEl);
        listEl.appendChild(card);
    });
}
