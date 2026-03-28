/**
 * modules/crud.js — Note CRUD operations and theme toggle
 */

import {
    validateNote, sanitiseId, getLocalNotes, setLocalNotes,
    getDeletedIds, setDeletedIds, getISODate,
} from './storage.js';
import { showModal }  from './modal.js';
import { showToast }  from './toast.js';
import { uploadToDrive } from './drive.js';
import { renderAll, showNotesForDay } from './calendar.js';
import { renderRecentStrip } from './write.js';
import { updateLiveTimer } from './timer.js';

export async function saveNote(manualText = null) {
    const noteInput = document.getElementById('note-input');
    const text = manualText || noteInput.value.trim();
    if (!text) return;
    if (text.length > 5000) { showToast('Note too long (max 5000 chars)'); return; }

    const newNote = validateNote({
        id:        Date.now(),
        timestamp: new Date().toISOString(),
        content:   text,
        dateKey:   getISODate(new Date()),
        tags:      (text.match(/#(\w+)/g) || []).map(t => t.toLowerCase()),
    });
    if (!newNote) return;

    const notes = getLocalNotes();
    notes.push(newNote);
    setLocalNotes(notes);

    if (!manualText) {
        const nextUpInput = document.getElementById('next-up-input');
        const charCounter = document.getElementById('char-counter');
        const nextUp = nextUpInput.value.trim();
        noteInput.value = '';
        charCounter.textContent = '0 / 5000';
        charCounter.classList.remove('warn');
        // Hide slash dropdown via custom event (slash commands live in app.js)
        document.dispatchEvent(new CustomEvent('hide-slash-dropdown'));

        if (nextUp) {
            noteInput.placeholder = nextUp;
            localStorage.setItem('next_up', nextUp.slice(0, 200));
            nextUpInput.value = '';
        } else {
            noteInput.placeholder = "What are you working on? Use #tags or type / for commands...";
            localStorage.removeItem('next_up');
        }
        renderRecentStrip();
    }

    updateLiveTimer();
    await uploadToDrive();
    showToast('Note saved ✓');
}

export async function editNote(id) {
    const safeId = sanitiseId(id);
    if (!safeId) return;
    const notes = getLocalNotes();
    const idx   = notes.findIndex(n => n.id === safeId);
    if (idx === -1) return;

    const newText = await showModal({ title: 'Edit Note', defaultValue: notes[idx].content });
    if (!newText || typeof newText !== 'string' || !newText.trim()) return;
    if (newText.length > 5000) { showToast('Note too long (max 5000 chars)'); return; }

    notes[idx].content   = newText.trim();
    notes[idx].timestamp = new Date().toISOString();
    notes[idx].tags      = (newText.match(/#(\w+)/g) || []).map(t => t.toLowerCase());
    setLocalNotes(notes);
    showNotesForDay(notes[idx].dateKey);
    await uploadToDrive();
}

export async function deleteNote(id) {
    const safeId = sanitiseId(id);
    if (!safeId) return;

    const confirmed = await showModal({
        title:   'Delete Note',
        message: 'Delete this entry permanently? This cannot be undone.',
        isDanger: true,
    });
    if (!confirmed) return;

    setLocalNotes(getLocalNotes().filter(n => n.id !== safeId));

    const delSet = new Set(getDeletedIds());
    if (!delSet.has(safeId)) { delSet.add(safeId); setDeletedIds(Array.from(delSet)); }

    renderAll();
    document.getElementById('notes-list').innerHTML = '';
    document.getElementById('selected-date-title').textContent = '';
    document.getElementById('llm-controls').style.display = 'none';
    await uploadToDrive();
    showToast('Note deleted');
}

export async function pinNote(id) {
    const safeId = sanitiseId(id);
    if (!safeId) return;
    const notes = getLocalNotes();
    const idx   = notes.findIndex(n => n.id === safeId);
    if (idx === -1) return;
    notes[idx].pinned = !notes[idx].pinned;
    setLocalNotes(notes);
    showNotesForDay(notes[idx].dateKey);
    await uploadToDrive();
    showToast(notes[idx].pinned ? '📌 Pinned' : 'Unpinned');
}

export function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('dark_mode', String(isDark));
    document.getElementById('theme-icon').textContent = isDark ? '🌙' : '☀️';
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', isDark ? '#111010' : '#f5f4f0');
}
