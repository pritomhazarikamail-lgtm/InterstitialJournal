/**
 * INTERSTITIAL JOURNAL — App Orchestrator
 *
 * This file is intentionally thin. All feature logic lives in modules/:
 *
 *   state.js     — Shared UI filter state (uiState)
 *   storage.js   — Security helpers, notes cache, date/tag indices
 *   modal.js     — Custom modal (replaces prompt/confirm) + event wiring
 *   toast.js     — Ephemeral toast notifications
 *   timer.js     — Live clock + "time since last entry" nudge
 *   write.js     — Next Up field + Recent Strip
 *   drive.js     — Google Drive sync
 *   calendar.js  — Calendar heatmap, day timeline, note cards, tag cloud
 *   crud.js      — Save / edit / delete / pin + theme toggle
 *   pomodoro.js  — Focus timer, Pomodoro cycle, streak UI
 *   ai.js        — On-device AI summary via @mlc-ai/web-llm
 *   search.js    — Full-text search, tag filter, date range filter
 *   nav.js       — Page navigation, export/import
 *
 * Remaining here: slash commands (tightly coupled to the write textarea),
 * custom-event routing (note-pin / note-edit / note-delete / tag-filter),
 * and the init() entry point.
 */

import { saveNote, editNote, deleteNote, pinNote, toggleDarkMode, completeTodo, swipeDeleteNote, applyNoteEdit } from './modules/crud.js';
import { initGIS, handleAuthClick, initOfflineIndicator } from './modules/drive.js';
import { initReminders } from './modules/reminders.js';
import { initIntention }  from './modules/intention.js';
import { renderFocus, startFocus, completeFocus, abandonFocus, pomoPauseResume, updateStreakUI } from './modules/pomodoro.js';
import { changeMonth, openTagOverflow, closeTagOverflow, clearDateRange, restoreCalendarState, jumpToToday } from './modules/calendar.js';
import { generateDailySummary, initModelSelect, preloadModel, isModelReady, cleanupNote } from './modules/ai.js';
import { searchNotes, filterByTag, filterByDateRange } from './modules/search.js';
import { showPage, toggleExportMenu, exportJSON, exportMarkdown, exportPrint, importNotes } from './modules/nav.js';
import { updateLiveClock, updateLiveTimer } from './modules/timer.js';
import { initNextUp, renderRecentStrip, setNextUp, clearNextUp } from './modules/write.js';
import { pruneDeletedIds, getLocalNotes, sanitiseId, getTagIndex } from './modules/storage.js';
import { showToast } from './modules/toast.js';
import { initDraft }  from './modules/draft.js';
import { initVoice }  from './modules/voice.js';
import { showWeeklyDigest, hideWeeklyDigest } from './modules/weekly.js';

/* =============================================================================
 * SLASH COMMANDS
 * Triggered when the user types / at the start of the textarea or after \n.
 * ============================================================================= */

const SLASH_COMMANDS = [
    { cmd: '/win',   icon: '🏆', desc: 'Log a win or achievement',     prefix: '🏆 ', tag: '#win'   },
    { cmd: '/todo',  icon: '☐',  desc: 'Add a checkbox task',          prefix: '☐ ',  tag: '#todo'  },
    { cmd: '/block', icon: '🚫', desc: 'Tag a distraction or blocker', prefix: '🚫 ', tag: '#block' },
    { cmd: '/handoff', icon: '🔄', desc: 'Log a task transition (from → to)', prefix: '🔄 Switching from: ', tag: '#transition' },
    { cmd: '/focus', icon: '🎯', desc: 'Note your current focus',      prefix: '🎯 ', tag: '#focus' },
    { cmd: '/idea',  icon: '💡', desc: 'Capture a quick idea',         prefix: '💡 ', tag: '#idea'  },
    { cmd: '/note',  icon: '📝', desc: 'Plain note (no prefix)',       prefix: '',    tag: ''       },
];

