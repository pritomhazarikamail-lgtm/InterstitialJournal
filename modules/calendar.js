/**
 * modules/calendar.js — Calendar heatmap, day timeline, note cards, tag cloud
 *
 * buildNoteCard fires custom DOM events (note-pin / note-edit / note-delete)
 * so this module has no dependency on crud.js, breaking what would otherwise
 * be a circular reference (crud → calendar → crud).
 *
 * Similarly, tag buttons dispatch 'tag-filter' events instead of calling
 * filterByTag directly, so search.js can remain a one-way dependency.
 *
 * app.js listens for all these events and routes them appropriately.
 */

import { getDateIndex, getTagIndex, getISODate } from './storage.js';
import { uiState } from './state.js';

export function formatDuration(ms) {
    const m = Math.floor(ms / 60000);
    return m < 1 ? '< 1m' : m < 60 ? `${m}m` : `${Math.floor(m/60)}h ${m%60}m`;
}

/* ── Calendar heatmap ──────────────────────────────────────────────────────── */

export function renderCalendar() {
    const cal   = document.getElementById('calendar');
    const month = uiState.currentMonth.getMonth();
    const year  = uiState.currentMonth.getFullYear();
    cal.innerHTML = '';
    document.getElementById('month-display').textContent =
        new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(uiState.currentMonth);

    const dateIdx = getDateIndex();
    const counts  = {};
    dateIdx.forEach((ns, key) => { counts[key] = ns.length; });

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

    // Journal streak badge
    const badge = document.getElementById('journal-streak-badge');
    if (badge) {
        const s = _getJournalStreak();
        badge.textContent     = s > 1 ? `🔥 ${s}-day streak` : '';
        badge.style.display   = s > 1 ? 'inline-block' : 'none';
    }
}

/* ── Note card builder ─────────────────────────────────────────────────────── */

/**
 * Build a note card DOM element.
 * Pin / edit / delete / cleanup buttons dispatch custom events rather than
 * calling crud functions directly, which would create a circular import.
 */
export function buildNoteCard(n, showDate = false) {
    const card     = document.createElement('div');
    const noteType = n.content.startsWith('🏆') || n.content.startsWith('✅') ? 'note-type-win'
        : n.content.startsWith('☐') ? 'note-type-todo'
        : n.content.startsWith('🚫') ? 'note-type-block'
        : n.content.startsWith('🔄') ? 'note-type-handoff'
        : n.content.startsWith('🎯') ? 'note-type-focus'
        : n.content.startsWith('💡') ? 'note-type-idea'
        : '';
    card.className = `note-item${n.pinned ? ' note-item--pinned' : ''}${noteType ? ' ' + noteType : ''}`;
    card.setAttribute('tabindex', '-1');
    card.setAttribute('data-note-id', String(n.id));

    // ── Swipe-left to delete (event handled in app.js → swipeDeleteNote) ──
    let _touchStartX = null;
    card.addEventListener('touchstart', e => {
        _touchStartX = e.touches[0].clientX;
        card.style.transition = 'none';
    }, { passive: true });
    card.addEventListener('touchmove', e => {
        if (_touchStartX === null) return;
        const dx = e.touches[0].clientX - _touchStartX;
        if (dx < -5) card.style.transform = `translateX(${Math.max(dx, -110)}px)`;
    }, { passive: true });
    card.addEventListener('touchend', e => {
        if (_touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - _touchStartX;
        _touchStartX = null;
        card.style.transition = '';
        if (dx < -60) {
            card.style.transform = 'translateX(-110%)';
            card.style.opacity   = '0';
            document.dispatchEvent(new CustomEvent('note-swipe-delete', { detail: { id: n.id } }));
        } else {
            card.style.transform = '';
        }
    }, { passive: true });

    const header = document.createElement('div');
    header.className = 'note-card-header';

    const time = document.createElement('small');
    time.textContent = new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (showDate) time.textContent = `${n.dateKey}  ${time.textContent}`;
    header.appendChild(time);

    if (n.pinned) {
        const badge = document.createElement('span');
        badge.className   = 'pinned-badge';
        badge.textContent = '📌 Pinned';
        header.appendChild(badge);
    }

    card.appendChild(header);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'note-content';
    n.content.split('\n').forEach((line, li) => {
        if (li > 0) contentDiv.appendChild(document.createElement('br'));
        // First line of a todo note gets a tappable checkbox
        if (li === 0 && line.startsWith('☐')) {
            const cb = document.createElement('button');
            cb.className = 'todo-check-btn';
            cb.textContent = '☐';
            cb.setAttribute('aria-label', 'Mark as done');
            cb.addEventListener('click', e => {
                e.stopPropagation();
                if (cb.disabled) return;
                cb.disabled = true;
                document.dispatchEvent(new CustomEvent('note-complete', { detail: { id: n.id } }));
            });
            contentDiv.appendChild(cb);
            contentDiv.appendChild(document.createTextNode(line.slice(1)));
        } else {
            contentDiv.appendChild(document.createTextNode(line));
        }
    });
    card.appendChild(contentDiv);

    // Collapse notes longer than 300 chars with a "Show more" toggle
    if (n.content.length > 300) {
        contentDiv.classList.add('note-content--collapsible', 'note-content--collapsed');
        const toggleBtn = document.createElement('button');
        toggleBtn.className   = 'note-expand-btn';
        toggleBtn.textContent = 'Show more';
        toggleBtn.addEventListener('click', e => {
            e.stopPropagation();
            const collapsed = contentDiv.classList.toggle('note-content--collapsed');
            toggleBtn.textContent = collapsed ? 'Show more' : 'Show less';
        });
        card.appendChild(toggleBtn);
    }

    const actions = document.createElement('div');
    actions.className = 'note-actions';

    const fire = type =>
        document.dispatchEvent(new CustomEvent(type, { detail: { id: n.id } }));

    const pinBtn = document.createElement('button');
    pinBtn.className   = 'action-link pin-link';
    pinBtn.textContent = n.pinned ? 'Unpin' : 'Pin';
    pinBtn.addEventListener('click', () => fire('note-pin'));

    const editBtn = document.createElement('button');
    editBtn.className   = 'action-link edit-link';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => fire('note-edit'));

    const delBtn = document.createElement('button');
    delBtn.className   = 'action-link delete-link';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => fire('note-delete'));

    // ✨ AI cleanup — user-initiated, only shown when model is warm
    const cleanupBtn = document.createElement('button');
    cleanupBtn.className   = 'action-link cleanup-link';
    cleanupBtn.textContent = '✨';
    cleanupBtn.title       = 'Clean up note with AI (requires Summarize to be run first)';
    cleanupBtn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('note-cleanup', { detail: { id: n.id, btn: cleanupBtn } }));
    });

    actions.append(pinBtn, editBtn, delBtn, cleanupBtn);
    card.appendChild(actions);

    return card;
}

