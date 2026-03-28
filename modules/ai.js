/**
 * modules/ai.js — On-device AI via @mlc-ai/web-llm
 *
 * Two tracks:
 *  FOREGROUND — explicit "Summarize" button; shows download/progress UI.
 *  BACKGROUND — automatic features; silent, cached, requestIdleCallback-gated.
 *
 * Performance contract:
 *  • preloadModel() only runs if the user has previously loaded the model
 *    (ai_model_used flag), and only inside requestIdleCallback so it never
 *    competes with user interaction.
 *  • All background task functions return null immediately if the model is
 *    not already warm — they never trigger a download.
 *  • Results are cached in localStorage so the same prompt never runs twice
 *    for the same content (per-day / per-week keys).
 */

import { getISODate } from './storage.js';

// Map<modelId, MLCEngine> — engines stay alive for the session
const _engines = new Map();
let _modelReady = false;

function yieldToMain() {
    if (typeof scheduler !== 'undefined' && scheduler.yield) return scheduler.yield();
    return new Promise(r => setTimeout(r, 0));
}

/* ── Progress UI (foreground only) ──────────────────────────────────────────── */

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

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function _getModelId() {
    return document.getElementById('model-select')?.value || 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
}

/** Returns the ISO date of the current Monday (used as a per-week cache key). */
function _mondayKey() {
    const d   = new Date();
    const day = d.getDay() || 7;
    const mon = new Date(d);
    mon.setDate(d.getDate() - day + 1);
    return getISODate(mon);
}

/* ── Model-ready signal ─────────────────────────────────────────────────────── */

function _onModelReady() {
    _modelReady = true;
    localStorage.setItem('ai_model_used', 'true');

    // Brief "⚡ AI" badge — fades out after 4 s so it doesn't clutter the UI
    const badge = document.getElementById('ai-ready-badge');
    if (badge) {
        badge.style.display  = 'inline-block';
        badge.style.opacity  = '1';
        badge.style.transition = 'opacity 0.4s ease';
        setTimeout(() => { badge.style.opacity = '0'; },    4000);
        setTimeout(() => { badge.style.display = 'none'; }, 4500);
    }

    // Notify any modules waiting for AI to become available
    document.dispatchEvent(new CustomEvent('ai-ready'));
}

export function isModelReady() { return _modelReady; }

/* ── Engine loaders ────────────────────────────────────────────────────────── */

/** Foreground load — shows the download progress bar. */
async function loadEngine(modelId) {
    if (_engines.has(modelId)) return _engines.get(modelId);
    const webllm = await import('https://esm.run/@mlc-ai/web-llm');
    if (!navigator.gpu) throw new Error('WebGPU is not supported on this browser/device.');
    const engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: report => {
            const pct = report.progress != null ? Math.round(report.progress * 100) : null;
            setDlProgress(report.text || 'Loading...', pct);
        },
    });
    _engines.set(modelId, engine);
    return engine;
}

/** Silent background load — no UI, no throw, returns null on failure. */
async function _silentLoadEngine(modelId) {
    if (_engines.has(modelId)) return _engines.get(modelId);
    try {
        const webllm = await import('https://esm.run/@mlc-ai/web-llm');
        if (!navigator.gpu) return null;
        const engine = await webllm.CreateMLCEngine(modelId, {
            initProgressCallback: () => {},
        });
        _engines.set(modelId, engine);
        return engine;
    } catch { return null; }
}

/* ── Background preloader ───────────────────────────────────────────────────── */
/**
 * Called from app.js init. Only acts if the user has previously loaded the
 * model (ai_model_used flag), and runs inside requestIdleCallback so it
 * never competes with page interaction.
 */
export function preloadModel() {
    if (_modelReady) return;
    if (localStorage.getItem('ai_model_used') !== 'true') return;

    const run = async () => {
        const engine = await _silentLoadEngine(_getModelId());
        if (engine) _onModelReady();
    };

    typeof requestIdleCallback === 'function'
        ? requestIdleCallback(run, { timeout: 20000 })
        : setTimeout(run, 8000);
}

/* ── Internal prompt runner (background, silent) ────────────────────────────── */

async function _runPrompt(messages, maxTokens = 120, temp = 0.3) {
    const engine = _engines.get(_getModelId());
    if (!engine) return null;
    try {
        const reply = await engine.chat.completions.create({
            messages, max_tokens: maxTokens, temperature: temp,
        });
        return (reply.choices[0]?.message?.content || '').trim();
    } catch { return null; }
}

