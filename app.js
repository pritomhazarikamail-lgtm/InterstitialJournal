/**
 * INTERSTITIAL JOURNAL — App Logic
 *
 * Sections:
 *   1.  Security Helpers (sanitise, validate, safeJSON)
 *   2.  Notes Cache (localStorage wrapper)
 *   3.  Custom Modal (replaces prompt() / confirm())
 *   4.  Toast
 *   5.  Config & State
 *   6.  Slash Commands
 *   7.  Next Up Field
 *   8.  Recent Strip
 *   9.  Google Drive Sync
 *  10.  Pomodoro + Focus Timer
 *  11.  CRUD (save / edit / delete / theme)
 *  12.  Calendar & History
 *  13.  AI Summary (on-device via @mlc-ai/web-llm)
 *  14.  Search & Tags
 *  15.  Navigation & Utilities
 *  16.  Event Wiring
 *  17.  Init
 */

'use strict';


/* =============================================================================
 * 1. SECURITY HELPERS
 *
 * All user content flows through these helpers. No raw user string ever
 * touches innerHTML directly — this eliminates stored XSS entirely.
 * ============================================================================= */

/** Sanitise a note ID. IDs are Date.now() integers; reject everything else. */
function sanitiseId(id) {
    const n = Number(id);
    return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

/** Validate & normalise a single note object. Returns null if malformed. */
function validateNote(note) {
    if (!note || typeof note !== 'object' || Array.isArray(note)) return null;
    const id = sanitiseId(note.id);
    if (!id) return null;
    if (typeof note.content !== 'string') return null;
    if (typeof note.timestamp !== 'string' || isNaN(Date.parse(note.timestamp))) return null;
    if (typeof note.dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(note.dateKey)) return null;
    return {
        id,
        timestamp: note.timestamp,
        content:   note.content.slice(0, 5000),
        dateKey:   note.dateKey,
        tags: Array.isArray(note.tags)
            ? note.tags.filter(t => typeof t === 'string' && /^#\w+$/.test(t)).slice(0, 20)
            : [],
    };
}

/** Safe JSON.parse — never throws. */
function safeJSON(str, fallback) {
    try { return JSON.parse(str) ?? fallback; } catch { return fallback; }
}


/* =============================================================================
 * 2. NOTES CACHE
 *
 * Avoids re-parsing localStorage on every render by caching the parsed array.
 * Cache is invalidated whenever we write back to localStorage.
 * ============================================================================= */

let _notesCache    = null;
let _notesCacheKey = '';

function getLocalNotes() {
    const raw = localStorage.getItem('journal_notes') || '[]';
    if (_notesCache !== null && _notesCacheKey === raw) return _notesCache;
    const parsed = safeJSON(raw, []);
    _notesCache    = Array.isArray(parsed) ? parsed.map(validateNote).filter(Boolean) : [];
    _notesCacheKey = raw;
    return _notesCache;
}

function _invalidateNotesCache() { _notesCache = null; _notesCacheKey = ''; }

function setLocalNotes(notes) {
    localStorage.setItem('journal_notes', JSON.stringify(notes));
    _invalidateNotesCache();
}

function getDeletedIds() {
    const raw = safeJSON(localStorage.getItem('journal_deleted_ids'), []);
    return Array.isArray(raw) ? raw.map(sanitiseId).filter(Boolean) : [];
}

function setDeletedIds(ids) { localStorage.setItem('journal_deleted_ids', JSON.stringify(ids)); }


/* =============================================================================
 * 3. CUSTOM MODAL  (replaces browser prompt() / confirm())
 * ============================================================================= */

const modalOverlay  = document.getElementById('modal-overlay');
const modalTitle    = document.getElementById('modal-title');
const modalMessage  = document.getElementById('modal-message');
const modalTextarea = document.getElementById('modal-textarea');
const modalCancel   = document.getElementById('modal-cancel');
const modalConfirm  = document.getElementById('modal-confirm');
let _modalResolve   = null;

function showModal({ title, message, defaultValue, isDanger = false }) {
    return new Promise(resolve => {
        _modalResolve = resolve;
        modalTitle.textContent = title;

        if (message) { modalMessage.textContent = message; modalMessage.classList.remove('hidden'); }
        else { modalMessage.classList.add('hidden'); }

        if (defaultValue !== undefined) {
            modalTextarea.value = defaultValue;
            modalTextarea.classList.remove('hidden');
            requestAnimationFrame(() => { modalTextarea.focus(); modalTextarea.select(); });
        } else {
            modalTextarea.classList.add('hidden');
        }

        modalConfirm.className    = `modal-btn ${isDanger ? 'modal-btn-danger' : 'modal-btn-confirm'}`;
        modalConfirm.textContent  = isDanger ? 'Delete' : 'Save';
        modalOverlay.classList.add('visible');
    });
}

function closeModal(result) {
    modalOverlay.classList.remove('visible');
    if (_modalResolve) { _modalResolve(result); _modalResolve = null; }
}

modalConfirm.addEventListener('click', () =>
    closeModal(modalTextarea.classList.contains('hidden') ? true : modalTextarea.value.trim())
);
modalCancel.addEventListener('click', () => closeModal(null));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(null); });
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('visible')) closeModal(null);
});


/* =============================================================================
 * 4. TOAST
 * ============================================================================= */

const toastEl   = document.getElementById('toast');
let _toastTimer = null;

function showToast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}


/* =============================================================================
 * 5. CONFIG & STATE
 *
 * SECURITY NOTE: CLIENT_ID is a public identifier, not a secret. It must be
 * registered in Google Cloud Console with the exact allowed origin. The
 * drive.appdata scope is strictly app-sandboxed — this app cannot read any
 * other file in the user's Drive.
 * ============================================================================= */

const CLIENT_ID = '629370111704-m36nu5qgi52071qgp0sfsbs5sa9ac80k.apps.googleusercontent.com';
const SCOPES    = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient  = null;
let accessToken  = null;    // Lives in memory only — never persisted
let driveFileId  = null;
let syncInterval = null;
let isSyncing    = false;   // Mutex: prevents concurrent overlapping syncs