const noteInput   = document.getElementById('note-input');
const charCounter = document.getElementById('char-counter');
const slashDropdown = document.getElementById('slash-dropdown');
let _slashActive  = -1;
let _slashQuery   = '';

function getSlashContext(val, pos) {
    const before = val.slice(0, pos);
    const match  = before.match(/(?:^|\n)(\/\w*)$/);
    return match ? match[1] : null;
}

function showSlashDropdown(query) {
    _slashQuery = query.toLowerCase();
    const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(_slashQuery));
    if (filtered.length === 0) { hideSlashDropdown(); return; }

    slashDropdown.innerHTML = '';
    _slashActive = 0;

    filtered.forEach((c, i) => {
        const item = document.createElement('div');
        item.className = 'slash-item' + (i === 0 ? ' slash-active' : '');
        item.setAttribute('role', 'option');
        item.dataset.index = i;

        const icon = document.createElement('span'); icon.className = 'slash-icon'; icon.textContent = c.icon;
        const cmd  = document.createElement('span'); cmd.className  = 'slash-cmd';  cmd.textContent  = c.cmd;
        const desc = document.createElement('span'); desc.className = 'slash-desc'; desc.textContent = c.desc;

        item.append(icon, cmd, desc);
        item.addEventListener('mousedown', e => { e.preventDefault(); applySlashCommand(filtered[i]); });
        slashDropdown.appendChild(item);
    });

    slashDropdown.style.display = 'block';
}

function hideSlashDropdown() {
    slashDropdown.style.display = 'none';
    slashDropdown.innerHTML = '';
    _slashActive = -1;
}

function setSlashActive(idx) {
    slashDropdown.querySelectorAll('.slash-item').forEach((el, i) =>
        el.classList.toggle('slash-active', i === idx)
    );
    _slashActive = idx;
}

function applySlashCommand(cmd) {
    const val    = noteInput.value;
    const pos    = noteInput.selectionStart;
    const before = val.slice(0, pos);
    const after  = val.slice(pos);

    const replaced = before.replace(/(?:^|\n)(\/\w*)$/, (m, trigger) =>
        m.slice(0, m.length - trigger.length) + cmd.prefix
    );

    const tagSuffix = cmd.tag && !noteInput.value.includes(cmd.tag) ? ' ' + cmd.tag : '';
    noteInput.value = replaced + after.trimEnd() + tagSuffix;

    const newPos = replaced.length;
    noteInput.setSelectionRange(newPos, newPos);
    charCounter.textContent = `${noteInput.value.length} / 5000`;
    charCounter.classList.toggle('warn', noteInput.value.length >= 4500);
    hideSlashDropdown();
    noteInput.focus();
}

// crud.js dispatches 'hide-slash-dropdown' after saving so the dropdown closes
document.addEventListener('hide-slash-dropdown', () => {
    hideSlashDropdown();
    _hideTagSuggestions();
});

/* ── Tag suggestions (vocab-based, instant, no AI) ──────────────────────── */

function _showTagSuggestions(tags, currentText) {
    const container = document.getElementById('tag-suggestions');
    if (!container) return;
    container.textContent = '';
    let shown = false;
    tags.forEach(tag => {
        if (currentText.includes(tag)) return;
        const pill = document.createElement('button');
        pill.className   = 'tag-suggestion-pill';
        pill.textContent = tag;
        pill.type        = 'button';
        pill.addEventListener('mousedown', e => {
            e.preventDefault();
            noteInput.value = (noteInput.value.trimEnd() + ' ' + tag);
            noteInput.dispatchEvent(new Event('input'));
            _hideTagSuggestions();
            noteInput.focus();
        });
        container.appendChild(pill);
        shown = true;
    });
    container.style.display = shown ? 'flex' : 'none';
}

function _hideTagSuggestions() {
    const container = document.getElementById('tag-suggestions');
    if (container) { container.textContent = ''; container.style.display = 'none'; }
}