/* ══════════════════════════════════════════════════════════════════════════════
   BACKGROUND TASK FUNCTIONS
   All return null/[] if model not ready or on error — never throw, never block.
   ══════════════════════════════════════════════════════════════════════════════ */

/** Suggest 1-3 hashtags for note text. Existing vocab keeps suggestions consistent. */
export async function suggestTags(text, existingTagVocab = []) {
    if (!_modelReady || text.length < 30) return [];
    const vocab  = existingTagVocab.slice(0, 15).join(' ');
    const prompt = `Suggest 1-3 hashtags for this journal note.${
        vocab ? ` Prefer from these existing tags: ${vocab}` : ''
    }\nReturn ONLY the tags space-separated (e.g. #focus #win).\nNote: "${text.slice(0, 250)}"\nTags:`;
    const result = await _runPrompt([{ role: 'user', content: prompt }], 30, 0.2);
    if (!result) return [];
    return (result.match(/#\w+/g) || []).slice(0, 3).map(t => t.toLowerCase());
}

/** One thoughtful reflection question for the week. Cached per Monday key. */
export async function generateWeeklyReflection(notes) {
    if (!_modelReady || notes.length < 3) return null;
    const key    = `ai_refl_${_mondayKey()}`;
    const cached = localStorage.getItem(key);
    if (cached) return cached;
    const sample = notes.slice(-20).map(n => `• ${n.content.slice(0, 70)}`).join('\n');
    const result = await _runPrompt([{
        role: 'user',
        content: `From these journal entries, ask ONE thoughtful question to help the person reflect on their week. Be specific to their content — not generic.\n${sample}\nQuestion:`,
    }], 80, 0.5);
    if (result) localStorage.setItem(key, result);
    return result;
}

/** 2-sentence narrative of a day's work. Cached per dateKey. Auto-generates only for today. */
export async function generateNarrativeSummary(notes, dateKey) {
    if (!_modelReady || notes.length < 3) return null;
    const key    = `ai_narrative_${dateKey}`;
    const cached = localStorage.getItem(key);
    if (cached) return cached;
    const texts = notes
        .slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .map(n => `[${new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${n.content.slice(0, 80)}`)
        .join('\n');
    const result = await _runPrompt([{
        role: 'user',
        content: `Write 2 sentences summarising this person's workday. Be specific about what they did.\n${texts}\nSummary:`,
    }], 90, 0.3);
    if (result) localStorage.setItem(key, result);
    return result;
}

/** Honest one-sentence alignment check vs the morning intention. Cached per dateKey. */
export async function checkIntentionAlignment(intention, notes, dateKey) {
    if (!_modelReady || notes.length < 3) return null;
    const key    = `ai_alignment_${dateKey}`;
    const cached = localStorage.getItem(key);
    if (cached) return cached;
    const texts = notes.slice(-12).map(n => n.content.slice(0, 70)).join('\n');
    const result = await _runPrompt([{
        role: 'user',
        content: `Goal: "${intention}"\nNotes:\n${texts}\nIn one sentence, did these notes show progress toward the goal? Be honest but kind.\nAssessment:`,
    }], 60, 0.3);
    if (result) localStorage.setItem(key, result);
    return result;
}

/** Fix grammar and clarity of a rough note. User-initiated — not cached. */
export async function cleanupNote(text) {
    if (!_modelReady || !text.trim()) return null;
    return _runPrompt([{
        role: 'user',
        content: `Fix the grammar and clarity of this rough note. Keep the same meaning and approximate length. Return only the cleaned text.\nNote: "${text.slice(0, 500)}"\nCleaned:`,
    }], 160, 0.2);
}

/** 2 specific behavioural patterns from recent entries. Cached per week. */
export async function detectPatterns(notes) {
    if (!_modelReady || notes.length < 10) return null;
    const key    = `ai_patterns_${_mondayKey()}`;
    const cached = localStorage.getItem(key);
    if (cached) return cached;
    const sample = notes.slice(-35).map(n => {
        const day = new Date(n.timestamp).toLocaleDateString('en-US', { weekday: 'short' });
        const t   = new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `[${day} ${t}] ${n.content.slice(0, 55)}`;
    }).join('\n');
    const result = await _runPrompt([{
        role: 'user',
        content: `Find 2 specific patterns in these journal entries (time of day, recurring blockers, habits). Be concrete, not generic.\n${sample}\nPattern 1:\nPattern 2:`,
    }], 110, 0.4);
    if (result) localStorage.setItem(key, result);
    return result;
}

/** Restructure a half-formed thought into a clear question or problem statement. */
export async function structureThought(text) {
    if (!_modelReady || !text.trim()) return null;
    return _runPrompt([{
        role: 'user',
        content: `Rewrite this rough thought as a clear, specific question or problem statement in 1-2 sentences.\nThought: "${text.slice(0, 400)}"\nClear version:`,
    }], 80, 0.3);
}

/** Classify a note's tone as 'positive', 'neutral', or 'negative'. */
export async function classifyMood(text) {
    if (!_modelReady || !text.trim()) return null;
    const result = await _runPrompt([{
        role: 'user',
        content: `Classify the tone of this note as exactly one word: positive, neutral, or negative.\nNote: "${text.slice(0, 150)}"\nTone:`,
    }], 5, 0.1);
    if (!result) return null;
    const l = result.toLowerCase();
    return l.includes('positive') ? 'positive' : l.includes('negative') ? 'negative' : 'neutral';
}

/* ══════════════════════════════════════════════════════════════════════════════
   FOREGROUND: explicit day summary (unchanged interface)
   ══════════════════════════════════════════════════════════════════════════════ */

export async function generateDailySummary() {
    const btn     = document.getElementById('summarize-btn');
    const status  = document.getElementById('llm-status');
    const output  = document.getElementById('daily-summary-output');
    const modelId = document.getElementById('model-select').value;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Working...';
    status.textContent = '';
    output.classList.remove('has-content');
    output.innerHTML = '';

    const titleEl  = document.getElementById('selected-date-title');
    const dateMatch = titleEl.textContent.match(/Notes for (\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) {
        status.textContent = 'Select a day from the calendar first.';
        btn.disabled = false; btn.textContent = 'Summarize';
        return;
    }
    const dateKey  = dateMatch[1];
    const { getDateIndex } = await import('./storage.js');
    const dayNotes = (getDateIndex().get(dateKey) || [])
        .slice()
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const noteTexts = dayNotes.map(n => {
        const time = new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `[${time}] ${n.content.trim()}`;
    }).filter(Boolean);

    if (noteTexts.length === 0) {
        status.textContent = 'No notes found for this day.';
        btn.disabled = false; btn.textContent = 'Summarize';
        return;
    }

    try {
        setDlProgress('Loading model...', 0);
        await yieldToMain();

        const engine = await loadEngine(modelId);
        // Model is now warm — activate background features
        if (!_modelReady) _onModelReady();
        hideDlProgress();
        status.textContent = 'Generating summary...';
        await yieldToMain();

        const joined    = noteTexts.map((t, i) => `${i + 1}. ${t}`).join('\n');
        const truncated = joined.length > 1500 ? joined.slice(0, 1500) + '...' : joined;
        const isSmall   = modelId.startsWith('SmolLM');

        if (isSmall) {
            const reply = await engine.chat.completions.create({
                messages:    [{ role: 'user', content: 'Here are my journal notes from today:\n' + truncated + '\n\nWrite a short, warm reflection on this day in 2-3 sentences.' }],
                max_tokens:  120,
                temperature: 0.4,
            });
            renderSummary({ wins: [], themes: [], reflection: (reply.choices[0].message.content || '').trim(), note_count: noteTexts.length }, output);
        } else {
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

/* ── Model selector wiring (self-contained) ──────────────────────────────── */
export function initModelSelect() {
    document.getElementById('model-select').addEventListener('change', function () {
        const opt      = this.options[this.selectedIndex];
        const size     = opt.getAttribute('data-size') || '';
        const modelId  = this.value;
        const isLoaded = _engines.has(modelId);
        document.getElementById('model-dl-note').textContent = isLoaded
            ? '✅ Model already loaded — no download needed.'
            : `⬇️ ${size} download once, then runs offline forever.`;
        document.getElementById('daily-summary-output').innerHTML = '';
        document.getElementById('daily-summary-output').classList.remove('has-content');
        document.getElementById('llm-status').textContent = '';
        hideDlProgress();
    });
}
