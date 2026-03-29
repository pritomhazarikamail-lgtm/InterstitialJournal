/**
 * modules/storage.js — Security helpers, notes cache, and derived indices
 *
 * All user content flows through validateNote/sanitiseId before touching
 * localStorage. No raw user string ever reaches innerHTML.
 */

/* ── Security Helpers ──────────────────────────────────────────────────────── */

/** Sanitise a note ID. IDs are positive safe integers; reject everything else. */
export function sanitiseId(id) {
    const n = Number(id);
    return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

/**
 * Monotonically-increasing ID generator.
 * Guarantees uniqueness even when two saves occur in the same millisecond.
 */
let _lastId = 0;
export function generateId() {
    const id = Math.max(Date.now(), _lastId + 1);
    _lastId = id;
    return id;
}

/** Validate & normalise a single note object. Returns null if malformed. */
export function validateNote(note) {
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
        pinned:    note.pinned === true,
        tags: normalizeTags(note.tags),
    };
}

/** Safe JSON.parse — never throws. */
export function safeJSON(str, fallback) {
    try { return JSON.parse(str) ?? fallback; } catch { return fallback; }
}

const TAG_REGEX = /#[A-Za-z0-9_-]+/g;
const TAG_VALIDATOR = /#[A-Za-z0-9_-]+/;

export function extractTags(text) {
    if (typeof text !== 'string') return [];
    return Array.from(new Set((text.match(TAG_REGEX) || []).map(t => t.toLowerCase()))).slice(0, 20);
}

function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return Array.from(new Set(tags
        .filter(t => typeof t === 'string')
        .map(t => t.toLowerCase())
        .filter(t => TAG_VALIDATOR.test(t))
    )).slice(0, 20);
}

export function createNote({ id, content, timestamp, dateKey, pinned = false }) {
    return validateNote({
        id,
        content,
        timestamp,
        dateKey,
        pinned,
        tags: extractTags(content),
    });
}

/** Format a Date as YYYY-MM-DD in local time. */
export const getISODate = d => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
};

/* ── Notes Cache ───────────────────────────────────────────────────────────── */

let _notesCache    = null;
let _notesCacheKey = '';
let _dateIndex     = null; // Map<dateKey, Note[]>  — built lazily, cleared with cache
let _tagIndex      = null; // Map<tag, count>        — built lazily, cleared with cache

export function getLocalNotes() {
    const raw = localStorage.getItem('journal_notes') || '[]';
    if (_notesCache !== null && _notesCacheKey === raw) return _notesCache;
    const parsed = safeJSON(raw, []);
    _notesCache    = Array.isArray(parsed) ? parsed.map(validateNote).filter(Boolean) : [];
    _notesCacheKey = raw;
    return _notesCache;
}

function _invalidateNotesCache() {
    _notesCache = null; _notesCacheKey = '';
    _dateIndex  = null; _tagIndex      = null;
}

function _buildIndices() {
    const notes = getLocalNotes();
    _dateIndex  = new Map();
    _tagIndex   = new Map();
    for (const n of notes) {
        if (!_dateIndex.has(n.dateKey)) _dateIndex.set(n.dateKey, []);
        _dateIndex.get(n.dateKey).push(n);
        for (const t of (n.tags || [])) _tagIndex.set(t, (_tagIndex.get(t) || 0) + 1);
    }
}

export function getDateIndex() { if (!_dateIndex) _buildIndices(); return _dateIndex; }
export function getTagIndex()  { if (!_tagIndex)  _buildIndices(); return _tagIndex;  }

export function setLocalNotes(notes) {
    localStorage.setItem('journal_notes', JSON.stringify(notes));
    _invalidateNotesCache();
}

export function getDeletedIds() {
    const raw = safeJSON(localStorage.getItem('journal_deleted_ids'), []);
    return Array.isArray(raw) ? raw.map(sanitiseId).filter(Boolean) : [];
}

export function setDeletedIds(ids) {
    localStorage.setItem('journal_deleted_ids', JSON.stringify(ids));
}

/**
 * Record the wall-clock time at which a note was deleted.
 * Stored separately from the ID list so the ID format stays unchanged
 * and all existing callers (drive.js, crud.js) require no changes.
 */
export function recordDeletedAt(id) {
    const safeId = sanitiseId(id);
    if (!safeId) return;
    const map = safeJSON(localStorage.getItem('journal_deleted_at'), {});
    map[safeId] = Date.now();
    localStorage.setItem('journal_deleted_at', JSON.stringify(map));
}

/**
 * Prune tombstones whose DELETION TIME is older than `maxAgeDays`.
 * Uses the separate deletedAt map rather than the note creation ID,
 * so recently deleted old notes are pruned correctly.
 * Called on init for non-sync users so the list doesn't grow unbounded.
 */
export function pruneDeletedIds(maxAgeDays = 30) {
    const cutoff   = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const atMap    = safeJSON(localStorage.getItem('journal_deleted_at'), {});
    const pruned   = getDeletedIds().filter(id => {
        const deletedAt = atMap[id];
        // If no deletedAt recorded (old tombstone), keep it to be safe
        return deletedAt === undefined || deletedAt > cutoff;
    });
    // Clean up the atMap entries for pruned IDs
    const keptSet = new Set(pruned);
    Object.keys(atMap).forEach(k => { if (!keptSet.has(Number(k))) delete atMap[k]; });
    setDeletedIds(pruned);
    localStorage.setItem('journal_deleted_at', JSON.stringify(atMap));
}
