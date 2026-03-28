/**
 * modules/storage.js — Security helpers, notes cache, and derived indices
 *
 * All user content flows through validateNote/sanitiseId before touching
 * localStorage. No raw user string ever reaches innerHTML.
 */

/* ── Security Helpers ──────────────────────────────────────────────────────── */

/** Sanitise a note ID. IDs are Date.now() integers; reject everything else. */
export function sanitiseId(id) {
    const n = Number(id);
    return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
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
        tags: Array.isArray(note.tags)
            ? note.tags.filter(t => typeof t === 'string' && /^#\w+$/.test(t)).slice(0, 20)
            : [],
    };
}

/** Safe JSON.parse — never throws. */
export function safeJSON(str, fallback) {
    try { return JSON.parse(str) ?? fallback; } catch { return fallback; }
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