let currentMonth = new Date();
let _activeTag   = null;    // currently selected tag filter, null = all

const noteInput   = document.getElementById('note-input');
const charCounter = document.getElementById('char-counter');

const getISODate = d => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
};


/* =============================================================================
 * 6. SLASH COMMANDS
 *
 * Triggered when user types / at the start of the textarea or after a newline.
 * ============================================================================= */

const SLASH_COMMANDS = [
    { cmd: '/win',   icon: '🏆', desc: 'Log a win or achievement',     prefix: '🏆 ', tag: '#win'   },
    { cmd: '/todo',  icon: '☐',  desc: 'Add a checkbox task',          prefix: '☐ ',  tag: '#todo'  },
    { cmd: '/block', icon: '🚫', desc: 'Tag a distraction or blocker', prefix: '🚫 ', tag: '#block' },
    { cmd: '/focus', icon: '🎯', desc: 'Note your current focus',      prefix: '🎯 ', tag: '#focus' },
    { cmd: '/idea',  icon: '💡', desc: 'Capture a quick idea',         prefix: '💡 ', tag: '#idea'  },
    { cmd: '/note',  icon: '📝', desc: 'Plain note (no prefix)',       prefix: '',    tag: ''       },
];

const slashDropdown = document.getElementById('slash-dropdown');
let _slashActive    = -1;
let _slashQuery     = '';

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
    const val  = noteInput.value;
    const pos  = noteInput.selectionStart;
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

noteInput.addEventListener('input', () => {
    const len = noteInput.value.length;
    charCounter.textContent = `${len} / 5000`;
    charCounter.classList.toggle('warn', len >= 4500);

    const query = getSlashContext(noteInput.value, noteInput.selectionStart);
    if (query !== null) showSlashDropdown(query);
    else hideSlashDropdown();
});

