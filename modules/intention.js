/**
 * modules/intention.js — Once-per-day morning intention banner
 *
 * Shows a non-blocking banner above the write area on the first open
 * of each day. The user's answer is saved as a #intention #focus note
 * and pre-loaded into the Next Up field as a day-long anchor.
 */

import { saveNote }          from './crud.js';
import { setNextUp }         from './write.js';
import { getISODate }        from './storage.js';
import { showToast }         from './toast.js';

let _active = false; // prevent double-submit

export function initIntention() {
    const today    = getISODate(new Date());
    const lastDate = localStorage.getItem('last_intention_date');
    if (lastDate === today) return; // already set or skipped today

    const banner = document.getElementById('intention-banner');
    if (!banner) return;

    _active = false;
    banner.classList.remove('hidden');

    // Focus the input after the transition
    requestAnimationFrame(() => {
        document.getElementById('intention-input')?.focus();
    });

    document.getElementById('intention-set')
        ?.addEventListener('click', _submit, { once: true });
    document.getElementById('intention-skip')
        ?.addEventListener('click', _dismiss, { once: true });
    document.getElementById('intention-input')
        ?.addEventListener('keydown', e => {
            if (e.key === 'Enter')  { e.preventDefault(); _submit(); }
            if (e.key === 'Escape') _dismiss();
        });
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

    // Pre-load as the day's Next Up anchor
    setNextUp(text);
    const noteInput = document.getElementById('note-input');
    if (noteInput) noteInput.placeholder = text;

    await saveNote(`🎯 Today's intention: ${text} #intention #focus`);
    showToast("Intention set — let's go 🎯");
}
