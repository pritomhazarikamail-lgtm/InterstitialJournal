/**
 * modules/pomodoro.js — Focus timer, Pomodoro cycle, streak, live clock/timer
 *
 * State survives PWA reloads via localStorage.
 * Keys: pomo_goal, pomo_phase (work|break|idle), pomo_end_ms,
 *       pomo_rounds, pomo_session_start, pomo_paused_remaining, focus_streak
 *
 * Ring maths: r=52, circumference = 2π×52 ≈ 326.73
 *   stroke-dashoffset = circumference × (1 − progress)  → 0=full, 326.73=empty
 */

import { showToast }  from './toast.js';
import { showModal }  from './modal.js';
import { saveNote }   from './crud.js';
import { markDirty }  from './drive.js';
import { updateLiveTimer } from './timer.js';

const POMO_WORK_SECS  = 25 * 60;
const POMO_SHORT_SECS =  5 * 60;
const POMO_LONG_SECS  = 15 * 60;
const POMO_CIRC       = 326.73;   // 2π × r=52

let _pomoTick        = null;
let _pomoPhaseEnding = false;

/* ── Audio ──────────────────────────────────────────────────────────────────── */

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

/* ── Streak UI ──────────────────────────────────────────────────────────────── */

let _streakCelebrationTimer = null;

export function updateStreakUI() {
    const streak = Math.min(parseInt(localStorage.getItem('focus_streak') || '0', 10), 3);
    document.querySelectorAll('.streak-dot').forEach((dot, i) =>
        dot.classList.toggle('filled', i < streak)
    );
    const msg = document.getElementById('streak-message');
    if (streak >= 3) {
        msg.textContent = '🌟 Dopamine Hit! 3 in a row!';
        msg.classList.remove('hidden');
        document.getElementById('focus-section').classList.add('celebrate');
        // Guard: clear any existing celebration timer before setting a new one
        clearTimeout(_streakCelebrationTimer);
        _streakCelebrationTimer = setTimeout(() => {
            _streakCelebrationTimer = null;
            localStorage.setItem('focus_streak', '0');
            msg.classList.add('hidden');
            document.getElementById('focus-section').classList.remove('celebrate');
            updateStreakUI();
        }, 5000);
    }
}

/* ── State accessors ────────────────────────────────────────────────────────── */

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
     'pomo_session_start','pomo_paused_remaining'].forEach(k => localStorage.removeItem(k));
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
    b.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
    b.className   = isPaused ? 'pomo-btn pomo-btn-success' : 'pomo-btn pomo-btn-ghost';
}

function pomoStartTick() {
    pomoStopTick();
    _pomoTick = setInterval(pomoTick, 1000);
    pomoTick();
}

function pomoTick() {
    const s        = pomoGetState();
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
    try {
        if (s.phase === 'work') {
            playWorkDone();
            const newRounds = s.rounds + 1;
            const dur       = Math.round((Date.now() - s.sessStart) / 60000);
            await saveNote(`🍅 Pomodoro: ${s.goal} (#focus #pomodoro — round ${newRounds}, ${dur}m total)`);
            const breakDur = pomoDurationForPhase('break', newRounds);
            pomoSetState({ phase: 'break', rounds: newRounds, endMs: Date.now() + breakDur * 1000, paused: 0 });
            showToast(`Round ${newRounds} done — ${newRounds % 4 === 0 ? 'Long break (15 min)! 🎉' : 'Short break (5 min)! 🎉'}`, 4000);
        } else {
            playBreakDone();
            pomoSetState({ phase: 'work', endMs: Date.now() + POMO_WORK_SECS * 1000, paused: 0 });
            showToast("Break over — let's go! 🍅", 3000);
        }
        renderFocus();
        pomoStartTick();
    } catch (err) {
        console.error('pomoPhaseEnd error:', err);
        showToast('Timer error — session reset', 4000);
        pomoClearState();
        renderFocus();
    } finally {
        _pomoPhaseEnding = false;
    }
}

/* ── Public API ─────────────────────────────────────────────────────────────── */

export async function startFocus() {
    const noteInput   = document.getElementById('note-input');
    const charCounter = document.getElementById('char-counter');
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

export function pomoPauseResume() {
    const s = pomoGetState();
    if (s.phase === 'idle') return;

    if (s.paused > 0) {
        pomoSetState({ endMs: Date.now() + s.paused * 1000, paused: 0 });
        _setPauseBtn(false);
        pomoStartTick();
    } else {
        const rem = Math.max(0, Math.round((s.endMs - Date.now()) / 1000));
        pomoSetState({ paused: rem });
        pomoStopTick();
        _setPauseBtn(true);
        pomoTick();
    }
}

export async function completeFocus() {
    const s = pomoGetState();
    if (!s.goal) return;
    pomoStopTick();
    const totalMins = s.sessStart ? Math.round((Date.now() - s.sessStart) / 60000) : 0;
    await saveNote(`✅ Finished: ${s.goal} (#focus #pomodoro — ${s.rounds} 🍅, ${totalMins}m)`);
    localStorage.setItem('focus_streak', String(parseInt(localStorage.getItem('focus_streak') || '0', 10) + 1));
    markDirty(); // sync streak to Drive so other devices see it
    pomoClearState();
    renderFocus();
    updateStreakUI();
}

export async function abandonFocus() {
    const s = pomoGetState();
    if (!s.goal) return;
    const confirmed = await showModal({ title: 'Abandon Session?', message: `Abandon "${s.goal}"? Progress won't be saved.`, isDanger: true });
    if (!confirmed) return;
    pomoStopTick();
    pomoClearState();
    renderFocus();
    showToast('Session abandoned');
}

export function renderFocus() {
    const s       = pomoGetState();
    const section = document.getElementById('focus-section');
    if (s.phase === 'idle' && !s.goal) { section.classList.add('hidden'); pomoStopTick(); return; }
    section.classList.remove('hidden');
    document.getElementById('focus-text').textContent = s.goal;
    if (s.phase !== 'idle') pomoStartTick();
    else pomoTick();
}
