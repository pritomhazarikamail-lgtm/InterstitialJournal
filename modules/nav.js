/**
 * modules/nav.js — Page navigation, export/import, recent strip integration
 */

import { getLocalNotes, setLocalNotes, getDeletedIds, validateNote, safeJSON, getISODate } from './storage.js';
import { uiState } from './state.js';
import { renderAll, clearTagActive, clearDateRange, restoreCalendarState } from './calendar.js';
import { renderRecentStrip } from './write.js';
import { showToast } from './toast.js';
import { showModal } from './modal.js';

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

let _exportMenuAC = null;
export function toggleExportMenu() {
    const menu = document.getElementById('export-menu');
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) {
        _exportMenuAC?.abort();
        _exportMenuAC = new AbortController();
        setTimeout(() => {
            document.addEventListener('click', e => {
                if (!document.getElementById('export-menu-wrap')?.contains(e.target)) {
                    menu.classList.add('hidden');
                    _exportMenuAC?.abort();
                }
            }, { signal: _exportMenuAC.signal });
        }, 0);
    } else {
        _exportMenuAC?.abort();
    }
}

export function exportJSON() {
    document.getElementById('export-menu').classList.add('hidden');
    const blob = new Blob([JSON.stringify(getLocalNotes(), null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href, download: `journal-${getISODate(new Date())}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
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
    const href = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href, download: `journal-${getISODate(new Date())}.md` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function exportPrint() {
    document.getElementById('export-menu').classList.add('hidden');
    window.print();
}

export async function importNotes(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10_000_000) { showToast('File too large (max 10 MB)'); return; }

    const reader = new FileReader();
    reader.onload = async ev => {
        const parsed = safeJSON(ev.target.result, null);
        if (!Array.isArray(parsed)) { showToast('Invalid journal file'); e.target.value = ''; return; }
        const incoming = parsed.map(validateNote).filter(Boolean);
        if (incoming.length === 0) { showToast('No valid notes found'); e.target.value = ''; return; }

        const confirmed = await showModal({
            title:       'Import Notes',
            message:     `Merge ${incoming.length} note${incoming.length !== 1 ? 's' : ''} into your journal? Existing notes are preserved — only newer versions overwrite older ones.`,
            confirmText: 'Merge',
        });
        if (!confirmed) { e.target.value = ''; return; }

        // Last-writer-wins merge — identical strategy to Drive sync,
        // including tombstone filter so deliberately deleted notes don't resurface
        const existing  = getLocalNotes();
        const deleted   = new Set(getDeletedIds());
        const merged    = new Map(existing.map(n => [n.id, n]));
        incoming.forEach(n => {
            if (deleted.has(n.id)) return;          // skip tombstoned notes
            const ex = merged.get(n.id);
            if (!ex || new Date(n.timestamp) > new Date(ex.timestamp)) merged.set(n.id, n);
        });
        setLocalNotes(Array.from(merged.values()));
        renderAll();
        showToast(`Merged ${incoming.length} note${incoming.length !== 1 ? 's' : ''} ✓`);
        e.target.value = '';
    };
    reader.onerror = () => showToast('Failed to read file');
    reader.readAsText(file);
}
