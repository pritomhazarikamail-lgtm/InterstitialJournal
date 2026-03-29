/**
 * modules/profile.js — User profile, stats dashboard, Drive connection, preferences
 *
 * localStorage keys managed here:
 *   profile_name       — display name
 *   profile_timezone   — IANA timezone string
 *   profile_accent     — accent colour preset name
 *   pomo_work_mins     — custom work duration (minutes)
 *   pomo_short_mins    — custom short-break duration
 *   pomo_long_mins     — custom long-break duration
 */

import { getLocalNotes }                                       from './storage.js';
import { getUserEmail, isAuthenticated, disconnectDrive,
         handleAuthClick, syncWithDrive }                      from './drive.js';
import { showToast }                                           from './toast.js';
import { setReminderInterval }                                 from './reminders.js';

/* ── Accent colour presets ─────────────────────────────────────────────────── */

const ACCENT_PRESETS = [
    { name: 'Blue',   light: '#3d6bff', dark: '#5b84ff' },
    { name: 'Purple', light: '#7c3aed', dark: '#9d68f5' },
    { name: 'Green',  light: '#059669', dark: '#34c789' },
    { name: 'Orange', light: '#ea580c', dark: '#fb923c' },
    { name: 'Pink',   light: '#db2777', dark: '#f472b6' },
    { name: 'Teal',   light: '#0891b2', dark: '#22d3ee' },
];

function _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export function applyAccent(name) {
    const preset = ACCENT_PRESETS.find(p => p.name === name) ?? ACCENT_PRESETS[0];
    let el = document.getElementById('accent-override-style');
    if (!el) {
        el = document.createElement('style');
        el.id = 'accent-override-style';
        document.head.appendChild(el);
    }
    el.textContent = [
        `:root { --accent: ${preset.light}; --accent-soft: ${_hexToRgba(preset.light, 0.12)}; }`,
        `body.dark-mode { --accent: ${preset.dark}; --accent-soft: ${_hexToRgba(preset.dark, 0.15)}; }`,
    ].join('\n');
}

/* ── Header avatar ─────────────────────────────────────────────────────────── */

function _profileInitials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'Profile';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function renderNavAvatar() {
    const el    = document.getElementById('nav-avatar');
    const label = document.getElementById('nav-profile-label');
    const name  = localStorage.getItem('profile_name') || '';
    if (el)    el.textContent    = name.trim() ? name.trim()[0].toUpperCase() : '?';
    if (label) label.textContent = name.trim() ? _profileInitials(name) : 'Profile';
}

/* ── Init ──────────────────────────────────────────────────────────────────── */

export function initProfile() {
    const saved = localStorage.getItem('profile_accent');
    if (saved) applyAccent(saved);
    renderNavAvatar();

    document.addEventListener('profile-page-opened', renderProfilePage);
    document.addEventListener('drive-auth-changed', () => {
        if (!document.getElementById('profile-page')?.classList.contains('hidden')) {
            _renderDriveSection();
        }
    });
}

/* ── Stats computation ─────────────────────────────────────────────────────── */

function _computeStats() {
    const notes = getLocalNotes();
    let totalWords = 0;
    const hourCounts = new Array(24).fill(0);

    notes.forEach(n => {
        totalWords += n.content.split(/\s+/).filter(Boolean).length;
        const h = new Date(n.timestamp).getHours();
        if (h >= 0 && h < 24) hourCounts[h]++;
    });

    const maxCount = Math.max(...hourCounts, 0);
    const peakHour = maxCount > 0 ? hourCounts.indexOf(maxCount) : -1;

    const currentStreak = parseInt(localStorage.getItem('focus_streak') || '0', 10);
    const bestStreak    = Math.max(
        currentStreak,
        parseInt(localStorage.getItem('best_focus_streak') || '0', 10),
    );

    return {
        totalWords,
        totalNotes: notes.length,
        totalDays:  new Set(notes.map(n => n.dateKey)).size,
        peakHour,
        currentStreak,
        bestStreak,
    };
}

function _fmtHour(h) {
    if (h < 0)  return '—';
    if (h === 0)  return '12 AM';
    if (h < 12)   return `${h} AM`;
    if (h === 12) return '12 PM';
    return `${h - 12} PM`;
}

function _renderStats() {
    const grid = document.getElementById('stats-grid');
    if (!grid) return;
    const { totalWords, totalNotes, totalDays, peakHour, currentStreak, bestStreak } = _computeStats();

    const items = [
        { icon: '✍️', value: totalWords.toLocaleString(), label: 'Words written'  },
        { icon: '📝', value: totalNotes.toLocaleString(), label: 'Notes saved'    },
        { icon: '📅', value: totalDays.toLocaleString(),  label: 'Days journaled' },
        { icon: '⚡', value: _fmtHour(peakHour),          label: 'Peak hour'      },
        { icon: '🍅', value: String(currentStreak),       label: 'Focus streak'  },
        { icon: '🏆', value: String(bestStreak),          label: 'Best streak'   },
    ];

    grid.innerHTML = '';
    items.forEach(({ icon, value, label }) => {
        const card    = document.createElement('div');  card.className    = 'stat-card';
        const iconEl  = document.createElement('div');  iconEl.className  = 'stat-card__icon';
        const valEl   = document.createElement('div');  valEl.className   = 'stat-card__value';
        const labelEl = document.createElement('div');  labelEl.className = 'stat-card__label';
        iconEl.textContent  = icon;
        valEl.textContent   = value;
        labelEl.textContent = label;
        card.append(iconEl, valEl, labelEl);
        grid.appendChild(card);
    });
}

