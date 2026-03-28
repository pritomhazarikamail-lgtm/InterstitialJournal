/**
 * modules/drive.js — Google Drive sync
 *
 * Design goals:
 *  • Zero coupling to CRUD — crud.js calls markDirty(), this module does the rest.
 *  • Non-blocking — uploads happen in the background; the UI never waits on network.
 *  • Write coalescing — rapid saves are debounced into one upload (2 s window).
 *  • Token auto-refresh — proactively re-auths 5 min before expiry; no prompt needed.
 *  • Persistent driveFileId — stored in localStorage so a list call is never needed
 *    after the first successful sync.
 *  • Graceful no-sync mode — if the user never signs in, markDirty() is a no-op.
 *  • Reliable background sync — visibilitychange fires sync on tab focus;
 *    setInterval used as a fallback for long-lived tabs.
 *
 * SECURITY NOTE: CLIENT_ID is a public identifier, not a secret. It must be
 * registered in Google Cloud Console with the exact allowed origin. The
 * drive.appdata scope is strictly app-sandboxed — this app cannot read any
 * other file in the user's Drive.
 */

import {
    getLocalNotes, getDeletedIds, setLocalNotes, setDeletedIds,
    validateNote, sanitiseId,
} from './storage.js';
import { showToast } from './toast.js';
import { renderAll, showNotesForDay } from './calendar.js';
import { updateStreakUI } from './pomodoro.js';

const CLIENT_ID         = '629370111704-m36nu5qgi52071qgp0sfsbs5sa9ac80k.apps.googleusercontent.com';
const SCOPES            = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_FILE_ID_KEY = 'drive_file_id';   // localStorage key for persisted file ID
const UPLOAD_DEBOUNCE   = 2000;              // ms — coalesces rapid saves
const SYNC_INTERVAL_MS  = 5 * 60 * 1000;    // 5 min fallback interval

let tokenClient   = null;
export let accessToken = null;
// Restored from localStorage so we never need a list call after first sync
let driveFileId   = localStorage.getItem(DRIVE_FILE_ID_KEY) || null;
let syncInterval  = null;
let isSyncing     = false;

// Dirty flag — set by markDirty() on any CRUD write, cleared after upload
let _isDirty    = false;
let _uploadTimer = null;
let _refreshTimer = null;

/* ── Token management ───────────────────────────────────────────────────────
 * Instead of nulling the token after 55 min, schedule a silent refresh
 * 5 min before expiry. This keeps the session alive indefinitely as long
 * as the user has an active Google session, with no visible prompt.
 * ─────────────────────────────────────────────────────────────────────────── */

function _scheduleTokenRefresh(expiresInMs) {
    clearTimeout(_refreshTimer);
    // Refresh 5 min before expiry (minimum 0 so we don't go negative)
    const refreshIn = Math.max(0, expiresInMs - 5 * 60 * 1000);
    _refreshTimer = setTimeout(() => {
        if (tokenClient) tokenClient.requestAccessToken({ prompt: '' });
    }, refreshIn);
}

/* ── Dirty flag + debounced background upload ───────────────────────────────
 * Called by crud.js after any write. If the user isn't signed in, this is
 * a pure no-op — no overhead, no error, no UI change.
 * ─────────────────────────────────────────────────────────────────────────── */

export function markDirty() {
    _isDirty = true;
    clearTimeout(_uploadTimer);
    _uploadTimer = setTimeout(_flushIfDirty, UPLOAD_DEBOUNCE);
}

async function _flushIfDirty() {
    if (!_isDirty || !accessToken || isSyncing) return;
    _isDirty = false;
    try {
        await uploadToDrive();
    } catch (err) {
        _isDirty = true; // re-mark so the next sync opportunity retries
        console.error('Background upload failed:', err);
    }
}

/* ── GIS init ───────────────────────────────────────────────────────────────
 * Waits for the Google SDK to load, then sets up the token client.
 * For returning users (auto_sync_enabled) the silent prompt='' path
 * re-auths with no UI if the Google session is still active.
 * ─────────────────────────────────────────────────────────────────────────── */

export function initGIS() {
    if (!window.google?.accounts) { setTimeout(initGIS, 500); return; }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response) => {
            if (response.error) {
                // interaction_required / access_denied means the user's Google
                // session has expired — they need to tap Sync once to re-auth.
                // Don't spam; just reset to the default cloud icon silently.
                if (response.error === 'interaction_required' ||
                    response.error === 'access_denied') {
                    accessToken = null;
                    updateSyncUI('☁️', 'Sync');
                } else {
                    updateSyncUI('❌', 'Auth Error');
                }
                return;
            }

            accessToken = response.access_token;

            // expires_in is in seconds per OAuth2 spec (Google sends ~3600)
            const expiresInMs = (response.expires_in ?? 3600) * 1000;
            _scheduleTokenRefresh(expiresInMs);

            await syncWithDrive();
            startPeriodicSync();
        },
    });

    // Silently restore session for returning users — no interaction required
    if (localStorage.getItem('auto_sync_enabled') === 'true') {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

/* ── Background sync triggers ───────────────────────────────────────────────
 * 1. visibilitychange — fires whenever the tab is brought back to the front.
 *    More reliable than setInterval for backgrounded/sleeping tabs.
 * 2. setInterval — fallback for long-lived foreground tabs.
 * ─────────────────────────────────────────────────────────────────────────── */

export function startPeriodicSync() {
    if (syncInterval) return;

    // Sync on tab focus (reliable even when interval is throttled)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && accessToken && !isSyncing) {
            syncWithDrive(true); // silent
        }
    });

    // Fallback interval for tabs that stay in the foreground
    syncInterval = setInterval(() => {
        if (accessToken && !isSyncing) syncWithDrive(true);
    }, SYNC_INTERVAL_MS);
}

