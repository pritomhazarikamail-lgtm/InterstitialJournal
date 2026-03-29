/**
 * modules/drive.js — Google Drive sync
 *
 * FIX: Silent re-auth on page load now uses prompt:'' and only triggers if
 * auto_sync_enabled is true. On interaction_required / access_denied the
 * auto_sync_enabled flag is cleared so the popup never fires again
 * automatically — the user must tap Sync explicitly to reconnect.
 * This prevents the "open app → Google login window" loop.
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
const DRIVE_FILE_ID_KEY = 'drive_file_id';
const UPLOAD_DEBOUNCE   = 2000;
const SYNC_INTERVAL_MS  = 5 * 60 * 1000;

let tokenClient   = null;
export let accessToken = null;
let _userEmail    = null;
let driveFileId   = localStorage.getItem(DRIVE_FILE_ID_KEY) || null;
let syncInterval  = null;
let isSyncing     = false;
let _visibilityListenerAdded = false;

let _isDirty    = false;
let _uploadTimer = null;
let _refreshTimer = null;

export function getUserEmail()    { return _userEmail; }
export function isAuthenticated() { return !!accessToken; }

export function disconnectDrive() {
    if (accessToken && window.google?.accounts?.oauth2) {
        google.accounts.oauth2.revoke(accessToken, () => {});
    }
    accessToken = null;
    _userEmail  = null;
    clearTimeout(_refreshTimer);
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
    localStorage.removeItem('auto_sync_enabled');
    updateSyncUI('☁️', 'Sync');
    document.dispatchEvent(new CustomEvent('drive-auth-changed', { detail: { authenticated: false, email: null } }));
}

async function _fetchUserEmail() {
    try {
        const res = await apiFetch('https://www.googleapis.com/oauth2/v3/userinfo');
        if (res.ok) {
            const data = await res.json();
            _userEmail = (data.email && typeof data.email === 'string')
                ? data.email.slice(0, 200) : null;
            document.dispatchEvent(new CustomEvent('drive-auth-changed', {
                detail: { authenticated: true, email: _userEmail },
            }));
        }
    } catch (e) { /* silent — email is cosmetic */ }
}

/* ── Token management ─────────────────────────────────────────────────────── */

function _scheduleTokenRefresh(expiresInMs) {
    clearTimeout(_refreshTimer);
    const refreshIn = Math.max(0, expiresInMs - 5 * 60 * 1000);
    _refreshTimer = setTimeout(() => {
        // Silent refresh only — never show a popup automatically
        if (tokenClient) tokenClient.requestAccessToken({ prompt: '' });
    }, refreshIn);
}

/* ── Dirty flag + debounced background upload ─────────────────────────────── */

export function markDirty() {
    if (!accessToken) return;
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
        _isDirty = true;
        console.error('Background upload failed:', err);
    }
}

/* ── GIS init ─────────────────────────────────────────────────────────────── */

let _gisRetries = 0;
export function initGIS() {
    if (!window.google?.accounts) {
        if (++_gisRetries < 20) setTimeout(initGIS, 500);
        return;
    }
    _gisRetries = 0;

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response) => {
            if (response.error) {
                if (response.error === 'interaction_required' ||
                    response.error === 'access_denied') {
                    // *** KEY FIX: clear auto_sync so we never auto-prompt again ***
                    // The user must tap Sync manually to reconnect.
                    localStorage.removeItem('auto_sync_enabled');
                    accessToken = null;
                    updateSyncUI('☁️', 'Sync');
                } else {
                    updateSyncUI('❌', 'Auth Error');
                }
                return;
            }

            accessToken = response.access_token;
            _fetchUserEmail();
            const expiresInMs = (response.expires_in ?? 3600) * 1000;
            _scheduleTokenRefresh(expiresInMs);

            await syncWithDrive();
            startPeriodicSync();
        },
    });

    // Only attempt silent re-auth if the user has previously signed in AND
    // explicitly left auto_sync enabled. Never show a popup automatically.
    if (localStorage.getItem('auto_sync_enabled') === 'true') {
        // prompt:'' = completely silent; if Google session expired, callback
        // receives interaction_required and we clear the flag (see above).
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

/* ── Background sync triggers ─────────────────────────────────────────────── */

export function startPeriodicSync() {
    if (syncInterval) return;

    if (!_visibilityListenerAdded) {
        _visibilityListenerAdded = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && accessToken && !isSyncing) {
                syncWithDrive(true);
            }
        });
    }

    syncInterval = setInterval(() => {
        if (accessToken && !isSyncing) syncWithDrive(true);
    }, SYNC_INTERVAL_MS);
}