noteInput.addEventListener('keydown', e => {
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
 * 7. NEXT UP FIELD
 * ============================================================================= */

const nextUpInput = document.getElementById('next-up-input');

function getNextUp()    { return localStorage.getItem('next_up') || ''; }
function setNextUp(val) { localStorage.setItem('next_up', val.slice(0, 200)); }
function clearNextUp()  { localStorage.removeItem('next_up'); }

function initNextUp() {
    const saved = getNextUp();
    if (saved) {
        noteInput.placeholder = saved;
        nextUpInput.value     = '';
    }
}

nextUpInput.addEventListener('input', () => setNextUp(nextUpInput.value.trim()));


/* =============================================================================
 * 8. RECENT STRIP — last 3 notes shown on the write page
 * ============================================================================= */

function renderRecentStrip() {
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


/* =============================================================================
 * 9. GOOGLE DRIVE SYNC
 * ============================================================================= */

function initGIS() {
    if (!window.google?.accounts) { setTimeout(initGIS, 500); return; }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response) => {
            if (response.error) { updateSyncUI('❌', 'Auth Error'); return; }
            accessToken = response.access_token;
            // Clear token just before it expires (~1 h for Google OAuth tokens)
            setTimeout(() => { accessToken = null; }, 55 * 60 * 1000);
            await syncWithDrive();
            startPeriodicSync();
        },
    });

    // Silently restore session for returning users — no interaction required
    if (localStorage.getItem('auto_sync_enabled') === 'true') {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

function startPeriodicSync() {
    if (syncInterval) return;
    syncInterval = setInterval(async () => {
        if (accessToken && !isSyncing) await syncWithDrive(true);
    }, 3 * 60 * 1000);
}

async function handleAuthClick() {
    if (!tokenClient) { showToast('Google Sign-In not ready yet'); return; }
    if (!accessToken) {
        const hadPrior = localStorage.getItem('auto_sync_enabled') === 'true';
        tokenClient.requestAccessToken({ prompt: hadPrior ? '' : 'select_account' });
    } else {
        await syncWithDrive();
    }
}

function updateSyncUI(icon, text) {
    document.getElementById('sync-icon').textContent = icon;
    document.getElementById('sync-text').textContent = text;
}

/**
 * Thin fetch wrapper — enforces googleapis.com as the only allowed host.
 * SECURITY: Prevents token leakage if a URL were ever constructed from
 * user-controlled data (defence in depth).
 */
async function apiFetch(url, method = 'GET', body, extraHeaders = {}) {
    const { hostname } = new URL(url);
    if (!hostname.endsWith('googleapis.com')) throw new Error(`Blocked: ${hostname}`);
    return fetch(url, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
        ...(body !== undefined && { body }),
    });
}

async function syncWithDrive(silent = false) {
    if (isSyncing) return;
    isSyncing = true;
    try {
        if (!silent) updateSyncUI('⏳', 'Syncing…');

        // List files newest-first; fields param minimises payload
        const listRes = await apiFetch(
            `https://www.googleapis.com/drive/v3/files?q=name%3D'journal_data.json'&spaces=appDataFolder&fields=files(id%2CmodifiedTime)&orderBy=modifiedTime+desc`
        );
        if (!listRes.ok) throw new Error(`Drive list: ${listRes.status}`);
        const { files } = await listRes.json();

        // Purge duplicate files left by the old single-device bug
        if (Array.isArray(files) && files.length > 1) {
            await Promise.all(
                files.slice(1).map(f =>
                    apiFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}`, 'DELETE')
                )
            );
        }

        if (Array.isArray(files) && files.length > 0) {
            driveFileId    = files[0].id;
            const fileRes  = await apiFetch(
                `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`
            );
            if (fileRes.ok) mergeNotes(await fileRes.json());
        }

        await uploadToDrive();
        localStorage.setItem('auto_sync_enabled', 'true');
        if (!silent) {
            updateSyncUI('✅', 'Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            showToast('✅ Synced with Google Drive');
        }
    } catch (err) {
        console.error('Sync error:', err);
        if (!silent) updateSyncUI('❌', 'Sync Error');
    } finally {
        isSyncing = false;
    }
}

async function uploadToDrive() {
    if (!accessToken) return;

    // Avoid creating a duplicate file when driveFileId is unknown
    if (!driveFileId) {
        const checkRes = await apiFetch(
            `https://www.googleapis.com/drive/v3/files?q=name%3D'journal_data.json'&spaces=appDataFolder&fields=files(id)`
        );
        if (checkRes.ok) {
            const { files } = await checkRes.json();
            if (Array.isArray(files) && files.length > 0) driveFileId = files[0].id;
        }
    }

    const payload  = JSON.stringify({ notes: getLocalNotes(), deletedIds: getDeletedIds() });
    const metadata = driveFileId ? {} : { name: 'journal_data.json', parents: ['appDataFolder'] };
    const boundary = 'journal_sync_v1';
    const body =
        `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` + JSON.stringify(metadata) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` + payload +
        `\r\n--${boundary}--`;

    const url = driveFileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(driveFileId)}?uploadType=multipart`
        : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

    const res = await apiFetch(url, driveFileId ? 'PATCH' : 'POST', body, {
        'Content-Type': `multipart/related; boundary=${boundary}`,
    });

    if (!driveFileId && res.ok) driveFileId = (await res.json()).id;
}

function mergeNotes(driveData) {
    // Backwards-compatible with the old plain-array format
    const rawDriveNotes   = Array.isArray(driveData) ? driveData : (driveData?.notes ?? []);
    const rawDriveDeleted = Array.isArray(driveData) ? [] : (driveData?.deletedIds ?? []);

    // SECURITY: validate every note arriving from Drive before touching localStorage
    const driveNotes   = rawDriveNotes.map(validateNote).filter(Boolean);
    const driveDeleted = rawDriveDeleted.map(sanitiseId).filter(Boolean);

    const localNotes   = getLocalNotes();
    const localDeleted = getDeletedIds();
    const allDeleted   = new Set([...localDeleted, ...driveDeleted]);

    // Last-writer-wins merge
    const merged = new Map();
    [...localNotes, ...driveNotes].forEach(n => {
        const ex = merged.get(n.id);
        if (!ex || new Date(n.timestamp) > new Date(ex.timestamp)) merged.set(n.id, n);
    });
    allDeleted.forEach(id => merged.delete(id));

    setLocalNotes(Array.from(merged.values()));
    setDeletedIds(Array.from(allDeleted));

    const titleEl = document.getElementById('selected-date-title');
    if (titleEl.textContent.startsWith('Notes for ')) {
        showNotesForDay(titleEl.textContent.replace('Notes for ', '').trim());
    }
    renderAll();
}


/* =============================================================================
 * 10. POMODORO + FOCUS TIMER
 *
 * State survives PWA reloads via localStorage.
 * Keys: pomo_goal, pomo_phase (work|break|idle), pomo_end_ms,
 *       pomo_rounds, pomo_session_start, pomo_paused_remaining, focus_streak
 *
 * Ring maths: r=52, circumference = 2π×52 ≈ 326.73
 *   stroke-dashoffset = circumference × (1 − progress)  → 0=full, 326.73=empty
 * ============================================================================= */

const POMO_WORK_SECS  = 25 * 60;
const POMO_SHORT_SECS =  5 * 60;
const POMO_LONG_SECS  = 15 * 60;
const POMO_CIRC       = 326.73;   // 2π × r=52

let _pomoTick        = null;
let _pomoPhaseEnding = false;

/* ── Audio ─────────────────────────────────────────────────────────────────── */

let _audioCtx = null;

function _getAudioCtx() {
    if (!_audioCtx || _audioCtx.state === 'closed') {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

function playTone(freq = 660, dur = 0.3, type = 'sine') {
    try {
        const ctx  = _getAudioCtx();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = type; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
        osc.start(); osc.stop(ctx.currentTime + dur);
    } catch(e) {}
}

function playWorkDone()  { playTone(880, 0.15); setTimeout(() => playTone(1100, 0.25), 180); }
function playBreakDone() { playTone(660, 0.15); setTimeout(() => playTone(880,  0.25), 180); }

/* ── Streak UI ─────────────────────────────────────────────────────────────── */

function updateStreakUI() {
    const streak = Math.min(parseInt(localStorage.getItem('focus_streak') || '0', 10), 100);
    document.querySelectorAll('.streak-dot').forEach((dot, i) =>
        dot.classList.toggle('filled', i < streak)
    );
    const msg = document.getElementById('streak-message');
    if (streak >= 3) {
        msg.textContent = '🌟 Dopamine Hit! 3 in a row!';
        msg.classList.remove('hidden');
        document.getElementById('focus-section').classList.add('celebrate');
        setTimeout(() => {
            localStorage.setItem('focus_streak', '0');
            msg.classList.add('hidden');
            document.getElementById('focus-section').classList.remove('celebrate');
            updateStreakUI();
        }, 5000);
    }
}

/* ── Live clock & time nudge ───────────────────────────────────────────────── */

function updateLiveClock() {
    const dateEl = document.getElementById('live-date');
    if (!dateEl) return;
    dateEl.textContent = new Date().toLocaleDateString([], {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
}

function updateLiveTimer() {
    const nudge = document.getElementById('time-blindness-nudge');
    const notes = getLocalNotes();
    if (notes.length > 0) {
        const last = notes.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
        const mins = Math.floor((Date.now() - new Date(last.timestamp)) / 60000);
        nudge.textContent = mins < 1 ? '✨ Just logged.' : `⏳ ${mins}m since last entry.`;
    }
}

/* ── State accessors ───────────────────────────────────────────────────────── */

function pomoGetState() {
    return {
        goal:      localStorage.getItem('pomo_goal')                   || '',
        phase:     localStorage.getItem('pomo_phase')                  || 'idle',
        endMs:     parseInt(localStorage.getItem('pomo_end_ms')        || '0', 10),
        rounds:    parseInt(localStorage.getItem('pomo_rounds')        || '0', 10),
        sessStart: parseInt(localStorage.getItem('pomo_session_start') || '0', 10),
        paused:    parseInt(localStorage.getItem('pomo_paused_remaining') || '0', 10),
    };
}

function pomoSetState(patch) {
    const map = {
        goal: 'pomo_goal', phase: 'pomo_phase', endMs: 'pomo_end_ms',
        rounds: 'pomo_rounds', sessStart: 'pomo_session_start', paused: 'pomo_paused_remaining',
    };
    Object.entries(patch).forEach(([k, v]) => { if (map[k]) localStorage.setItem(map[k], String(v)); });
}

function pomoClearState() {
    ['pomo_goal','pomo_phase','pomo_end_ms','pomo_rounds',
     'pomo_session_start','pomo_paused_remaining',
     'current_focus','focus_start_time'].forEach(k => localStorage.removeItem(k));
}

function pomoDurationForPhase(phase, completedRounds) {
    if (phase === 'work')  return POMO_WORK_SECS;
    if (phase === 'break') return (completedRounds > 0 && completedRounds % 4 === 0)
                                    ? POMO_LONG_SECS : POMO_SHORT_SECS;
    return 0;
}

/* ── Tick ───────────────────────────────────────────────────────────────────── */

function pomoStopTick() {
    if (_pomoTick !== null) { clearInterval(_pomoTick); _pomoTick = null; }
}

function _setPauseBtn(isPaused) {
    const b = document.getElementById('pomo-pause-btn');
    if (!b) return;
    b.textContent   = isPaused ? '▶ Resume' : '⏸ Pause';
    b.className     = isPaused ? 'pomo-btn pomo-btn-success' : 'pomo-btn pomo-btn-ghost';
}

function pomoStartTick() {
    pomoStopTick();
    _pomoTick = setInterval(pomoTick, 1000);
    pomoTick();
}

function pomoTick() {
    const s         = pomoGetState();
    if (s.phase === 'idle') { pomoStopTick(); return; }

    const isPaused  = s.paused > 0;
    const remaining = isPaused
        ? s.paused
        : Math.max(0, Math.round((s.endMs - Date.now()) / 1000));

    pomoUpdateDisplay(s, remaining, isPaused);

    if (!isPaused && remaining === 0 && !_pomoPhaseEnding) {
        _pomoPhaseEnding = true;
        pomoStopTick();
        pomoPhaseEnd(s);
    }
}

/* ── Display ────────────────────────────────────────────────────────────────── */

function pomoUpdateDisplay(s, remaining, isPaused) {
    const ring      = document.getElementById('pomo-ring');
    const timeLabel = document.getElementById('pomo-time-label');
    const phaseEl   = document.getElementById('focus-phase-label');
    const card      = document.getElementById('focus-card');
    if (!ring) return;

    const total    = pomoDurationForPhase(s.phase, s.rounds);
    const progress = total > 0 ? (total - remaining) / total : 0;
    const offset   = POMO_CIRC * progress;

    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    timeLabel.textContent = `${mm}:${ss}`;

    ring.style.strokeDashoffset = offset;
    ring.className = `pomo-ring-fg ${s.phase}`;

    const isWork = s.phase === 'work';
    phaseEl.textContent = isPaused ? '⏸ Paused'
        : isWork ? `🍅 Work — Round ${s.rounds + 1}` : '☕ Break';
    phaseEl.className = `pomo-phase-label ${isPaused ? '' : s.phase}`;
    card.className    = `focus-card${isWork && !isPaused ? ' pomo-running'
                        : s.phase === 'break' ? ' pomo-break' : ''}`;

    // Tomato counter — shows position within current set of 4
    const toms = document.getElementById('pomo-tomatoes');
    if (toms) {
        const inCycle = s.rounds % 4;
        const show    = (inCycle === 0 && s.rounds > 0) ? 4 : inCycle;
        toms.textContent = '';
        for (let i = 0; i < 4; i++) {
            const span = document.createElement('span');
            span.textContent = i < show ? '🍅' : '⬜';
            toms.appendChild(span);
        }
    }
}

async function pomoPhaseEnd(s) {
    if (s.phase === 'work') {
        playWorkDone();
        const newRounds = s.rounds + 1;
        const dur       = Math.round((Date.now() - s.sessStart) / 60000);
        await saveNote(`🍅 Pomodoro: ${s.goal} (#focus #pomodoro — round ${newRounds}, ${dur}m total)`);
        const breakDur  = pomoDurationForPhase('break', newRounds);
        pomoSetState({ phase: 'break', rounds: newRounds, endMs: Date.now() + breakDur * 1000, paused: 0 });
        showToast(`Round ${newRounds} done — ${newRounds % 4 === 0 ? 'Long break (15 min)! 🎉' : 'Short break (5 min)! 🎉'}`, 4000);
    } else {
        playBreakDone();
        pomoSetState({ phase: 'work', endMs: Date.now() + POMO_WORK_SECS * 1000, paused: 0 });
        showToast("Break over — let's go! 🍅", 3000);
    }
    _pomoPhaseEnding = false;
    renderFocus();
    pomoStartTick();
}

/* ── Public API ─────────────────────────────────────────────────────────────── */

async function startFocus() {
    const text = noteInput.value.trim();
    if (!text) { showToast('Enter a focus goal first'); return; }
    pomoClearState();
    pomoSetState({ goal: text.slice(0, 200), phase: 'work', endMs: Date.now() + POMO_WORK_SECS * 1000, rounds: 0, sessStart: Date.now(), paused: 0 });
    noteInput.value = '';
    charCounter.textContent = '0 / 5000';
    charCounter.classList.remove('warn');
    renderFocus();
    _setPauseBtn(false);
    updateLiveTimer();
}

function pomoPauseResume() {
    const s = pomoGetState();
    if (s.phase === 'idle') return;

    if (s.paused > 0) {
        // RESUME
        pomoSetState({ endMs: Date.now() + s.paused * 1000, paused: 0 });
        _setPauseBtn(false);
        pomoStartTick();
    } else {
        // PAUSE
        const rem = Math.max(0, Math.round((s.endMs - Date.now()) / 1000));
        pomoSetState({ paused: rem });
        pomoStopTick();
        _setPauseBtn(true);
        pomoTick();
    }
}

async function completeFocus() {
    const s = pomoGetState();
    if (!s.goal) return;
    pomoStopTick();
    const totalMins = s.sessStart ? Math.round((Date.now() - s.sessStart) / 60000) : 0;
    await saveNote(`✅ Finished: ${s.goal} (#focus #pomodoro — ${s.rounds} 🍅, ${totalMins}m)`);
    localStorage.setItem('focus_streak', String(parseInt(localStorage.getItem('focus_streak') || '0', 10) + 1));
    pomoClearState();
    renderFocus();
    updateStreakUI();
}

async function abandonFocus() {
    const s = pomoGetState();
    if (!s.goal) return;
    const confirmed = await showModal({ title: 'Abandon Session?', message: `Abandon "${s.goal}"? Progress won't be saved.`, isDanger: true });
    if (!confirmed) return;
    pomoStopTick();
    pomoClearState();
    renderFocus();
    showToast('Session abandoned');
}

function renderFocus() {
    const s       = pomoGetState();
    const section = document.getElementById('focus-section');
    if (s.phase === 'idle' && !s.goal) { section.classList.add('hidden'); pomoStopTick(); return; }
    section.classList.remove('hidden');
    document.getElementById('focus-text').textContent = s.goal;
    if (s.phase !== 'idle') pomoStartTick();
    else pomoTick();
}


/* =============================================================================
 * 11. CRUD
 * ============================================================================= */

async function saveNote(manualText = null) {
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
        const nextUp = nextUpInput.value.trim();
        noteInput.value = '';
        charCounter.textContent = '0 / 5000';
        charCounter.classList.remove('warn');
        hideSlashDropdown();

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
    if (accessToken) await uploadToDrive();
    showToast('Note saved ✓');
}

async function editNote(id) {
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
    if (accessToken) await uploadToDrive();
}

async function deleteNote(id) {
    const safeId = sanitiseId(id);
    if (!safeId) return;

    const confirmed = await showModal({
        title:   'Delete Note',
        message: 'Delete this entry permanently? This cannot be undone.',
        isDanger: true,
    });
    if (!confirmed) return;

    setLocalNotes(getLocalNotes().filter(n => n.id !== safeId));

    // Tombstone for cross-device sync
    const delSet = new Set(getDeletedIds());
    if (!delSet.has(safeId)) { delSet.add(safeId); setDeletedIds(Array.from(delSet)); }

    renderAll();
    document.getElementById('notes-list').innerHTML = '';
    document.getElementById('selected-date-title').textContent = '';
    document.getElementById('llm-controls').style.display = 'none';
    if (accessToken) await uploadToDrive();
    showToast('Note deleted');
}

function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('dark_mode', String(isDark));
    document.getElementById('theme-icon').textContent = isDark ? '🌙' : '☀️';
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', isDark ? '#111010' : '#f5f4f0');
}


/* =============================================================================
 * 12. CALENDAR & HISTORY
 * ============================================================================= */

function formatDuration(ms) {
    const m = Math.floor(ms / 60000);
    return m < 1 ? '< 1m' : m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`;
}

function renderCalendar() {
    const cal   = document.getElementById('calendar');
    const month = currentMonth.getMonth();
    const year  = currentMonth.getFullYear();
    cal.innerHTML = '';
    document.getElementById('month-display').textContent =
        new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(currentMonth);

    const counts = getLocalNotes().reduce((acc, n) => {
        acc[n.dateKey] = (acc[n.dateKey] || 0) + 1; return acc;
    }, {});

    const firstDay    = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) cal.appendChild(document.createElement('div'));

    for (let d = 1; d <= daysInMonth; d++) {
        const key   = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const count = counts[key] || 0;
        const btn   = document.createElement('button');
        btn.type = 'button';
        btn.className = `calendar-day${count > 0 ? ' lvl-' + Math.min(Math.ceil(count/2), 4) : ''}`;
        btn.textContent = d;
        btn.setAttribute('aria-label', `${key}${count > 0 ? `, ${count} note${count > 1 ? 's' : ''}` : ''}`);
        btn.addEventListener('click', () => showNotesForDay(key));
        cal.appendChild(btn);
    }
}

function showNotesForDay(dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;  // SECURITY: validate format

    _activeTag = null;
    _clearTagActive();

    const list     = document.getElementById('notes-list');
    const notes    = getLocalNotes();
    const filtered = notes
        .filter(n => n.dateKey === dateKey)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    document.getElementById('selected-date-title').textContent = `Notes for ${dateKey}`;
    list.innerHTML = '';

    if (filtered.length === 0) {
        const p = document.createElement('p'); p.textContent = 'No entries.'; list.appendChild(p);
    } else {
        filtered.forEach((n, i) => {
            if (i > 0) {
                const gap   = document.createElement('div'); gap.className = 'time-gap-container';
                const badge = document.createElement('div'); badge.className = 'duration-badge';
                badge.textContent = `⏱️ ${formatDuration(new Date(n.timestamp) - new Date(filtered[i-1].timestamp))} gap`;
                gap.appendChild(badge);
                list.appendChild(gap);
            }

            const card = document.createElement('div'); card.className = 'note-item';

            const time = document.createElement('small');
            time.textContent = new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // SECURITY: text nodes only — no innerHTML for user content
            const contentDiv = document.createElement('div');
            contentDiv.style.cssText = 'margin:10px 0;font-size:1.05rem;';
            n.content.split('\n').forEach((line, li) => {
                if (li > 0) contentDiv.appendChild(document.createElement('br'));
                contentDiv.appendChild(document.createTextNode(line));
            });

            const actions = document.createElement('div'); actions.className = 'note-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'action-link edit-link'; editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => editNote(n.id));

            const delBtn = document.createElement('button');
            delBtn.className = 'action-link delete-link'; delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', () => deleteNote(n.id));

            actions.append(editBtn, delBtn);
            card.append(time, contentDiv, actions);
            list.appendChild(card);
        });
    }

    document.getElementById('llm-controls').style.display = filtered.length > 0 ? 'block' : 'none';

    // Avoid unnecessary full DOM rebuild when viewing a different month
    const [y, m] = dateKey.split('-').map(Number);
    if (currentMonth.getFullYear() === y && currentMonth.getMonth() === m - 1) renderCalendar();
}


/* =============================================================================
 * 13. AI SUMMARY — 100% On-Device via @mlc-ai/web-llm
 *
 * web-llm handles model download, caching (IndexedDB), and chat internally.
 * No manual WASM/ONNX wrangling needed — it works on any WebGPU device.
 * ============================================================================= */

let _engine      = null;
let _loadedModel = null;

function yieldToMain() {
    if (typeof scheduler !== 'undefined' && scheduler.yield) return scheduler.yield();
    return new Promise(r => setTimeout(r, 0));
}

async function loadEngine(modelId, onProgress) {
    if (_engine && _loadedModel === modelId) return _engine;
    const webllm = await import('https://esm.run/@mlc-ai/web-llm');
    if (!navigator.gpu) throw new Error('WebGPU is not supported on this browser/device.');
    _engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: report => {
            const pct = report.progress != null ? Math.round(report.progress * 100) : null;
            setDlProgress(report.text || 'Loading...', pct);
            onProgress(report);
        },
    });
    _loadedModel = modelId;
    return _engine;
}

/* ── UI helpers ─────────────────────────────────────────────────────────────── */

function setDlProgress(text, pct) {
    const wrap  = document.getElementById('dl-progress-wrap');
    const bar   = document.getElementById('dl-progress-bar');
    const label = document.getElementById('dl-progress-text');
    const pctEl = document.getElementById('dl-progress-pct');
    wrap.style.display = 'block';
    label.textContent  = text;
    if (pct != null) { bar.style.width = pct + '%'; pctEl.textContent = pct + '%'; }
    else             { bar.style.width = '100%';    pctEl.textContent = '...'; }
}

function hideDlProgress() {
    document.getElementById('dl-progress-wrap').style.display = 'none';
}

async function generateDailySummary() {
    const btn     = document.getElementById('summarize-btn');
    const status  = document.getElementById('llm-status');
    const output  = document.getElementById('daily-summary-output');
    const modelId = document.getElementById('model-select').value;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Working...';
    status.textContent = '';
    output.classList.remove('has-content');
    output.innerHTML = '';

    const noteTexts = Array.from(document.querySelectorAll('#notes-list .note-item')).map(card => {
        const time = card.querySelector('small')?.textContent || '';
        const body = card.querySelector('div')?.textContent   || '';
        return `[${time}] ${body.trim()}`;
    }).filter(Boolean);

    if (noteTexts.length === 0) {
        status.textContent = 'No notes found for this day.';
        btn.disabled = false; btn.textContent = 'Summarize';
        return;
    }

    try {
        setDlProgress('Loading model...', 0);
        await yieldToMain();

        const engine = await loadEngine(modelId, () => {});
        hideDlProgress();
        status.textContent = 'Generating summary...';
        await yieldToMain();

        const joined    = noteTexts.map((t, i) => `${i + 1}. ${t}`).join('\n');
        const truncated = joined.length > 1500 ? joined.slice(0, 1500) + '...' : joined;
        const isSmall   = modelId.startsWith('SmolLM');

        if (isSmall) {
            // SmolLM2 360M is too small for structured output — use plain reflection prompt
            const reply = await engine.chat.completions.create({
                messages:    [{ role: 'user', content: 'Here are my journal notes from today:\n' + truncated + '\n\nWrite a short, warm reflection on this day in 2-3 sentences.' }],
                max_tokens:  120,
                temperature: 0.4,
            });
            renderSummary({ wins: [], themes: [], reflection: (reply.choices[0].message.content || '').trim(), note_count: noteTexts.length }, output);
        } else {
            // Llama 3.2 1B — full structured output
            const reply = await engine.chat.completions.create({
                messages: [
                    { role: 'system', content: 'You are a warm, concise life coach. When given journal notes, respond with exactly three sections using these exact labels:\nWINS: (up to 4 completed tasks, one per line)\nTHEMES: (2-4 one-word tags, comma-separated)\nREFLECTION: (one encouraging sentence about the day)\nNo preamble. No extra text.' },
                    { role: 'user',   content: 'Here are my journal notes from today:\n' + truncated },
                ],
                max_tokens:  200,
                temperature: 0.2,
            });

            const fullText = (reply.choices[0].message.content || '').trim();

            function extractSection(label, text) {
                const re = new RegExp(label + ':\\s*([\\s\\S]*?)(?=\\n[A-Z]{2,}:|$)', 'i');
                const m  = text.match(re);
                return m ? m[1].trim() : '';
            }

            const wins = extractSection('WINS', fullText)
                .split('\n')
                .map(s => s.replace(/^[\s\d.\-*•]+/, '').trim())
                .filter(s => s.length > 3 && s.length < 120)
                .slice(0, 4);

            const themes = extractSection('THEMES', fullText)
                .split(/,|\n/)
                .map(s => s.replace(/[#.'"[\]\d]/g, '').trim().toLowerCase())
                .filter(s => s.length > 1 && s.length < 25)
                .slice(0, 5);

            const reflection = extractSection('REFLECTION', fullText).slice(0, 350) || fullText.slice(0, 350);

            renderSummary({ wins, themes, reflection, note_count: noteTexts.length }, output);
        }
        status.textContent = '';

    } catch (err) {
        hideDlProgress();
        status.textContent = 'Error: ' + (err.message || String(err));
        console.error('AI summary error:', err);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Summarize';
    }
}

function renderSummary(data, container) {
    container.innerHTML = '';
    container.classList.add('has-content');

    function makeSection(emoji, label, buildFn) {
        const sec = document.createElement('div'); sec.className = 'summary-section';
        const lbl = document.createElement('div'); lbl.className = 'summary-label';
        lbl.textContent = `${emoji}  ${label}`;
        sec.appendChild(lbl);
        buildFn(sec);
        container.appendChild(sec);
    }

    function toStr(v) {
        if (typeof v === 'string') return v.trim();
        if (v && typeof v === 'object') return String(Object.values(v)[0] || '').trim();
        return '';
    }

    const wins = (Array.isArray(data.wins) ? data.wins : []).map(toStr).filter(s => s.length > 2);
    if (wins.length) {
        makeSection('🏆', 'Wins', sec => {
            const wrap = document.createElement('div'); wrap.className = 'summary-wins';
            wins.forEach(w => {
                const el = document.createElement('div'); el.className = 'summary-win-item';
                el.textContent = w.slice(0, 150); wrap.appendChild(el);
            });
            sec.appendChild(wrap);
        });
    }

    const themes = (Array.isArray(data.themes) ? data.themes : []).map(toStr).filter(s => s.length > 1);
    if (themes.length) {
        makeSection('🗂', 'Themes', sec => {
            const wrap = document.createElement('div'); wrap.className = 'summary-themes';
            themes.forEach(t => {
                const chip = document.createElement('span'); chip.className = 'summary-theme-chip';
                chip.textContent = t.slice(0, 25); wrap.appendChild(chip);
            });
            sec.appendChild(wrap);
        });
    }

    const refl = typeof data.reflection === 'string' ? data.reflection.trim() : '';
    if (refl) {
        makeSection('💭', 'Reflection', sec => {
            const el = document.createElement('div'); el.className = 'summary-focus-text';
            el.textContent = refl.slice(0, 400); sec.appendChild(el);
        });
    }

    const foot = document.createElement('div');
    foot.style.cssText = 'font-size:0.72rem;color:var(--muted);margin-top:14px;text-align:right;';
    const nc = Number.isFinite(Number(data.note_count)) ? Number(data.note_count) : '?';
    foot.textContent = `Based on ${nc} note${nc !== 1 ? 's' : ''} · 100% on-device`;
    container.appendChild(foot);
}


/* =============================================================================
 * 14. SEARCH & TAGS
 * ============================================================================= */

function searchNotes() {
    const rawQuery = document.getElementById('search-input').value.slice(0, 200);
    const query    = rawQuery.toLowerCase();
    const list     = document.getElementById('notes-list');
    const cal      = document.getElementById('calendar');
    const title    = document.getElementById('selected-date-title');

    if (!query) {
        cal.style.display = 'grid'; list.innerHTML = ''; title.textContent = ''; return;
    }

    cal.style.display  = 'none';
    title.textContent  = `Search: "${rawQuery.slice(0, 50)}"`;

    const filtered = getLocalNotes()
        .filter(n => n.content.toLowerCase().includes(query))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    list.innerHTML = '';
    filtered.forEach(n => {
        const card = document.createElement('div'); card.className = 'note-item';
        const dateEl = document.createElement('small'); dateEl.textContent = n.dateKey;

        // SECURITY: Highlight via DOM manipulation — never string replace + innerHTML
        const contentDiv = document.createElement('div');
        const lower = n.content.toLowerCase();
        let last = 0, pos;
        while ((pos = lower.indexOf(query, last)) !== -1) {
            if (pos > last) contentDiv.appendChild(document.createTextNode(n.content.slice(last, pos)));
            const mark = document.createElement('mark'); mark.textContent = n.content.slice(pos, pos + query.length);
            contentDiv.appendChild(mark);
            last = pos + query.length;
        }
        if (last < n.content.length) contentDiv.appendChild(document.createTextNode(n.content.slice(last)));

        card.append(dateEl, contentDiv);
        list.appendChild(card);
    });

    if (filtered.length === 0) {
        const p = document.createElement('p'); p.textContent = 'No notes match your search.'; list.appendChild(p);
    }
}

function renderTagCloud() {
    const cloud        = document.getElementById('tag-cloud');
    const moreBtn      = document.getElementById('tag-more-btn');
    const overflowList = document.getElementById('tag-overflow-list');

    cloud.innerHTML        = '';
    cloud.style.paddingRight = '';
    overflowList.innerHTML = '';
    moreBtn.classList.add('hidden');
    moreBtn.style.top  = '';
    moreBtn.style.right = '';

    const freq = {};
    getLocalNotes().forEach(n => (n.tags || []).forEach(t => { freq[t] = (freq[t] || 0) + 1; }));
    const tags = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
    if (tags.length === 0) return;

    tags.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'tag'; btn.textContent = t;
        btn.addEventListener('click', () => { filterByTag(t); closeTagOverflow(); });
        cloud.appendChild(btn);
    });

    requestAnimationFrame(() => {
        cloud.style.maxHeight = 'none';
        void cloud.offsetHeight;

        const allBtns   = Array.from(cloud.querySelectorAll('.tag'));
        if (allBtns.length === 0) { cloud.style.maxHeight = ''; return; }

        const rowH      = allBtns[0].offsetHeight;
        const gap       = 6;
        const twoRowCap = rowH + gap + rowH;
        const overflow1 = allBtns.filter(b => b.offsetTop >= twoRowCap);

        if (overflow1.length === 0) { cloud.style.maxHeight = ''; return; }

        // Measure pill width off-screen before positioning
        moreBtn.textContent      = `＋${overflow1.length}`;
        moreBtn.style.visibility = 'hidden';
        moreBtn.classList.remove('hidden');
        void moreBtn.offsetHeight;
        const pillW = moreBtn.offsetWidth;
        const pillH = moreBtn.offsetHeight;
        moreBtn.style.visibility = '';

        // Reserve space so row-2 tags don't slide under the pill
        cloud.style.paddingRight = (pillW + gap) + 'px';
        void cloud.offsetHeight;

        // Re-measure overflow with padding applied
        const finalOverflow = allBtns.filter(b => b.offsetTop >= twoRowCap);
        finalOverflow.forEach(btn => {
            const copy = document.createElement('button');
            copy.className = 'tag'; copy.textContent = btn.textContent;
            copy.addEventListener('click', () => { filterByTag(btn.textContent); closeTagOverflow(); });
            overflowList.appendChild(copy);
        });

        moreBtn.textContent = `＋${finalOverflow.length}`;
        moreBtn.style.top   = (cloud.offsetTop + rowH + gap + rowH - pillH) + 'px';
        moreBtn.style.right = '0px';
        cloud.style.maxHeight = '';
    });
}

function openTagOverflow() {
    document.getElementById('tag-overflow-popover').classList.remove('hidden');
    document.getElementById('tag-more-btn').classList.add('active');
    document.getElementById('tag-more-btn').setAttribute('aria-expanded', 'true');
}

function closeTagOverflow() {
    document.getElementById('tag-overflow-popover').classList.add('hidden');
    document.getElementById('tag-more-btn').classList.remove('active');
    document.getElementById('tag-more-btn').setAttribute('aria-expanded', 'false');
}

function filterByTag(tag) {
    if (!/^#\w+$/.test(tag)) return; // SECURITY: re-validate

    if (_activeTag === tag) {
        _activeTag = null;
        _clearTagActive();
        _restoreCalendarState();
        return;
    }

    _activeTag = tag;
    _clearTagActive();
    document.querySelectorAll('#tag-cloud .tag, #tag-overflow-list .tag').forEach(btn => {
        if (btn.textContent.trim() === tag) btn.classList.add('tag--active');
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

function _clearTagActive() {
    document.querySelectorAll('.tag--active').forEach(b => b.classList.remove('tag--active'));
}

function _restoreCalendarState() {
    document.getElementById('calendar').style.display = 'grid';
    document.getElementById('selected-date-title').textContent = '';
    document.getElementById('notes-list').innerHTML = '';
    document.getElementById('llm-controls').style.display = 'none';
}


/* =============================================================================
 * 15. NAVIGATION & UTILITIES
 * ============================================================================= */

function showPage(pageId) {
    if (!['home-page', 'history-page'].includes(pageId)) return;
    document.getElementById('home-page').classList.toggle('hidden', pageId !== 'home-page');
    document.getElementById('history-page').classList.toggle('hidden', pageId !== 'history-page');
    document.getElementById('nav-write').classList.toggle('active', pageId === 'home-page');
    document.getElementById('nav-history').classList.toggle('active', pageId === 'history-page');

    if (pageId === 'history-page') {
        _activeTag = null;
        _clearTagActive();
        renderAll();
        document.getElementById('notes-list').innerHTML = '';
        document.getElementById('llm-controls').style.display = 'none';
        document.getElementById('selected-date-title').textContent = '';
        document.getElementById('calendar').style.display = 'grid';
    }
    if (pageId === 'home-page') renderRecentStrip();
}

function renderAll() { renderTagCloud(); renderCalendar(); }
function changeMonth(dir) { currentMonth.setMonth(currentMonth.getMonth() + dir); renderCalendar(); }

function exportNotes() {
    const blob = new Blob([JSON.stringify(getLocalNotes(), null, 2)], { type: 'application/json' });
    const a    = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: `journal-${getISODate(new Date())}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}

function importNotes(e) {
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
    reader.readAsText(file);
}


/* =============================================================================
 * 16. EVENT WIRING
 *
 * All handlers via addEventListener — no inline onclick attributes.
 * Keeps the CSP tight and avoids global namespace pollution.
 * ============================================================================= */

document.getElementById('save-btn').addEventListener('click', () => saveNote());
document.getElementById('focus-btn').addEventListener('click', startFocus);
document.getElementById('complete-focus-btn').addEventListener('click', completeFocus);
document.getElementById('pomo-pause-btn').addEventListener('click', pomoPauseResume);
document.getElementById('pomo-abandon-btn').addEventListener('click', abandonFocus);
document.getElementById('nav-write').addEventListener('click', () => showPage('home-page'));
document.getElementById('nav-history').addEventListener('click', () => showPage('history-page'));
document.getElementById('nav-sync').addEventListener('click', handleAuthClick);
document.getElementById('nav-theme').addEventListener('click', toggleDarkMode);
document.getElementById('prev-month-btn').addEventListener('click', () => changeMonth(-1));
document.getElementById('next-month-btn').addEventListener('click', () => changeMonth(1));
document.getElementById('export-btn').addEventListener('click', exportNotes);
document.getElementById('import-file').addEventListener('change', importNotes);

document.getElementById('tag-more-btn').addEventListener('click', e => {
    e.stopPropagation();
    const popover = document.getElementById('tag-overflow-popover');
    if (popover.classList.contains('hidden')) openTagOverflow();
    else closeTagOverflow();
});

document.getElementById('tag-overflow-close').addEventListener('click', () => closeTagOverflow());

document.addEventListener('click', e => {
    const wrap = document.getElementById('tag-cloud-wrap');
    if (wrap && !wrap.contains(e.target)) closeTagOverflow();
});

// Debounce search: avoids scanning all notes on every keystroke
let _searchDebounce = null;
document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(searchNotes, 160);
});

document.getElementById('summarize-btn').addEventListener('click', generateDailySummary);

document.getElementById('model-select').addEventListener('change', function () {
    const opt  = this.options[this.selectedIndex];
    const size = opt.getAttribute('data-size') || '';
    document.getElementById('model-dl-note').textContent = `⬇️ ${size} download once, then runs offline forever.`;
    _engine = null;
    _loadedModel = null;
    document.getElementById('daily-summary-output').innerHTML = '';
    document.getElementById('daily-summary-output').classList.remove('has-content');
    document.getElementById('llm-status').textContent = '';
    hideDlProgress();
});


/* =============================================================================
 * 17. INIT
 * ============================================================================= */

window.addEventListener('load', initGIS);

/* ── PWA Install Prompt (Android Chrome / Edge / Samsung) ── */
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

// iOS Safari — no beforeinstallprompt, so show a one-time guide toast
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

    updateStreakUI();
    initNextUp();
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
                // Check for updates whenever the page is re-focused
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