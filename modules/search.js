/**
 * modules/search.js — Full-text search, tag filter, date range filter
 */

import { getLocalNotes } from './storage.js';
import { uiState } from './state.js';
import {
    buildNoteCard, renderCalendar,
    clearTagActive, clearDateRange, restoreCalendarState,
} from './calendar.js';

export function searchNotes() {
    const rawQuery = document.getElementById('search-input').value.slice(0, 200);
    const query    = rawQuery.toLowerCase();
    const list     = document.getElementById('notes-list');
    const cal      = document.getElementById('calendar');
    const title    = document.getElementById('selected-date-title');

    if (!query) {
        cal.style.display = 'grid'; list.innerHTML = ''; title.textContent = ''; return;
    }

    cal.style.display = 'none';
    title.textContent = `Search: "${rawQuery.slice(0, 50)}"`;

    const filtered = getLocalNotes()
        .filter(n => n.content.toLowerCase().includes(query))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    list.innerHTML = '';
    filtered.forEach(n => {
        const card = buildNoteCard(n, true);
        const divs = card.querySelectorAll('div');
        const contentDiv = Array.from(divs).find(d => d.style.margin);
        if (contentDiv) {
            const newDiv = document.createElement('div');
            newDiv.style.cssText = 'margin:10px 0;font-size:1.05rem;';
            const lower = n.content.toLowerCase();
            let last = 0, pos;
            // SECURITY: DOM highlight — never innerHTML
            while ((pos = lower.indexOf(query, last)) !== -1) {
                if (pos > last) newDiv.appendChild(document.createTextNode(n.content.slice(last, pos)));
                const mark = document.createElement('mark');
                mark.textContent = n.content.slice(pos, pos + query.length);
                newDiv.appendChild(mark);
                last = pos + query.length;
            }
            if (last < n.content.length) newDiv.appendChild(document.createTextNode(n.content.slice(last)));
            contentDiv.replaceWith(newDiv);
        }
        list.appendChild(card);
    });

    if (filtered.length === 0) {
        const p = document.createElement('p'); p.textContent = 'No notes match your search.'; list.appendChild(p);
    }
}

export function filterByTag(tag) {
    if (!/^#\w+$/.test(tag)) return; // SECURITY: re-validate

    if (uiState.activeTag === tag) {
        uiState.activeTag = null;
        clearTagActive();
        restoreCalendarState();
        return;
    }

    uiState.activeTag = tag;
    clearTagActive();
    clearDateRange();
    document.querySelectorAll('#tag-cloud .tag, #tag-overflow-list .tag').forEach(btn => {
        const isActive = btn.textContent.trim() === tag;
        btn.classList.toggle('tag--active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    const notes = getLocalNotes()
        .filter(n => n.tags.includes(tag))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    document.getElementById('calendar').style.display = 'grid';
    document.getElementById('selected-date-title').textContent = `Tag: ${tag}`;
    const list = document.getElementById('notes-list');
    list.innerHTML = '';

    if (notes.length === 0) {
        const p = document.createElement('p'); p.textContent = 'No notes with this tag.'; list.appendChild(p);
        return;
    }

    notes.forEach(n => {
        const card   = document.createElement('div'); card.className = 'note-item';
        const dateEl = document.createElement('small'); dateEl.textContent = n.dateKey;
        const body   = document.createElement('div');  body.textContent   = n.content;
        card.append(dateEl, body);
        list.appendChild(card);
    });
}

export function filterByDateRange() {
    const fromInput = document.getElementById('date-from');
    const toInput   = document.getElementById('date-to');
    uiState.dateFrom = fromInput.value || null;
    uiState.dateTo   = toInput.value   || null;

    if (!uiState.dateFrom && !uiState.dateTo) { restoreCalendarState(); return; }

    uiState.activeTag = null;
    clearTagActive();

    const from = uiState.dateFrom ? new Date(uiState.dateFrom) : new Date(0);
    const to   = uiState.dateTo   ? new Date(uiState.dateTo + 'T23:59:59') : new Date(8640000000000000);

    const filtered = getLocalNotes()
        .filter(n => { const d = new Date(n.timestamp); return d >= from && d <= to; })
        .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

    const label = [uiState.dateFrom, uiState.dateTo].filter(Boolean).join(' → ');
    document.getElementById('selected-date-title').textContent = `Range: ${label}`;
    document.getElementById('calendar').style.display = 'grid';
    document.getElementById('llm-controls').style.display = 'none';

    const list = document.getElementById('notes-list');
    list.innerHTML = '';

    if (filtered.length === 0) {
        const p = document.createElement('p'); p.textContent = 'No entries in this range.'; list.appendChild(p);
        return;
    }
    filtered.forEach(n => list.appendChild(buildNoteCard(n, true)));
}
