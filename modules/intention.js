/**
 * modules/intention.js — Once-per-day morning intention banner + persistent anchor
 *
 * Flow:
 *  1. On first open of the day: show the banner asking for today's goal.
 *  2. On submit: save as a note, show the persistent anchor strip all day so
 *     the user can always see what they're working toward.
 *  3. "✓ Done" on the anchor saves a #achieved note and hides the anchor.
 *  4. On subsequent opens today (banner already dismissed): restore the anchor
 *     if an intention was set and not yet achieved.
 *  5. After 4 pm with 3+ notes, the AI checks whether notes show progress
 *     toward the goal and shows a one-sentence assessment in the anchor.
 *     This only runs if the AI model is already warm — zero cost otherwise.
 */

import { saveNote }          from './crud.js';
import { clearNextUp, getNextUp } from './write.js';
import { getISODate, getLocalNotes } from './storage.js';
import { showToast }         from './toast.js';

const INTENTION_KEY  = 'today_intention_text';
const ACHIEVED_KEY   = 'today_intention_achieved';

let _active = false; // prevent double-submit

export function initIntention() {
    const today = getISODate(new Date());

    // Clear stale keys from a previous day
    const lastDate = localStorage.getItem('last_intention_date');
    if (lastDate && lastDate !== today) {
        localStorage.removeItem(INTENTION_KEY);
        localStorage.removeItem(ACHIEVED_KEY);
    }

    // Restore anchor if intention was already set today and not yet achieved.
    // Falls back to scanning today's notes so goals set before this feature
    // existed (when INTENTION_KEY wasn't stored yet) still appear.
    const savedText = localStorage.getItem(INTENTION_KEY) || _findIntentionInNotes(today);
    const alreadyAchieved = localStorage.getItem(ACHIEVED_KEY)
        || _findAchievedInNotes(today);
    if (savedText && !alreadyAchieved) {
        _showAnchor(savedText);
        // Intention is pinned in the anchor strip — clear it from the textarea placeholder
        // (handles existing next_up values set before this was removed from _submit)
        const currentNextUp = getNextUp().trim();
        const looksLikeIntention = currentNextUp && (
            currentNextUp.toLowerCase() === savedText.trim().toLowerCase() ||
            /^🎯\s*today'?s intention:/i.test(currentNextUp)
        );
        if (looksLikeIntention) {
            clearNextUp();
            const noteInput = document.getElementById('note-input');
            if (noteInput) noteInput.placeholder = 'What are you working on? Use #tags or type / for commands...';
        }
    }

    // Show banner only if today hasn't been handled yet
    if (lastDate === today) return;

    const banner = document.getElementById('intention-banner');
    if (!banner) return;

    _active = false;
    banner.classList.remove('hidden');

    requestAnimationFrame(() => {
        document.getElementById('intention-input')?.focus();
    });

    const ac = new AbortController();
    document.getElementById('intention-set')
        ?.addEventListener('click', _submit, { once: true });
    document.getElementById('intention-skip')
        ?.addEventListener('click', _dismiss, { once: true });
    document.getElementById('intention-input')
        ?.addEventListener('keydown', e => {
            if (e.key === 'Enter')  { e.preventDefault(); _submit(); ac.abort(); }
            if (e.key === 'Escape') { _dismiss(); ac.abort(); }
        }, { signal: ac.signal });
}

/** Extract intention text from today's notes (fallback for pre-feature data). */
function _findIntentionInNotes(today) {
    const note = getLocalNotes().find(n =>
        n.dateKey === today && n.content.startsWith('🎯 Today\'s intention:')
    );
    if (!note) return null;
    const text = note.content
        .replace(/^🎯 Today's intention:\s*/u, '')
        .replace(/\s*#intention\b.*$/i, '')
        .trim();
    if (text) localStorage.setItem(INTENTION_KEY, text); // cache for future loads
    return text || null;
}

/** Check whether today's notes contain an intention-achieved note specifically. */
function _findAchievedInNotes(today) {
    return getLocalNotes().some(n =>
        n.dateKey === today &&
        n.tags?.includes('#achieved') &&
        n.tags?.includes('#intention')
    );
}

function _showAnchor(text) {
    const anchor   = document.getElementById('intention-anchor');
    const textEl   = document.getElementById('intention-anchor-text');
    const doneBtn  = document.getElementById('intention-anchor-done');
    if (!anchor || !textEl) return;

    textEl.textContent = text;
    anchor.classList.remove('hidden');

    doneBtn?.addEventListener('click', async () => {
        anchor.classList.add('hidden');
        localStorage.setItem(ACHIEVED_KEY, '1');
        // Clear the intention from the Next Up field and reset the textarea placeholder
        clearNextUp();
        const noteInput = document.getElementById('note-input');
        if (noteInput) noteInput.placeholder = 'What are you working on? Use #tags or type / for commands...';
        await saveNote(`✅ Achieved today's intention: ${text} #achieved #intention`);
        showToast('🎉 Intention achieved!');
    }, { once: true });
}

function _dismiss() {
    if (_active) return;
    _active = true;
    document.getElementById('intention-banner')?.classList.add('hidden');
    localStorage.setItem('last_intention_date', getISODate(new Date()));
}

async function _submit() {
    if (_active) return;
    _active = true;

    const input = document.getElementById('intention-input');
    const text  = input?.value.trim();

    document.getElementById('intention-banner')?.classList.add('hidden');
    localStorage.setItem('last_intention_date', getISODate(new Date()));

    if (!text) return;

    // Persist the text so it can be restored on reload
    localStorage.setItem(INTENTION_KEY, text);

    // Show the persistent anchor strip
    _showAnchor(text);


    await saveNote(`🎯 Today's intention: ${text} #intention #focus`);
    showToast("Intention set — let's go 🎯");
}

// When Drive sync delivers intention data from another device, update the anchor
// without requiring a page reload. drive.js dispatches this after mergeNotes.
document.addEventListener('intention-sync', () => {
    const text     = localStorage.getItem(INTENTION_KEY);
    const achieved = localStorage.getItem(ACHIEVED_KEY);
    const anchor   = document.getElementById('intention-anchor');
    if (!anchor) return;
    if (achieved) { anchor.classList.add('hidden'); return; }
    if (text) {
        const textEl = document.getElementById('intention-anchor-text');
        if (textEl) textEl.textContent = text;
        anchor.classList.remove('hidden');
    }
});
