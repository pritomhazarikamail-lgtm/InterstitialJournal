/**
 * modules/crud.js — Note CRUD operations and theme toggle
 *
 * Sync is intentionally decoupled: after any write we call markDirty()
 * and return immediately. drive.js flushes the upload in the background
 * after a 2-second debounce. If the user is not signed in, markDirty()
 * is a no-op with zero overhead.
 */

import {
    validateNote, sanitiseId, getLocalNotes, setLocalNotes,
    getDeletedIds, setDeletedIds, getISODate,
} from './storage.js';
import { showModal }  from './modal.js';
import { showToast, showUndoToast }  from './toast.js';
import { markDirty }  from './drive.js';
import { haptic }     from './haptic.js';
import { renderAll, showNotesForDay } from './calendar.js';
import { renderRecentStrip, setNextUp, clearNextUp } from './write.js';
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

    // Always clear draft (covers both manual and programmatic saves like completeTodo)
    document.dispatchEvent(new CustomEvent('hide-slash-dropdown'));

    // Signal orchestrator for mood classification (fire-and-forget, no cost if AI not warm)
    document.dispatchEvent(new CustomEvent('note-saved', {
        detail: { id: newNote.id, content: newNote.content },
    }));

    if (!manualText) {
        const nextUpInput = document.getElementById('next-up-input');
        const charCounter = document.getElementById('char-counter');
        const nextUp = nextUpInput.value.trim();
        noteInput.value = '';
        charCounter.textContent = '0 / 5000';
        charCounter.classList.remove('warn');

        if (nextUp) {
            noteInput.placeholder = nextUp;
            setNextUp(nextUp);
            nextUpInput.value = '';
        } else {
            noteInput.placeholder = "What are you working on? Use #tags or type / for commands...";
            clearNextUp();
        }
        renderRecentStrip();
    }

    updateLiveTimer();
    markDirty();
    haptic([8]);
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
    markDirty();
}

/**
 * Silent edit — applies new content without a modal.
 * Used by the AI note cleanup feature in app.js.
 */
export async function applyNoteEdit(id, newContent) {
    const safeId = sanitiseId(id);
    if (!safeId || typeof newContent !== 'string' || !newContent.trim()) return;
    if (newContent.length > 5000) return;
    const notes = getLocalNotes();
    const idx   = notes.findIndex(n => n.id === safeId);
    if (idx === -1) return;
    notes[idx].content   = newContent.trim();
    notes[idx].timestamp = new Date().toISOString();
    notes[idx].tags      = (newContent.match(/#(\w+)/g) || []).map(t => t.toLowerCase());
    setLocalNotes(notes);
    showNotesForDay(notes[idx].dateKey);
    markDirty();
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
    markDirty();
    haptic([20, 40, 20]);
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
    markDirty();
    haptic([5]);
    showToast(notes[idx].pinned ? '📌 Pinned' : 'Unpinned');
}

export async function completeTodo(id) {
    const safeId = sanitiseId(id);
    if (!safeId) return;
    const notes = getLocalNotes();
    const note  = notes.find(n => n.id === safeId);
    if (!note || !note.content.startsWith('☐')) return;

    // Strip the checkbox and any trailing #todo tag to get clean task text
    const taskText = note.content
        .replace(/^☐\s*/, '')
        .replace(/\s*#todo\b/gi, '')
        .trim();

    await saveNote(`✅ Done: ${taskText} #done`);
}

/**
 * Swipe-to-delete: removes the note visually immediately, then shows a
 * 5-second undo window. Only adds the tombstone after the undo window expires.
 * Called from app.js on the 'note-swipe-delete' custom event.
 */
export function swipeDeleteNote(id) {
    const safeId = sanitiseId(id);
    if (!safeId) return;
    const notes   = getLocalNotes();
    const idx     = notes.findIndex(n => n.id === safeId);
    if (idx === -1) return;

    const deletedNote = notes[idx];
    setLocalNotes(notes.filter(n => n.id !== safeId));
    renderAll();
    // Refresh the open day view so the card disappears immediately
    const titleEl = document.getElementById('selected-date-title');
    if (titleEl?.textContent?.startsWith('Notes for ')) {
        showNotesForDay(titleEl.textContent.replace('Notes for ', '').trim());
    }
    haptic([15, 30]);

    let undone = false;
    showUndoToast('Note deleted', () => {
        undone = true;
        const current = getLocalNotes();
        current.push(deletedNote);
        setLocalNotes(current);
        renderAll();
        // Restore the note back into the day view
        if (titleEl?.textContent?.startsWith('Notes for ')) {
            showNotesForDay(titleEl.textContent.replace('Notes for ', '').trim());
        }
        showToast('Restored ↺');
    }, 5000);

    // After undo window: permanently tombstone so Drive sync propagates deletion
    setTimeout(() => {
        if (!undone) {
            const delSet = new Set(getDeletedIds());
            delSet.add(safeId);
            setDeletedIds(Array.from(delSet));
            markDirty();
        }
    }, 5200);
}

export function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('dark_mode', String(isDark));
    document.getElementById('theme-icon').textContent = isDark ? '🌙' : '☀️';
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', isDark ? '#111010' : '#f5f4f0');
}