let _tagDebounce = null;

noteInput?.addEventListener('input', () => {
    const len = noteInput.value.length;
    charCounter.textContent = `${len} / 5000`;
    charCounter.classList.toggle('warn', len >= 4500);

    const query = getSlashContext(noteInput.value, noteInput.selectionStart);
    if (query !== null) { showSlashDropdown(query); _hideTagSuggestions(); return; }
    hideSlashDropdown();

    // Vocab-based tag suggestions — instant, no AI
    clearTimeout(_tagDebounce);
    if (len < 20) { _hideTagSuggestions(); return; }
    _tagDebounce = setTimeout(() => {
        const text = noteInput.value.toLowerCase();
        const suggestions = Array.from(getTagIndex().entries())
            .sort((a, b) => b[1] - a[1])
            .map(([tag]) => tag)
            .filter(tag => !text.includes(tag))
            .slice(0, 3);
        _showTagSuggestions(suggestions, text);
    }, 400);
});

noteInput?.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { saveNote(); return; }
    if (slashDropdown.style.display === 'none') return;

    const items = slashDropdown.querySelectorAll('.slash-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault(); setSlashActive((_slashActive + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setSlashActive((_slashActive - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const idx      = Math.max(_slashActive, 0);
        const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(_slashQuery));
        if (filtered[idx]) applySlashCommand(filtered[idx]);
    } else if (e.key === 'Escape') {
        hideSlashDropdown();
    }
});

document.addEventListener('click', e => {
    if (e.target !== noteInput) hideSlashDropdown();
});

/* =============================================================================
 * CUSTOM-EVENT ROUTING
 *
 * calendar.js fires these instead of importing crud/search directly,
 * which would create circular dependencies.
 * ============================================================================= */

document.addEventListener('note-pin',          e => pinNote(e.detail.id));
document.addEventListener('note-edit',         e => editNote(e.detail.id));
document.addEventListener('note-delete',       e => deleteNote(e.detail.id));
document.addEventListener('note-complete',     e => completeTodo(e.detail.id));
document.addEventListener('tag-filter',        e => filterByTag(e.detail.tag));
document.addEventListener('note-swipe-delete', e => swipeDeleteNote(e.detail.id));

// ✨ Note cleanup — user-initiated via the ✨ button on a note card
document.addEventListener('note-cleanup', async e => {
    const { id, btn } = e.detail;
    const safeId = sanitiseId(id);
    if (!safeId) return;
    if (!isModelReady()) {
        showToast('AI not ready — open a day and click Summarize first');
        return;
    }
    const note = getLocalNotes().find(n => n.id === safeId);
    if (!note) return;
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    const cleaned = await cleanupNote(note.content);
    if (btn) { btn.disabled = false; btn.textContent = '✨'; }
    if (!cleaned || cleaned.trim() === note.content.trim()) {
        showToast('Note looks good already ✓');
        return;
    }
    await applyNoteEdit(safeId, cleaned);
    showToast('✨ Note cleaned up');
});


/* =============================================================================
 * EVENT WIRING
 *
 * All handlers via addEventListener — no inline onclick attributes.
 * Keeps the CSP tight and avoids global namespace pollution.
 * ============================================================================= */

document.getElementById('save-btn')?.addEventListener('click', () => saveNote());
document.getElementById('focus-btn')?.addEventListener('click', startFocus);
document.getElementById('complete-focus-btn')?.addEventListener('click', completeFocus);
document.getElementById('pomo-pause-btn')?.addEventListener('click', pomoPauseResume);
document.getElementById('pomo-abandon-btn')?.addEventListener('click', abandonFocus);
document.getElementById('nav-write')?.addEventListener('click', () => showPage('home-page'));
document.getElementById('nav-history')?.addEventListener('click', () => showPage('history-page'));
document.getElementById('nav-sync')?.addEventListener('click', handleAuthClick);
document.getElementById('nav-theme')?.addEventListener('click', toggleDarkMode);
document.getElementById('prev-month-btn')?.addEventListener('click', () => changeMonth(-1));
document.getElementById('next-month-btn')?.addEventListener('click', () => changeMonth(1));