/* ── Drive section ─────────────────────────────────────────────────────────── */

function _renderDriveSection() {
    const wrap = document.getElementById('drive-profile-status');
    if (!wrap) return;
    wrap.innerHTML = '';

    if (isAuthenticated()) {
        const email = getUserEmail();

        const row   = document.createElement('div');
        row.className = 'drive-status-row drive-status-row--connected';

        const left  = document.createElement('div');  left.className = 'drive-status-left';
        const dot   = document.createElement('span'); dot.className  = 'drive-dot drive-dot--on';
        const info  = document.createElement('div');  info.className = 'drive-info';

        const emailEl  = document.createElement('div'); emailEl.className  = 'drive-email';
        emailEl.textContent = email ?? 'Connected';

        const sub = document.createElement('div');  sub.className = 'drive-sublabel';
        sub.textContent = 'Google Drive sync active';

        info.append(emailEl, sub);
        left.append(dot, info);

        const actions     = document.createElement('div'); actions.className = 'drive-actions';

        const syncBtn = document.createElement('button');
        syncBtn.className   = 'drive-btn drive-btn--ghost';
        syncBtn.textContent = '↻ Sync now';
        syncBtn.addEventListener('click', async () => {
            syncBtn.textContent = '⏳';
            syncBtn.disabled    = true;
            await syncWithDrive();
            syncBtn.textContent = '↻ Sync now';
            syncBtn.disabled    = false;
        });

        const discBtn = document.createElement('button');
        discBtn.className   = 'drive-btn drive-btn--danger';
        discBtn.textContent = 'Disconnect';
        discBtn.addEventListener('click', () => {
            disconnectDrive();
            _renderDriveSection();
            showToast('Disconnected from Google Drive');
        });

        actions.append(syncBtn, discBtn);
        row.append(left, actions);
        wrap.appendChild(row);

    } else {
        const row = document.createElement('div');
        row.className = 'drive-status-row drive-status-row--disconnected';

        const dot  = document.createElement('span'); dot.className  = 'drive-dot drive-dot--off';
        const info = document.createElement('div');  info.className = 'drive-info';

        const mainLabel = document.createElement('div'); mainLabel.className = 'drive-email';
        mainLabel.textContent = 'Not connected';
        const sub = document.createElement('div'); sub.className = 'drive-sublabel';
        sub.textContent = 'Connect to sync notes across devices';
        info.append(mainLabel, sub);

        const connectBtn = document.createElement('button');
        connectBtn.className   = 'drive-btn drive-btn--primary';
        connectBtn.textContent = 'Connect Drive';
        connectBtn.addEventListener('click', handleAuthClick);

        row.append(dot, info, connectBtn);
        wrap.appendChild(row);
    }
}

/* ── Profile card ──────────────────────────────────────────────────────────── */

function _getTimezones() {
    try {
        return Intl.supportedValuesOf('timeZone');
    } catch (e) {
        return [
            'UTC',
            'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
            'America/Toronto', 'America/Vancouver', 'America/Sao_Paulo',
            'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
            'Europe/Rome', 'Europe/Moscow', 'Europe/Istanbul',
            'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore',
            'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
            'Australia/Sydney', 'Pacific/Auckland',
        ];
    }
}

