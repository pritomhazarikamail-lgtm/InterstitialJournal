/**
 * modules/weekly.js — Weekly digest modal
 *
 * Shows a mini bar chart + stats summary for the current ISO week
 * (Monday → Sunday). Rendered entirely in JS — no innerHTML, no XSS risk.
 *
 * If the on-device AI model is already warm, a reflection question and
 * pattern observations are appended asynchronously — zero performance cost
 * when the model is not loaded.
 */

import { getLocalNotes } from './storage.js';
import { formatDuration } from './calendar.js';
import { isModelReady, generateWeeklyReflection, detectPatterns } from './ai.js';

function _toKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _getWeekRange() {
    const today  = new Date();
    const dow    = today.getDay();                       // 0 = Sun
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((dow + 6) % 7));  // rewind to Monday
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
}

export function showWeeklyDigest() {
    const overlay = document.getElementById('weekly-overlay');
    const content = document.getElementById('weekly-content');
    if (!overlay || !content) return;

    const { start, end } = _getWeekRange();
    const notes = getLocalNotes().filter(n => {
        const ts = new Date(n.timestamp);
        return ts >= start && ts <= end;
    });

    content.textContent = '';   // safe DOM clear (no innerHTML)

    if (notes.length === 0) {
        const p = document.createElement('p');
        p.className   = 'weekly-empty';
        p.textContent = 'No entries this week yet — keep going!';
        content.appendChild(p);
    } else {
        // ── Stats row ──────────────────────────────────────────────
        const totalWords = notes.reduce(
            (s, n) => s + n.content.trim().split(/\s+/).filter(Boolean).length, 0
        );
        const tagCounts  = new Map();
        notes.forEach(n => (n.tags || []).forEach(t =>
            tagCounts.set(t, (tagCounts.get(t) || 0) + 1)
        ));
        const topTag = Array.from(tagCounts.entries())
            .sort((a, b) => b[1] - a[1])[0];

        const statsRow = document.createElement('div');
        statsRow.className = 'weekly-stats-row';
        [
            [String(notes.length), 'entries'],
            [String(totalWords),   'words'],
            [topTag ? topTag[0] : '—', 'top tag'],
        ].forEach(([val, lbl]) => {
            const cell  = document.createElement('div'); cell.className = 'weekly-stat';
            const vEl   = document.createElement('div'); vEl.className = 'weekly-stat-val';   vEl.textContent = val;
            const lEl   = document.createElement('div'); lEl.className = 'weekly-stat-label'; lEl.textContent = lbl;
            cell.append(vEl, lEl);
            statsRow.appendChild(cell);
        });
        content.appendChild(statsRow);

        // ── Per-day bar chart ──────────────────────────────────────
        const byDay = new Map();
        for (let i = 0; i < 7; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            byDay.set(_toKey(d), []);
        }
        notes.forEach(n => { if (byDay.has(n.dateKey)) byDay.get(n.dateKey).push(n); });

        const maxCount   = Math.max(...Array.from(byDay.values()).map(ns => ns.length), 1);
        const dayNames   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const todayKey   = _toKey(new Date());
        const grid       = document.createElement('div');
        grid.className   = 'weekly-day-grid';

        let dayIndex = 0;
        byDay.forEach((dayNotes, key) => {
            const col  = document.createElement('div'); col.className = 'weekly-day-col';
            const wrap = document.createElement('div'); wrap.className = 'weekly-day-bar-wrap';
            const fill = document.createElement('div'); fill.className = 'weekly-day-bar-fill';
            fill.style.height = `${Math.round((dayNotes.length / maxCount) * 100)}%`;
            if (key === todayKey)        fill.classList.add('weekly-day-bar--today');
            if (dayNotes.length === 0)   fill.classList.add('weekly-day-bar--empty');
            wrap.appendChild(fill);

            const cnt  = document.createElement('div'); cnt.className = 'weekly-day-count';
            cnt.textContent = dayNotes.length || '';
            const lbl  = document.createElement('div'); lbl.className = 'weekly-day-label';
            lbl.textContent = dayNames[dayIndex % 7];

            col.append(wrap, cnt, lbl);
            grid.appendChild(col);
            dayIndex++;
        });
        content.appendChild(grid);

        // ── Top tags ───────────────────────────────────────────────
        const top5 = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (top5.length > 0) {
            const tagRow = document.createElement('div');
            tagRow.className = 'weekly-tags';
            top5.forEach(([t, c]) => {
                const chip = document.createElement('span');
                chip.className   = 'weekly-tag-chip';
                chip.textContent = `${t} ×${c}`;
                tagRow.appendChild(chip);
            });
            content.appendChild(tagRow);
        }

        // ── AI section (reflection + patterns) ────────────────────
        // Only runs if the model is already warm — no performance cost otherwise.
        if (isModelReady() && notes.length >= 3) {
            const aiSection = document.createElement('div');
            aiSection.className = 'weekly-ai-section';
            content.appendChild(aiSection);

            // Reflection question — async, appended when ready
            const run = () => {
                generateWeeklyReflection(notes).then(question => {
                    if (!question) return;
                    const divider = document.createElement('div');
                    divider.className = 'weekly-ai-divider';
                    const qEl = document.createElement('p');
                    qEl.className   = 'weekly-reflection-q';
                    qEl.textContent = question;
                    aiSection.prepend(qEl);
                    aiSection.prepend(divider);
                });

                // Pattern detection — only if enough data
                if (notes.length >= 10) {
                    detectPatterns(getLocalNotes()).then(patternsText => {
                        if (!patternsText) return;
                        const lines = patternsText
                            .split('\n')
                            // Strip numbering, markdown bold, "Pattern N:" prefixes, preamble lines
                            .map(l => l
                                .replace(/^\*{1,2}Pattern\s*\d*[:.\s]*/i, '')
                                .replace(/^\*{1,2}/, '')
                                .replace(/\*{1,2}$/, '')
                                .replace(/^[\d]+[.)]\s*/, '')
                                .replace(/^[-•]\s*/, '')
                                .trim()
                            )
                            // Drop intro lines ("Here are...", "I identified...", etc.)
                            .filter(l => l.length > 10 && !/^here (are|is)/i.test(l) && !/^i (found|identified|noticed)/i.test(l))
                            .slice(0, 2);
                        if (!lines.length) return;
                        const patWrap = document.createElement('div');
                        patWrap.className = 'weekly-patterns';
                        const patLabel = document.createElement('div');
                        patLabel.className   = 'weekly-patterns-label';
                        patLabel.textContent = '📈 Patterns';
                        patWrap.appendChild(patLabel);
                        lines.forEach(line => {
                            const p = document.createElement('p');
                            p.className   = 'weekly-pattern-item';
                            p.textContent = line;
                            patWrap.appendChild(p);
                        });
                        aiSection.appendChild(patWrap);
                    });
                }
            };
            typeof requestIdleCallback === 'function' ? requestIdleCallback(run) : setTimeout(run, 0);
        }
    }

    overlay.classList.remove('hidden');
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

export function hideWeeklyDigest() {
    const overlay = document.getElementById('weekly-overlay');
    if (!overlay || !overlay.classList.contains('visible')) return; // guard double-call
    overlay.classList.remove('visible');
    overlay.addEventListener('transitionend', () => {
        if (!overlay.classList.contains('visible')) overlay.classList.add('hidden');
    }, { once: true });
}