// Export dropdown
document.getElementById('export-btn')?.addEventListener('click', toggleExportMenu);
document.getElementById('export-json-btn')?.addEventListener('click', exportJSON);
document.getElementById('export-md-btn')?.addEventListener('click', exportMarkdown);
document.getElementById('export-print-btn')?.addEventListener('click', exportPrint);

document.getElementById('import-file')?.addEventListener('change', importNotes);

// Date range filter
document.getElementById('date-from')?.addEventListener('change', filterByDateRange);
document.getElementById('date-to')?.addEventListener('change', filterByDateRange);
document.getElementById('date-range-clear')?.addEventListener('click', () => {
    clearDateRange();
    restoreCalendarState();
});

// Tag overflow popover
document.getElementById('tag-more-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const popover = document.getElementById('tag-overflow-popover');
    if (popover?.classList.contains('hidden')) openTagOverflow();
    else closeTagOverflow();
});

document.getElementById('tag-overflow-close')?.addEventListener('click', () => closeTagOverflow());

document.addEventListener('click', e => {
    const wrap = document.getElementById('tag-cloud-wrap');
    if (wrap && !wrap.contains(e.target)) closeTagOverflow();
});

// Debounced search
let _searchDebounce = null;
document.getElementById('search-input')?.addEventListener('input', () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(searchNotes, 160);
});

document.getElementById('summarize-btn')?.addEventListener('click', generateDailySummary);

// Jump to today
document.getElementById('today-btn')?.addEventListener('click', () => {
    showPage('history-page');
    jumpToToday();
});

// Weekly digest modal
document.getElementById('weekly-btn')?.addEventListener('click', showWeeklyDigest);
document.getElementById('weekly-overlay-close')?.addEventListener('click', hideWeeklyDigest);
document.getElementById('weekly-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('weekly-overlay')) hideWeeklyDigest();
});

// Distraction-free focus mode — button toggles; Esc also exits
(function initFocusMode() {
    const btn       = document.getElementById('focus-mode-btn');
    const noteInput = document.getElementById('note-input');
    if (!btn) return;

    function enterFocus() {
        document.body.classList.add('focus-mode');
        btn.textContent = '✕ Exit focus';
        btn.classList.add('focus-mode-btn--active');
        noteInput?.focus();
    }
    function exitFocus() {
        document.body.classList.remove('focus-mode');
        btn.textContent = '⛶ Focus';
        btn.classList.remove('focus-mode-btn--active');
    }

    btn.addEventListener('click', () => {
        document.body.classList.contains('focus-mode') ? exitFocus() : enterFocus();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) exitFocus();
    });
})();

// Keyboard navigation in day-view note list (↑ / ↓)
document.addEventListener('keydown', e => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    if (document.activeElement?.matches('input, textarea, select')) return;
    if (document.getElementById('history-page')?.classList.contains('hidden')) return;
    const cards = Array.from(document.getElementById('notes-list')?.querySelectorAll('.note-item') ?? []);
    if (!cards.length) return;
    e.preventDefault();
    const idx  = cards.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown'
        ? cards[(idx + 1) % cards.length]
        : cards[(idx - 1 + cards.length) % cards.length];
    next.setAttribute('tabindex', '0');
    next.focus();
});

// Next Up input
const nextUpInput = document.getElementById('next-up-input');
nextUpInput?.addEventListener('input', () => {
    const val = nextUpInput.value.trim();
    if (val) setNextUp(val);
    else     clearNextUp();
});

/* =============================================================================
 * INIT
 * ============================================================================= */

window.addEventListener('load', initGIS);