export async function handleAuthClick() {
    if (!tokenClient) { showToast('Google Sign-In not ready yet'); return; }
    if (!accessToken) {
        const hadPrior = localStorage.getItem('auto_sync_enabled') === 'true';
        tokenClient.requestAccessToken({ prompt: hadPrior ? '' : 'select_account' });
    } else {
        await syncWithDrive();
    }
}

export function updateSyncUI(icon, text) {
    document.getElementById('sync-icon').textContent = icon;
    document.getElementById('sync-text').textContent = text;
}

/* ── API fetch wrapper ──────────────────────────────────────────────────────
 * Enforces googleapis.com as the only allowed host.
 * SECURITY: Prevents token leakage if a URL is ever constructed from
 * user-controlled data (defence in depth).
 * ─────────────────────────────────────────────────────────────────────────── */

async function apiFetch(url, method = 'GET', body, extraHeaders = {}) {
    const { hostname } = new URL(url);
    if (!hostname.endsWith('googleapis.com')) throw new Error(`Blocked: ${hostname}`);
    return fetch(url, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
        ...(body !== undefined && { body }),
    });
}

/* ── Full sync (download + upload) ─────────────────────────────────────────
 * Called on sign-in, manual tap, and by the background triggers above.
 * silent=true suppresses toasts and the UI spinner (used for background runs).
 * ─────────────────────────────────────────────────────────────────────────── */

export async function syncWithDrive(silent = false) {
    if (isSyncing) return;
    isSyncing = true;
    try {
        if (!silent) updateSyncUI('⏳', 'Syncing…');

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
            driveFileId = files[0].id;
            localStorage.setItem(DRIVE_FILE_ID_KEY, driveFileId);
            const fileRes = await apiFetch(
                `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`
            );
            if (fileRes.ok) mergeNotes(await fileRes.json());
        }

        await uploadToDrive();
        _isDirty = false; // upload just happened — clear any pending dirty flag
        localStorage.setItem('auto_sync_enabled', 'true');

        if (!silent) {
            updateSyncUI('✅', 'Synced ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            showToast('✅ Synced with Google Drive');
        }
    } catch (err) {
        console.error('Sync error:', err);
        if (!silent) {
            updateSyncUI('❌', 'Sync Error');
            showToast('Sync failed — check your connection', 4000);
        }
    } finally {
        isSyncing = false;
    }
}

/* ── Upload ─────────────────────────────────────────────────────────────────
 * Uses the persisted driveFileId to avoid a list call on every upload.
 * Falls back to a list call only if the ID is not known (first use, or
 * the file was manually deleted from Drive).
 * ─────────────────────────────────────────────────────────────────────────── */

export async function uploadToDrive() {
    if (!accessToken) return;

    // Only fall back to a list call if we genuinely don't have the file ID
    if (!driveFileId) {
        const checkRes = await apiFetch(
            `https://www.googleapis.com/drive/v3/files?q=name%3D'journal_data.json'&spaces=appDataFolder&fields=files(id)`
        );
        if (checkRes.ok) {
            const { files } = await checkRes.json();
            if (Array.isArray(files) && files.length > 0) {
                driveFileId = files[0].id;
                localStorage.setItem(DRIVE_FILE_ID_KEY, driveFileId);
            }
        }
    }

    const focusStreak = parseInt(localStorage.getItem('focus_streak') || '0', 10);
    const payload  = JSON.stringify({ notes: getLocalNotes(), deletedIds: getDeletedIds(), focusStreak });
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

    if (res.ok && !driveFileId) {
        driveFileId = (await res.json()).id;
        localStorage.setItem(DRIVE_FILE_ID_KEY, driveFileId);
    }
}

/* ── Merge ──────────────────────────────────────────────────────────────────
 * Last-writer-wins merge of local and Drive notes.
 * SECURITY: every note from Drive is validated before touching localStorage.
 * ─────────────────────────────────────────────────────────────────────────── */

export function mergeNotes(driveData) {
    const rawDriveNotes   = Array.isArray(driveData) ? driveData : (driveData?.notes ?? []);
    const rawDriveDeleted = Array.isArray(driveData) ? [] : (driveData?.deletedIds ?? []);

    // Merge focus streak — take the higher of local vs Drive (never lose progress)
    if (typeof driveData?.focusStreak === 'number') {
        const local  = parseInt(localStorage.getItem('focus_streak') || '0', 10);
        const merged = Math.max(local, driveData.focusStreak);
        localStorage.setItem('focus_streak', String(merged));
        updateStreakUI();
    }

    const driveNotes   = rawDriveNotes.map(validateNote).filter(Boolean);
    const driveDeleted = rawDriveDeleted.map(sanitiseId).filter(Boolean);

    const localNotes   = getLocalNotes();
    const localDeleted = getDeletedIds();
    const allDeleted   = new Set([...localDeleted, ...driveDeleted]);

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
