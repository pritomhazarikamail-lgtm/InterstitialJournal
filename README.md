# 📓 Interstitial Journal

A fast, private, PWA-installable journal built around **interstitial logging** — the practice of capturing short, time-stamped notes between tasks throughout your day rather than writing a single end-of-day entry. Think of it as a personal captain's log.

**[➜ Open the App](https://pritomhazarikamail-lgtm.github.io/InterstitialJournal/)**

---

## What is Interstitial Journaling?

Most journaling systems ask you to reflect once a day. Interstitial journaling flips this: you log a quick note every time you switch tasks — what you just finished, what you're starting, any blockers or wins. Over time this creates a rich, time-stamped record of your actual workday, not just what you remember at 10 pm.

---

## Features

### ✍️ Write
- **Quick capture** — focused textarea with a 5,000-character limit and live counter
- **Auto-save draft** — your in-progress note is saved on every keystroke and restored on reload; accidental refreshes never lose work
- **Voice to text** — tap 🎤 to dictate; transcribed text appends to the textarea (button hidden automatically on browsers without Web Speech API support)
- **Distraction-free mode** — tap "Focus" to hide everything except the textarea; tap again or press Esc to return
- **Slash commands** — type `/` to insert structured entries:
  - `/win` — log a win or achievement
  - `/todo` — add a checkbox task (tap `☐` on any saved todo to mark it done)
  - `/block` — tag a distraction or blocker
  - `/handoff` — log a task transition (`🔄 Switching from: ...`) with `#transition` tag
  - `/focus` — note your current focus
  - `/idea` — capture a quick idea
  - `/note` — plain note with no prefix
- **#tag support** — any `#hashtag` in your note is extracted and indexed automatically
- **Tag suggestions** — as you type (≥20 chars), your most-used tags appear as pills below the textarea; tap to append. Instant, no AI required.
- **Next Up field** — set your next task before saving; it becomes the placeholder for your next entry, keeping your train of thought
- **Recent strip** — the last 3 entries shown on the write page so you always have context

### 🎯 Daily Intention
- On the first open of each day, a banner prompts *"What's the one thing that would make today a win?"*
- The answer is saved as a `#intention #focus` note
- A **persistent anchor strip** stays visible in the write page all day — `Today's goal  [your text]  [✓ Done]` — so you never lose sight of what you're working toward
- Tap **✓ Done** to save a `✅ Achieved today's intention #achieved #intention` note with a timestamp, marking exactly when you completed it
- The intention text and achieved state survive page reloads and sync across devices via Google Drive
- Tap Skip on the banner to dismiss without saving

### 🔔 Check-in Reminders
- Configurable nudge interval: **15 min**, **30 min**, or **1 hour** (off by default)
- Fires a browser notification only when the tab is in the background — no interruption if you're already in the app
- Notifications stack into one using `tag: 'checkin'` rather than piling up
- Sent via **Service Worker** (`registration.showNotification()`) so they work on **Android Chrome and iOS 16.4+ PWA** — not the page-level `new Notification()` constructor which is blocked on mobile
- Uses `visibilitychange` + a stored last-fire timestamp for reliable timing on mobile — not `setInterval`, which gets suspended when the tab is backgrounded
- Preference saved across sessions; browser permission requested once
- On iOS: notifications require the app to be installed via "Add to Home Screen"

### 📅 History
- **Calendar heatmap** — colour-coded grid showing days by entry volume (4 intensity levels)
- **Jump to Today** — "Today" button in the history header snaps the calendar to the current month and opens today's notes in one tap
- **Journal streak badge** — shows your current consecutive-day journaling streak (🔥 N-day streak) next to the month header
- **Day digest** — when you open any day, a stats bar shows entry count, total tracked time, word count, and top tags at a glance (e.g. `7 entries · 3h 20m tracked · 142 words · #focus ×3 · #win ×2`)
- **Weekly digest** — tap 📊 to open a bottom-sheet with a per-day bar chart, total entries, total words, and top 5 tags for the current ISO week
- **Timeline view** — entries shown chronologically with time-gap badges between them (e.g. "⏱️ 42m gap")
- **Note type color accents** — a left border highlights each note's type at a glance: green for wins/done, blue for todos, red for blockers, amber for handoffs, accent for focus, purple for ideas
- **Expand / collapse long notes** — notes longer than 300 characters are collapsed to 4 lines with a "Show more" toggle
- **Pinned entries** — pin important notes to float them to the top of any day's view; they also appear in their real chronological position in the timeline so gap times are always accurate
- **Tag cloud** — all tags sorted by frequency, with a two-row cap and overflow popover
- **Full-text search** — debounced, with highlighted matches
- **Tag filter** — tap any tag to filter all notes with that tag; notes show full pin/edit/delete actions
- **Date range filter** — filter the timeline to any custom date range
- **Keyboard navigation** — use ↑/↓ arrow keys to move between note cards when not in an input field

### ✅ Todo Completion
- Any note starting with `☐` renders the checkbox as a tappable button
- Tapping it saves a `✅ Done: [task] #done` completion note with the current timestamp
- The checkbox disables immediately on first tap to prevent duplicate completions
- The original note is preserved — the completion note is the record of when it finished

### 🗑️ Swipe to Delete (with Undo)
- Swipe any note card left to delete it instantly; the day view updates immediately
- A 5-second **Undo** button appears in the toast — tap it to restore the note in place
- If not undone, the deletion is tombstoned and propagated to Drive sync

### 🎯 Focus (Pomodoro)
- **25/5/15 Pomodoro timer** — animated SVG ring, long break every 4 rounds
- **Pause / Resume** — without losing progress
- **Auto-logging** — each completed round and session finish are saved as notes automatically
- **Dopamine streak** — 3 completed focus sessions lights up the streak dots with a celebration

### ✨ AI Features (100% On-Device)
All AI runs entirely in your browser via [WebLLM](https://github.com/mlc-ai/web-llm) — no data ever leaves your device. The model downloads once, is cached in IndexedDB, and works offline forever after. Two model options:
- **Llama 3.2 1B** (~700 MB, recommended)
- **SmolLM2 360M** (~200 MB) — lightest option

**All AI is intentional (button-triggered) — nothing runs automatically in the background.** This keeps the app fast and responsive at all times; on-device GPU inference would otherwise block rendering.

- **AI Day Summary** — click Summarize on any day to get structured **Wins**, **Themes**, and a **Reflection**. This also loads the model into memory for the session.
- **Note cleanup** — tap ✨ on any note card to fix grammar and clarity while preserving meaning.

### ☁️ Google Drive Sync *(optional)*
- Entirely optional — the app is fully functional without ever signing in
- Syncs your journal to Google Drive `appDataFolder` — a private, app-sandboxed space no other app or person can access
- **Last-writer-wins merge** for multi-device use
- **Tombstone-based deletion** so deleted notes stay deleted across all devices; each tombstone records its deletion timestamp so pruning is based on when the note was deleted, not when it was created
- Syncs focus streak, daily intention (text + achieved state), and Next Up across devices
- When Drive sync delivers a daily intention from another device, the anchor strip appears instantly without requiring a page reload
- Silent background sync on tab focus and every 5 minutes when signed in; `visibilitychange` listener registered exactly once — no duplicate listeners
- OAuth token auto-refreshes 5 minutes before expiry — session stays alive indefinitely without prompting
- Google Sign-In SDK load is retried for up to ~10 s then silently abandoned — ad-blockers and offline starts cause no errors or loops
- **Offline indicator** — the Sync button shows `📵 Offline` when disconnected and restores automatically

### 📦 Data Portability
- **Export → JSON** — full machine-readable backup of all notes
- **Export → Markdown** — human-readable, grouped by date with timestamps
- **Export → Print / PDF** — browser print dialog with a clean `@media print` layout
- **Import** — load a JSON backup; notes are **merged** with last-writer-wins strategy and tombstone filtering (deliberately deleted notes are never restored). A confirmation modal shows the note count before committing.

### 🌙 Appearance
- Dark mode by default
- One-tap light/dark toggle; preference persisted across sessions
- Smooth page transitions — pages fade and slide in when switching views
- Staggered card entrance animations and press-feedback on buttons
- Haptic feedback on save, delete, and pin (on supported devices)

---

## Getting Started

### Use it directly
Visit **[https://pritomhazarikamail-lgtm.github.io/InterstitialJournal/](https://pritomhazarikamail-lgtm.github.io/InterstitialJournal/)** — no account required. All data is stored locally in your browser.

### Install as a PWA

| Platform | Steps |
|---|---|
| Android (Chrome) | Tap the **"Add to Home Screen"** banner, or browser menu → *Install App* |
| iOS (Safari) | Tap the **Share** button → *Add to Home Screen* |
| Desktop (Chrome/Edge) | Click the install icon in the address bar |

Once installed, the app runs fully offline.

### Self-host

```
index.html          ← HTML structure
style.css           ← All styles
app.js              ← Orchestrator (imports from modules/)
manifest.json       ← PWA metadata
sw.js               ← Service worker (offline caching, v25)
modules/            ← Feature modules
icon-512.webp / icon-512.png / icon-192.webp / icon-192.png
icon-180.png / icon-152.png / icon-120.png
```

Clone and serve from any static host:

```bash
git clone https://github.com/pritomhazarikamail-lgtm/InterstitialJournal.git
cd InterstitialJournal

npx serve .
# or
python3 -m http.server 8080
```

> **Note:** Pomodoro audio, WebLLM, and the service worker all require HTTPS in production. `localhost` is treated as secure by all modern browsers.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl + Enter` / `⌘ + Enter` | Save note |
| `Enter` | Submit daily intention |
| `/` at start of line | Open slash command menu |
| `↑` / `↓` in slash menu | Navigate slash command options |
| `↑` / `↓` in day view | Navigate between note cards |
| `Enter` or `Tab` | Apply selected slash command |
| `Escape` | Close slash menu / modal / intention banner / focus mode |

---

## Privacy & Security

- **All data stored locally** — `localStorage` in your browser. No server, no database.
- **No analytics, no ads, no tracking** of any kind.
- **Google Drive sync is optional** — uses the `drive.appdata` scope, sandboxed exclusively to this app. No other Drive files are readable or writable.
- **OAuth token in memory only** — never written to `localStorage` or cookies. Auto-refreshed silently before expiry.
- **Content Security Policy** — defined in the HTML `<meta>` header. `'unsafe-inline'` is absent from `script-src`; `'wasm-unsafe-eval'` is present only for WebLLM/WASM. Blocks all unknown origins for scripts, connections, and frames.
- **XSS protection** — all user content is rendered via `textContent` and DOM text nodes. No user string ever touches `innerHTML`.
- **Input validation** — every note from Drive, import, or user input is validated against a strict schema before touching storage.
- **Collision-safe note IDs** — IDs are generated with a monotonic counter so two saves in the same millisecond always produce unique IDs.
- **On-device AI** — the LLM runs entirely in your browser. Your notes are never sent anywhere.

---

## Project Structure

```
InterstitialJournal/
├── index.html           # App shell — HTML structure only
├── style.css            # All styles, 36 labelled sections
├── app.js               # Thin orchestrator — slash commands, event wiring, init
├── modules/
│   ├── state.js         # Shared UI filter state (uiState)
│   ├── storage.js       # Security helpers, notes cache, date/tag indices, monotonic ID generation, deletion timestamps
│   ├── modal.js         # Custom modal (replaces prompt/confirm)
│   ├── toast.js         # Ephemeral toasts + Undo toast (showUndoToast)
│   ├── timer.js         # Live clock + "time since last entry" nudge
│   ├── write.js         # Next Up field + Recent strip
│   ├── draft.js         # Auto-save textarea draft between sessions
│   ├── drive.js         # Google Drive sync + offline indicator
│   ├── calendar.js      # Calendar heatmap, day timeline, day digest, note cards, tag cloud
│   ├── crud.js          # saveNote, editNote, deleteNote, pinNote, completeTodo, swipeDeleteNote, toggleDarkMode
│   ├── pomodoro.js      # Focus timer, Pomodoro cycle, streak UI
│   ├── ai.js            # On-device AI via WebLLM — day summary, note cleanup
│   ├── search.js        # Full-text search, tag filter, date range filter
│   ├── nav.js           # Page navigation, export/import
│   ├── reminders.js     # Periodic check-in notifications (visibilitychange + timestamp)
│   ├── intention.js     # Once-per-day intention banner + persistent anchor + achieved tracking
│   ├── haptic.js        # Haptic feedback wrapper (navigator.vibrate)
│   ├── voice.js         # Voice-to-text via Web Speech API
│   └── weekly.js        # Weekly digest modal (bar chart + stats)
├── manifest.json        # PWA manifest
├── sw.js                # Service worker v25 (pre-caches all shell assets)
└── icon-*.webp / *.png  # App icons (512, 192, 180, 152, 120 px)
```

### `modules/` dependency tree

```
state.js          (no deps)
storage.js        (no deps)
modal.js          (no deps)
toast.js          (no deps)
haptic.js         (no deps)
timer.js          ← storage
write.js          ← storage
draft.js          ← (DOM only — no module deps)
voice.js          ← toast
ai.js             ← storage                 (dynamic import of WebLLM; fires 'ai-ready' DOM event)
calendar.js       ← storage, state          (fires custom DOM events instead of importing crud/search)
weekly.js         ← storage, calendar
drive.js          ← storage, toast, calendar, pomodoro
search.js         ← storage, state, calendar
crud.js           ← storage, modal, toast, haptic, drive, calendar, write, timer
pomodoro.js       ← toast, modal, crud, drive, timer
reminders.js      ← toast
intention.js      ← crud, write, storage, toast
nav.js            ← storage, state, calendar, write, toast, modal
app.js            ← all modules             (routes note-pin/edit/delete/complete/swipe-delete/tag-filter/note-cleanup events)
```

Circular dependencies are broken with custom DOM events: `buildNoteCard` fires `note-pin`, `note-edit`, `note-delete`, `note-complete`, `note-swipe-delete`, and `tag-filter` on `document`. `app.js` listens for all of these and routes them to the appropriate functions.

---

## Browser Compatibility

| Feature | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Core journaling | ✅ | ✅ | ✅ |
| PWA install | ✅ | ✅ | ✅ iOS 16.4+ |
| Check-in reminders | ✅ | ✅ | ✅ PWA only on iOS |
| Voice to text | ✅ | ❌ | ✅ |
| Haptic feedback | ✅ Android | ❌ | ❌ |
| AI Summary + features | ✅ WebGPU | ❌ no WebGPU yet | ✅ macOS 14+ |
| Offline | ✅ | ✅ | ✅ |
| Google Drive Sync | ✅ | ✅ | ✅ |
| Print / PDF export | ✅ | ✅ | ✅ |

---

## License

[MIT](LICENSE.md) — do whatever you like with it.

---

## Acknowledgements

- [WebLLM](https://github.com/mlc-ai/web-llm) by MLC AI — on-device LLM inference in the browser
- [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) + [DM Sans](https://fonts.google.com/specimen/DM+Sans) — Google Fonts
- [Interstitial journaling](https://nesslabs.com/interstitial-journaling) - Tony Stubblebine