// PWA install prompt (Android Chrome / Edge / Samsung)
let _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem('install_dismissed')) return;
    const banner = document.getElementById('install-banner');
    if (banner) banner.style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
    _deferredInstallPrompt = null;
    const banner = document.getElementById('install-banner');
    if (banner) banner.style.display = 'none';
    showToast('App installed! 🎉 Open from your home screen.');
});

document.getElementById('install-btn')?.addEventListener('click', async () => {
    if (!_deferredInstallPrompt) return;
    _deferredInstallPrompt.prompt();
    const { outcome } = await _deferredInstallPrompt.userChoice;
    _deferredInstallPrompt = null;
    document.getElementById('install-banner').style.display = 'none';
    if (outcome === 'dismissed') localStorage.setItem('install_dismissed', '1');
});

document.getElementById('install-dismiss')?.addEventListener('click', () => {
    document.getElementById('install-banner').style.display = 'none';
    localStorage.setItem('install_dismissed', '1');
});

// iOS Safari — no beforeinstallprompt, show a one-time guide toast
(function checkiOSInstall() {
    const isIOS        = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari     = /safari/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isIOS && isSafari && !isStandalone && !localStorage.getItem('ios_install_shown')) {
        localStorage.setItem('ios_install_shown', '1');
        setTimeout(() => showToast('📲 Tap Share → "Add to Home Screen" to install', 6000), 3000);
    }
})();

(function init() {
    renderFocus();
    updateLiveTimer();
    updateLiveClock();

    // Align clock tick to the actual minute boundary so it never drifts
    (() => {
        const now = new Date();
        const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
        setTimeout(() => { updateLiveClock(); setInterval(updateLiveClock, 60000); }, msToNextMinute);
    })();

    // Non-sync users don't need tombstones older than 30 days
    if (localStorage.getItem('auto_sync_enabled') !== 'true') pruneDeletedIds(30);

    // One-time cache bust for AI outputs generated before prompt refinements (v2)
    if (localStorage.getItem('ai_prompt_version') !== '2') {
        Object.keys(localStorage)
            .filter(k => k.startsWith('ai_narrative_') || k.startsWith('ai_refl_') ||
                         k.startsWith('ai_alignment_') || k.startsWith('ai_patterns_'))
            .forEach(k => localStorage.removeItem(k));
        localStorage.setItem('ai_prompt_version', '2');
    }

    updateStreakUI();
    initNextUp();
    initDraft();
    initVoice();
    initModelSelect();
    initReminders();
    initIntention();
    initOfflineIndicator();
    // Silently re-warm the AI model if the user has previously loaded it.
    // Uses requestIdleCallback internally — zero cost if model was never used.
    preloadModel();

    // Re-render recent strip on write page
    renderRecentStrip();

    setInterval(updateLiveTimer, 30000);

    // Dark mode: default dark; respect explicit saved preference
    const saved  = localStorage.getItem('dark_mode');
    const isDark = saved === null ? true : saved !== 'false';
    document.body.classList.toggle('dark-mode', isDark);
    document.getElementById('theme-icon').textContent = isDark ? '🌙' : '☀️';
    const tcMeta = document.getElementById('theme-color-meta');
    if (tcMeta) tcMeta.setAttribute('content', isDark ? '#111010' : '#f5f4f0');

    // Service Worker registration
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/InterstitialJournal/sw.js')
            .then(reg => {
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') reg.update().catch(() => {});
                });
                reg.onupdatefound = () => {
                    const sw = reg.installing;
                    sw.onstatechange = () => {
                        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                            showToast('Update ready — tap to apply ↺', 8000);
                            document.getElementById('toast').addEventListener('click', () => {
                                sw.postMessage('SKIP_WAITING');
                                window.location.reload();
                            }, { once: true });
                        }
                    };
                };
            })
            .catch(err => console.error('SW registration failed:', err));

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) { refreshing = true; window.location.reload(); }
        });
    }
})();
