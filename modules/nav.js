/**
 * modules/nav.js — Page navigation, export/import, recent strip integration
 */

import { getLocalNotes, setLocalNotes, validateNote, safeJSON, getISODate } from './storage.js';
import { uiState } from './state.js';
import { renderAll, clearTagActive, clearDateRange, restoreCalendarState } from './calendar.js';
import { renderRecentStrip } from './write.js';
import { showToast } from './toast.js';

export function showPage(pageId) {
    if (!['home-page', 'history-page'].includes(pageId)) return;
    document.getElementById('home-page').classList.toggle('hidden', pageId !== 'home-page');
    document.getElementById('history-page').classList.toggle('hidden', pageId !== 'history-page');
    document.getElementById('nav-write').classList.toggle('active', pageId === 'home-page');
    document.getElementById('nav-history').classList.toggle('active', pageId === 'history-page');

    if (pageId === 'history-page') {
        uiState.activeTag = null;
        clearTagActive();
        clearDateRange();
        renderAll();
        document.getElementById('notes-list').innerHTML = '';
        document.getElementById('llm-controls').style.display = 'none';
        document.getElementById('selected-date-title').textContent = '';
        document.getElementById('calendar').style.display = 'grid';
    }
    if (pageId === 'home-page') renderRecentStrip();
}

/* ── Export ─────────────────────────────────────────────────────────────────── */

export function toggleExportMenu() {
    const menu = document.getElementById('export-menu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) {
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!document.getElementById('export-menu-wrap')?.contains(e.target)) {
                    menu.classList.add('hidden');
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 0);
    }
}

export function exportJSON() {
    document.getElementById('export-menu').classList.add('hidden');
    const blob = new Blob([JSON.stringify(getLocalNotes(), null, 2)], { type: 'application/json' });
    const a    = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: `journal-${getISODate(new Date())}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}

export function exportMarkdown() {
    document.getElementById('export-menu').classList.add('hidden');
    const notes = getLocalNotes()
        .slice()
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const byDate = {};
    notes.forEach(n => {
        if (!byDate[n.dateKey]) byDate[n.dateKey] = [];
        byDate[n.dateKey].push(n);
    });

    const lines = ['# Interstitial Journal\n'];
    Object.keys(byDate).sort().forEach(date => {
        lines.push(`## ${date}\n`);
        byDate[date].forEach(n => {
            const time = new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const pin  = n.pinned ? ' 📌' : '';
            lines.push(`**${time}**${pin}  `);
            lines.push(n.content);
            lines.push('');
        });
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a    = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: `journal-${getISODate(new Date())}.md`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}

export function exportPrint() {
    document.getElementById('export-menu').classList.add('hidden');
    window.print();
}

export function importNotes(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10_000_000) { showToast('File too large (max 10 MB)'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
        const parsed = safeJSON(ev.target.result, null);
        if (!Array.isArray(parsed)) { showToast('Invalid journal file'); return; }
        const valid = parsed.map(validateNote).filter(Boolean);
        if (valid.length === 0) { showToast('No valid notes found'); return; }
        setLocalNotes(valid);
        renderAll();
        showToast(`Imported ${valid.length} notes ✓`);
        e.target.value = '';
    };
    reader.onerror = () => showToast('Failed to read file');
    reader.readAsText(file);
}
