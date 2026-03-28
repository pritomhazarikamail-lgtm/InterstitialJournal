/**
 * modules/draft.js — Auto-save textarea draft between sessions
 *
 * Saves the note-input content to localStorage on every keystroke so
 * accidental page refreshes don't lose work. The draft is restored on
 * init and cleared whenever a note is saved (crud.js dispatches
 * 'hide-slash-dropdown' for exactly this purpose).
 */

const DRAFT_KEY = 'note_draft';

export function initDraft() {
    const noteInput   = document.getElementById('note-input');
    const charCounter = document.getElementById('char-counter');
    if (!noteInput) return;

    // Restore saved draft (only if the textarea is still empty)
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved && !noteInput.value) {
        noteInput.value = saved;
        if (charCounter) {
            charCounter.textContent = `${saved.length} / 5000`;
            charCounter.classList.toggle('warn', saved.length >= 4500);
        }
        // Sync any slash-dropdown or draft-save listeners
        noteInput.dispatchEvent(new Event('input'));
    }

    // Persist every keystroke
    noteInput.addEventListener('input', () => {
        const val = noteInput.value;
        if (val.trim()) {
            localStorage.setItem(DRAFT_KEY, val);
        } else {
            localStorage.removeItem(DRAFT_KEY);
        }
    });

    // Clear draft when a note is saved (crud.js dispatches this after save)
    document.addEventListener('hide-slash-dropdown', () => {
        localStorage.removeItem(DRAFT_KEY);
    });
}