export async function handleAuthClick() {
    if (!tokenClient) { showToast('Google Sign-In not ready yet'); return; }
    if (!accessToken) {
        // Manual tap: always use select_account so user can pick/confirm account.
        // This is the ONLY place a visible login popup should ever appear.
        tokenClient.requestAccessToken({ prompt: 'select_account' });
    } else {
        await syncWithDrive();
    }
}

export function updateSyncUI(icon, text) {
    const iconEl = document.getElementById('sync-icon');
    const textEl = document.getElementById('sync-text');
    if (iconEl) iconEl.textContent = icon;
    if (textEl) textEl.textContent = text;
}

export function initOfflineIndicator() {
    function handleOffline() { updateSyncUI('📵', 'Offline'); }
    function handleOnline() {
        const syncText = document.getElementById('sync-text');
        if (syncText?.textContent === 'Offline') updateSyncUI('☁️', 'Sync');
    }
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online',  handleOnline);
    if (!navigator.onLine) handleOffline();
}

/* ── API fetch wrapper ────────────────────────────────────────────────────── */

async function apiFetch(url, method = 'GET', body, extraHeaders = {}) {
    const { hostname } = new URL(url);
    if (!hostname.endsWith('googleapis.com')) throw new Error(`Blocked: ${hostname}`);
    return fetch(url, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...extraHeaders },
        ...(body !== undefined && { body }),
    });
}

/* ── Full sync ────────────────────────────────────────────────────────────── */

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
        _isDirty = false;
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

/* ── Upload ───────────────────────────────────────────────────────────────── */

export async function uploadToDrive() {
    if (!accessToken) return;

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

    const focusStreak       = parseInt(localStorage.getItem('focus_streak') || '0', 10);
    const nextUp            = localStorage.getItem('next_up') || '';
    const lastIntentionDate = localStorage.getItem('last_intention_date') || '';
    const todayIntention    = localStorage.getItem('today_intention_text') || '';
    const intentionAchieved = localStorage.getItem('today_intention_achieved') || '';
    const payload  = JSON.stringify({
        notes: getLocalNotes(), deletedIds: getDeletedIds(),
        focusStreak, nextUp, lastIntentionDate, todayIntention, intentionAchieved,
    });
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
        const fileId = (await res.json()).id;
        if (fileId) {
            driveFileId = fileId;
            localStorage.setItem(DRIVE_FILE_ID_KEY, driveFileId);
        }
    }
}

/* ── Merge ────────────────────────────────────────────────────────────────── */

export function mergeNotes(driveData) {
    const rawDriveNotes   = Array.isArray(driveData) ? driveData : (driveData?.notes ?? []);
    const rawDriveDeleted = Array.isArray(driveData) ? [] : (driveData?.deletedIds ?? []);

    if (typeof driveData?.focusStreak === 'number') {
        const local  = parseInt(localStorage.getItem('focus_streak') || '0', 10);
        const merged = Math.max(local, driveData.focusStreak);
        localStorage.setItem('focus_streak', String(merged));
        updateStreakUI();
    }

    if (typeof driveData?.lastIntentionDate === 'string' && driveData.lastIntentionDate) {
        const local = localStorage.getItem('last_intention_date') || '';
        if (driveData.lastIntentionDate > local) {
            localStorage.setItem('last_intention_date', driveData.lastIntentionDate);
        }
    }

    const _looksLikeIntention = (text) => {
        if (typeof text !== 'string' || !text.trim()) return false;
        const normalized = text.trim().toLowerCase();
        const intentionText = (driveData?.todayIntention || localStorage.getItem('today_intention_text') || '').trim().toLowerCase();
        if (intentionText && normalized === intentionText) return true;
        if (/^🎯\s*today'?s intention:/i.test(text)) return true;
        return false;
    };

    if (typeof driveData?.nextUp === 'string' && driveData.nextUp && !localStorage.getItem('next_up')) {
        if (!_looksLikeIntention(driveData.nextUp)) {
            localStorage.setItem('next_up', driveData.nextUp.slice(0, 200));
            const noteInput = document.getElementById('note-input');
            if (noteInput && !noteInput.value.trim()) noteInput.placeholder = driveData.nextUp;
        }
    }

    let _intentionChanged = false;
    if (typeof driveData?.todayIntention === 'string' && driveData.todayIntention
            && !localStorage.getItem('today_intention_text')) {
        localStorage.setItem('today_intention_text', driveData.todayIntention.slice(0, 200));
        _intentionChanged = true;
    }
    if (driveData?.intentionAchieved && !localStorage.getItem('today_intention_achieved')) {
        localStorage.setItem('today_intention_achieved', '1');
        _intentionChanged = true;
    }
    if (_intentionChanged) {
        document.dispatchEvent(new CustomEvent('intention-sync'));
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
    if (titleEl?.textContent?.startsWith('Notes for ')) {
        showNotesForDay(titleEl.textContent.replace('Notes for ', '').trim());
    }
    renderAll();
}