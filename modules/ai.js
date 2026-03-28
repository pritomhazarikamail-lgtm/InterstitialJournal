/**
 * modules/ai.js — On-device AI summary via @mlc-ai/web-llm
 *
 * web-llm handles model download, caching (IndexedDB), and chat internally.
 * No manual WASM/ONNX wrangling needed — works on any WebGPU device.
 */

// Map<modelId, MLCEngine> — keeps every loaded engine alive for the session.
// Switching models and switching back never re-initialises the engine.
// WebLLM persists the model weights in IndexedDB, so they are never
// re-downloaded after the first load.
const _engines = new Map();

function yieldToMain() {
    if (typeof scheduler !== 'undefined' && scheduler.yield) return scheduler.yield();
    return new Promise(r => setTimeout(r, 0));
}

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

        const engine = await loadEngine(modelId);
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
        // Clear previous summary output but keep engines in memory
        document.getElementById('daily-summary-output').innerHTML = '';
        document.getElementById('daily-summary-output').classList.remove('has-content');
        document.getElementById('llm-status').textContent = '';
        hideDlProgress();
    });
}