/* ── Day digest ────────────────────────────────────────────────────────────── */

function renderDayDigest(dayNotes) {
    const el = document.getElementById('day-digest');
    if (!el) return;
    if (dayNotes.length === 0) { el.style.display = 'none'; return; }

    // Total tracked time: span from first to last note
    const sorted    = dayNotes.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const trackedMs = new Date(sorted[sorted.length - 1].timestamp) - new Date(sorted[0].timestamp);

    // Tag counts — top 3 by frequency
    const tagCounts = new Map();
    dayNotes.forEach(n => (n.tags || []).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
    const topTags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t, c]) => `${t} ×${c}`)
        .join(' · ');

    const totalWords = dayNotes.reduce(
        (s, n) => s + n.content.trim().split(/\s+/).filter(Boolean).length, 0
    );
    const parts = [`${dayNotes.length} entr${dayNotes.length === 1 ? 'y' : 'ies'}`];
    if (dayNotes.length > 1) parts.push(`${formatDuration(trackedMs)} tracked`);
    parts.push(`${totalWords} word${totalWords !== 1 ? 's' : ''}`);
    if (topTags) parts.push(topTags);

    el.textContent = parts.join('  ·  ');
    el.style.display = 'block';
}

/* ── Day timeline ──────────────────────────────────────────────────────────── */

export function showNotesForDay(dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;  // SECURITY: validate format

    uiState.activeTag = null;
    clearTagActive();
    clearDateRange();

    const list     = document.getElementById('notes-list');
    const dayNotes = (getDateIndex().get(dateKey) || [])
        .slice()
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    document.getElementById('selected-date-title').textContent = `Notes for ${dateKey}`;
    renderDayDigest(dayNotes);
    list.innerHTML = '';

    if (dayNotes.length === 0) {
        const p = document.createElement('p'); p.textContent = 'No entries.'; list.appendChild(p);
    } else {
        const pinned = dayNotes.filter(n => n.pinned);

        if (pinned.length > 0) {
            const pinnedHeader = document.createElement('div');
            pinnedHeader.className   = 'pinned-section-header';
            pinnedHeader.textContent = '📌 Pinned';
            list.appendChild(pinnedHeader);
            pinned.forEach(n => list.appendChild(buildNoteCard(n)));
            const divider = document.createElement('div');
            divider.className = 'pinned-section-divider';
            list.appendChild(divider);
        }

        // Chronological timeline — gap badges use real wall-clock time
        dayNotes.forEach((n, i) => {
            if (i > 0) {
                const gap   = document.createElement('div'); gap.className = 'time-gap-container';
                const badge = document.createElement('div'); badge.className = 'duration-badge';
                badge.textContent = `⏱️ ${formatDuration(new Date(n.timestamp) - new Date(dayNotes[i-1].timestamp))} gap`;
                gap.appendChild(badge);
                list.appendChild(gap);
            }
            list.appendChild(buildNoteCard(n));
        });
    }

    document.getElementById('llm-controls').style.display = dayNotes.length > 0 ? 'block' : 'none';

    const [y, m] = dateKey.split('-').map(Number);
    if (uiState.currentMonth.getFullYear() === y && uiState.currentMonth.getMonth() === m - 1) renderCalendar();
}