function _renderProfileCard() {
    const nameInput = document.getElementById('profile-name-input');
    const avatarEl  = document.getElementById('profile-avatar-large');
    const tzSelect  = document.getElementById('profile-tz-select');

    if (nameInput) nameInput.value = localStorage.getItem('profile_name') || '';

    if (avatarEl) {
        const name = localStorage.getItem('profile_name') || '';
        avatarEl.textContent = name.trim() ? name.trim()[0].toUpperCase() : '?';
    }

    if (tzSelect && !tzSelect.dataset.populated) {
        tzSelect.dataset.populated = '1';
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const current  = localStorage.getItem('profile_timezone') || detected;
        _getTimezones().forEach(tz => {
            const opt = document.createElement('option');
            opt.value       = tz;
            opt.textContent = tz.replace(/_/g, ' ');
            if (tz === current) opt.selected = true;
            tzSelect.appendChild(opt);
        });
    } else if (tzSelect) {
        tzSelect.value = localStorage.getItem('profile_timezone')
            || Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
}

/* ── Preferences ───────────────────────────────────────────────────────────── */

function _renderPreferences() {
    // Dark mode toggle
    const dmBtn = document.getElementById('pref-dark-mode-btn');
    if (dmBtn) {
        const isDark = document.body.classList.contains('dark-mode');
        dmBtn.textContent = isDark ? '🌙 Dark' : '☀️ Light';
    }

    // Accent swatches
    const swatchWrap = document.getElementById('accent-swatches');
    if (swatchWrap) {
        swatchWrap.innerHTML = '';
        const saved  = localStorage.getItem('profile_accent') || 'Blue';
        const isDark = document.body.classList.contains('dark-mode');
        ACCENT_PRESETS.forEach(preset => {
            const btn = document.createElement('button');
            btn.className = 'accent-swatch' + (preset.name === saved ? ' accent-swatch--active' : '');
            btn.style.background = isDark ? preset.dark : preset.light;
            btn.setAttribute('aria-label', `${preset.name} accent colour`);
            btn.title = preset.name;
            btn.addEventListener('click', () => {
                localStorage.setItem('profile_accent', preset.name);
                applyAccent(preset.name);
                swatchWrap.querySelectorAll('.accent-swatch').forEach((s, i) =>
                    s.classList.toggle('accent-swatch--active', ACCENT_PRESETS[i].name === preset.name)
                );
            });
            swatchWrap.appendChild(btn);
        });
    }

    // Pomodoro steppers
    _setPomoVal('pomo-work-val',  'pomo_work_mins',  25);
    _setPomoVal('pomo-short-val', 'pomo_short_mins',  5);
    _setPomoVal('pomo-long-val',  'pomo_long_mins',  15);

    // Reminder
    const remSelect = document.getElementById('pref-reminder-select');
    if (remSelect) remSelect.value = localStorage.getItem('checkin_interval') || '0';
}

function _setPomoVal(id, key, def) {
    const el = document.getElementById(id);
    if (el) el.textContent = localStorage.getItem(key) || String(def);
}

/* ── Full render ───────────────────────────────────────────────────────────── */

export function renderProfilePage() {
    _renderProfileCard();
    _renderStats();
    _renderDriveSection();
    _renderPreferences();
}

/* ── Event wiring ──────────────────────────────────────────────────────────── */

export function wireProfileEvents() {

    // Name input → live avatar update
    const nameInput = document.getElementById('profile-name-input');
    nameInput?.addEventListener('input', () => {
        const name    = nameInput.value.slice(0, 50);
        localStorage.setItem('profile_name', name.trim());
        const initial = name.trim() ? name.trim()[0].toUpperCase() : '?';
        const large = document.getElementById('profile-avatar-large');
        if (large) large.textContent = initial;
        renderNavAvatar();
    });

    // Timezone
    const tzSelect = document.getElementById('profile-tz-select');
    tzSelect?.addEventListener('change', () =>
        localStorage.setItem('profile_timezone', tzSelect.value)
    );

    // Dark-mode toggle (mirrors the nav Theme button logic)
    const dmBtn = document.getElementById('pref-dark-mode-btn');
    dmBtn?.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('dark_mode', String(isDark));
        const icon  = document.getElementById('theme-icon');
        const tcMeta = document.getElementById('theme-color-meta');
        if (icon)   icon.textContent = isDark ? '🌙' : '☀️';
        if (tcMeta) tcMeta.setAttribute('content', isDark ? '#111010' : '#f5f4f0');
        dmBtn.textContent = isDark ? '🌙 Dark' : '☀️ Light';
        // Re-apply accent so dark/light shade is correct
        applyAccent(localStorage.getItem('profile_accent') || 'Blue');
        // Keep accent swatches in sync
        const swatchWrap = document.getElementById('accent-swatches');
        if (swatchWrap) {
            const saved = localStorage.getItem('profile_accent') || 'Blue';
            swatchWrap.querySelectorAll('.accent-swatch').forEach((s, i) => {
                s.style.background = isDark ? ACCENT_PRESETS[i].dark : ACCENT_PRESETS[i].light;
            });
        }
    });

    // Pomodoro steppers
    _wirePomoStepper('pomo-work-val',  'pomo_work_mins',  1, 90);
    _wirePomoStepper('pomo-short-val', 'pomo_short_mins', 1, 30);
    _wirePomoStepper('pomo-long-val',  'pomo_long_mins',  1, 60);

    // Reminder
    const prefRem = document.getElementById('pref-reminder-select');
    prefRem?.addEventListener('change', async () => {
        const mins = parseInt(prefRem.value, 10);
        const ok   = await setReminderInterval(mins);
        if (!ok) prefRem.value = localStorage.getItem('checkin_interval') || '0';
    });
}

function _wirePomoStepper(valId, storageKey, min, max) {
    const valEl  = document.getElementById(valId);
    const decBtn = document.getElementById(valId.replace('-val', '-dec'));
    const incBtn = document.getElementById(valId.replace('-val', '-inc'));
    if (!valEl || !decBtn || !incBtn) return;

    const _get = () => parseInt(localStorage.getItem(storageKey) || valEl.textContent, 10) || min;
    const _set = v => {
        v = Math.max(min, Math.min(max, v));
        localStorage.setItem(storageKey, String(v));
        valEl.textContent = v;
    };

    decBtn.addEventListener('click', () => _set(_get() - 1));
    incBtn.addEventListener('click', () => _set(_get() + 1));
}
