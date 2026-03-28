/**
 * modules/drive.js — Google Drive sync
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

const CLIENT_ID = '629370111704-m36nu5qgi52071qgp0sfsbs5sa9ac80k.apps.googleusercontent.com';
const SCOPES    = 'https://www.googleapis.com/auth/drive.appdata';

let tokenClient  = null;
export let accessToken  = null;    // Lives in memory only — never persisted
let driveFileId  = null;
let syncInterval = null;
let isSyncing    = false;          // Mutex: prevents concurrent overlapping syncs

export function initGIS() {
    if (!window.google?.accounts) { setTimeout(initGIS, 500); return; }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response) => {
            if (response.error) { updateSyncUI('❌', 'Auth Error'); return; }
            accessToken = response.access_token;
            setTimeout(() => { accessToken = null; }, 55 * 60 * 1000);
            await syncWithDrive();
            startPeriodicSync();
        },
    });

    if (localStorage.getItem('auto_sync_enabled') === 'true') {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

export function startPeriodicSync() {
    if (syncInterval) return;
    syncInterval = setInterval(async () => {
        if (accessToken && !isSyncing) await syncWithDrive(true);
    }, 3 * 60 * 1000);
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

/**
 * Thin fetch wrapper — enforces googleapis.com as the only allowed host.
 * SECURITY: Prevents token leakage if a URL is ever constructed from
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
            driveFileId   = files[0].id;
            const fileRes = await apiFetch(
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
        if (!silent) {
            updateSyncUI('❌', 'Sync Error');
            showToast('Sync failed — check your connection', 4000);
        }
    } finally {
        isSyncing = false;
    }
}

export async function uploadToDrive() {
    if (!accessToken) return;

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

export function mergeNotes(driveData) {
    const rawDriveNotes   = Array.isArray(driveData) ? driveData : (driveData?.notes ?? []);
    const rawDriveDeleted = Array.isArray(driveData) ? [] : (driveData?.deletedIds ?? []);

    // SECURITY: validate every note from Drive before touching localStorage
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