export function renderAll()    { renderTagCloud(); renderCalendar(); }
export function changeMonth(d) { uiState.currentMonth.setMonth(uiState.currentMonth.getMonth() + d); renderCalendar(); }

/** Navigate calendar to today and open today's notes. */
export function jumpToToday() {
    const now  = new Date();
    uiState.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const key  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    renderCalendar();
    showNotesForDay(key);
}

/** Count consecutive days (ending today or yesterday) with ≥1 note. */
function _getJournalStreak() {
    const dateIdx   = getDateIndex();
    const today     = new Date();
    const toKey     = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const todayKey  = toKey(today);
    const todayFull = (dateIdx.get(todayKey) || []).length > 0;
    let streak = 0;
    for (let i = todayFull ? 0 : 1; i < 365; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        if ((dateIdx.get(toKey(d)) || []).length > 0) { streak++; } else { break; }
    }
    return streak;
}

/* ── Tag cloud ─────────────────────────────────────────────────────────────── */

export function renderTagCloud() {
    const cloud        = document.getElementById('tag-cloud');
    const moreBtn      = document.getElementById('tag-more-btn');
    const overflowList = document.getElementById('tag-overflow-list');

    cloud.innerHTML      = '';
    cloud.style.paddingRight = '';
    overflowList.innerHTML   = '';
    moreBtn.classList.add('hidden');
    moreBtn.style.top  = '';
    moreBtn.style.right = '';

    const tagIdx = getTagIndex();
    const tags   = Array.from(tagIdx.keys()).sort((a, b) => tagIdx.get(b) - tagIdx.get(a));
    if (tags.length === 0) return;

    tags.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'tag'; btn.textContent = t;
        btn.setAttribute('aria-pressed', uiState.activeTag === t ? 'true' : 'false');
        btn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('tag-filter', { detail: { tag: t } }));
        });
        cloud.appendChild(btn);
    });

    requestAnimationFrame(() => {
        cloud.style.maxHeight = 'none';
        void cloud.offsetHeight;

        const allBtns = Array.from(cloud.querySelectorAll('.tag'));
        if (allBtns.length === 0) { cloud.style.maxHeight = ''; return; }

        const rowH      = allBtns[0].offsetHeight;
        const gap       = 6;
        const twoRowCap = rowH + gap + rowH;
        const overflow1 = allBtns.filter(b => b.offsetTop >= twoRowCap);

        if (overflow1.length === 0) { cloud.style.maxHeight = ''; return; }

        moreBtn.textContent      = `＋${overflow1.length}`;
        moreBtn.style.visibility = 'hidden';
        moreBtn.classList.remove('hidden');
        void moreBtn.offsetHeight;
        const pillW = moreBtn.offsetWidth;
        const pillH = moreBtn.offsetHeight;
        moreBtn.style.visibility = '';

        cloud.style.paddingRight = (pillW + gap) + 'px';
        void cloud.offsetHeight;

        const finalOverflow = allBtns.filter(b => b.offsetTop >= twoRowCap);
        finalOverflow.forEach(btn => {
            const copy = document.createElement('button');
            copy.className = 'tag'; copy.textContent = btn.textContent;
            copy.setAttribute('aria-pressed', uiState.activeTag === btn.textContent ? 'true' : 'false');
            copy.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('tag-filter', { detail: { tag: btn.textContent } }));
            });
            overflowList.appendChild(copy);
        });

        moreBtn.textContent = `＋${finalOverflow.length}`;
        moreBtn.style.top   = (cloud.offsetTop + rowH + gap + rowH - pillH) + 'px';
        moreBtn.style.right = '0px';
        cloud.style.maxHeight = '';
    });
}

/* ── Shared state-reset helpers (used by search.js and showNotesForDay) ───── */

export function clearTagActive() {
    document.querySelectorAll('.tag--active').forEach(b => {
        b.classList.remove('tag--active');
        b.setAttribute('aria-pressed', 'false');
    });
}

export function clearDateRange() {
    uiState.dateFrom = null;
    uiState.dateTo   = null;
    const fromInput = document.getElementById('date-from');
    const toInput   = document.getElementById('date-to');
    if (fromInput) fromInput.value = '';
    if (toInput)   toInput.value   = '';
}

export function restoreCalendarState() {
    document.getElementById('calendar').style.display = 'grid';
    document.getElementById('selected-date-title').textContent = '';
    document.getElementById('notes-list').innerHTML = '';
    document.getElementById('llm-controls').style.display = 'none';
}

export function openTagOverflow() {
    document.getElementById('tag-overflow-popover').classList.remove('hidden');
    document.getElementById('tag-more-btn').classList.add('active');
    document.getElementById('tag-more-btn').setAttribute('aria-expanded', 'true');
}

export function closeTagOverflow() {
    document.getElementById('tag-overflow-popover').classList.add('hidden');
    document.getElementById('tag-more-btn').classList.remove('active');
    document.getElementById('tag-more-btn').setAttribute('aria-expanded', 'false');
}
