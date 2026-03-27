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
- **Slash commands** — type `/` to insert structured entries:
  - `/win` — log a win or achievement
  - `/todo` — add a checkbox task
  - `/block` — tag a distraction or blocker
  - `/focus` — note your current focus
  - `/idea` — capture a quick idea
  - `/note` — plain note with no prefix
- **#tag support** — any `#hashtag` in your note is extracted and indexed automatically
- **Next Up field** — set your next task before saving; it becomes the placeholder for your next entry, keeping your train of thought
- **Recent strip** — the last 3 entries shown on the write page so you always have context

### 📅 History
- **Calendar heatmap** — colour-coded grid showing days by entry volume (4 intensity levels)
- **Timeline view** — entries shown chronologically with time-gap badges between them (e.g. "⏱️ 42m gap")
- **Pinned entries** — pin important notes to float them to the top of any day's view; they also appear in their real chronological position in the timeline below, so gap times always reflect actual elapsed time
- **Tag cloud** — all tags sorted by frequency, with a two-row cap and overflow popover
- **Full-text search** — debounced, with highlighted matches
- **Date range filter** — filter the timeline to any custom date range using the date pickers above the calendar; clears automatically when a tag or calendar day is selected

### 🎯 Focus (Pomodoro)
- **25/5/15 Pomodoro timer** — animated SVG ring, long break every 4 rounds
- **Pause / Resume** — without losing your progress
- **Auto-logging** — each completed round and session finish are saved as notes automatically
- **Dopamine streak** — 3 completed focus sessions lights up the streak dots with a celebration

### ✨ AI Day Summary (100% On-Device)
- Summarises your day's notes into **Wins**, **Themes**, and a **Reflection**
- Runs entirely in your browser via [WebLLM](https://github.com/mlc-ai/web-llm) — no data ever leaves your device
- Two model options:
  - **Llama 3.2 1B** (~700 MB, recommended) — structured output with all three sections
  - **SmolLM2 360M** (~200 MB) — lightest option, plain reflection style
- Downloaded once, cached in IndexedDB, works offline forever after

### ☁️ Google Drive Sync
- Syncs your journal to Google Drive `appDataFolder` — a private, app-sandboxed space no other app or person can access
- **Last-writer-wins merge** for multi-device use
- **Tombstone-based deletion** so deleted notes stay deleted across all devices
- Silent background sync every 3 minutes when signed in
- OAuth token lives in memory only — never written to disk or cookies

### 📦 Data Portability
- **Export → JSON** — full machine-readable backup of all notes
- **Export → Markdown** — human-readable, grouped by date with timestamps
- **Export → Print / PDF** — browser print dialog with a clean `@media print` layout that strips all chrome and renders only the notes
- **Import** — load a JSON backup; every note is validated against the schema before touching storage

### 🌙 Appearance
- Dark mode by default
- One-tap light/dark toggle; preference persisted across sessions

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
index.html       ← HTML structure
style.css        ← All styles
app.js           ← All logic (ES module)
manifest.json    ← PWA metadata
sw.js            ← Service worker (offline caching, v18)
journal_icon.png ← App icon
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
| `/` at start of line | Open slash command menu |
| `↑` / `↓` | Navigate slash command menu |
| `Enter` or `Tab` | Apply selected slash command |
| `Escape` | Close slash command menu / modal |

---

## Privacy & Security

- **All data stored locally** — `localStorage` in your browser. No server, no database.
- **No analytics, no ads, no tracking** of any kind.
- **Google Drive sync is optional** — uses the `drive.appdata` scope, sandboxed exclusively to this app. No other Drive files are readable or writable.
- **OAuth token in memory only** — never written to `localStorage` or cookies. Cleared after 55 minutes.
- **Content Security Policy** — defined in the HTML `<meta>` header. Blocks all unknown origins for scripts, connections, and frames.
- **XSS protection** — all user content is rendered via `textContent` and DOM text nodes. No user string ever touches `innerHTML`.
- **Input validation** — every note from Drive, import, or user input is validated against a strict schema before touching storage.
- **On-device AI** — the LLM summarisation runs entirely in your browser. Your notes are never sent anywhere.

---

## Project Structure

```
InterstitialJournal/
├── index.html        # App shell — HTML structure only (~350 lines)
├── style.css         # All styles, 22 labelled sections (~1370 lines)
├── app.js            # All logic as an ES module, 17 sections (~1850 lines)
├── manifest.json     # PWA manifest
├── sw.js             # Service worker v18
├── journal_icon.png  # App icon
└── README.md
```

### `app.js` sections

1. Security helpers (`sanitiseId`, `validateNote`, `safeJSON`)
2. Notes cache (localStorage wrapper with invalidation)
3. Custom modal (replaces `prompt()` / `confirm()`)
4. Toast notifications
5. Config & state (including `_activeTag`, `_dateFrom`, `_dateTo`)
6. Slash commands
7. Next Up field
8. Recent strip
9. Google Drive sync
10. Pomodoro + Focus timer
11. CRUD (`saveNote`, `editNote`, `deleteNote`, `pinNote`, `toggleDarkMode`)
12. Calendar & History (`renderCalendar`, `showNotesForDay`, `buildNoteCard`)
13. AI summary (on-device via WebLLM)
14. Search & Tags (`searchNotes`, `filterByDateRange`, `filterByTag`, `renderTagCloud`)
15. Navigation & utilities (`exportJSON`, `exportMarkdown`, `exportPrint`)
16. Event wiring
17. Init

### `style.css` sections

1–18: Design Tokens, Base, Layout, Cards & Timeline, Form Elements, Buttons, Tags & Tag Cloud, Search, Calendar, Home Header, Recent Strip, Focus Card & Pomodoro Ring, Modal, Toast, AI Summary, Slash Command Dropdown, Next Up Field, Misc/Utilities

19–22 (new): Pinned Entries, Export Dropdown, Date Range Filter, Print/PDF (`@media print`)

---

## Browser Compatibility

| Feature | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| Core journaling | ✅ | ✅ | ✅ |
| PWA install | ✅ | ✅ | ✅ iOS 16.4+ |
| AI Summary | ✅ WebGPU | ❌ no WebGPU yet | ✅ macOS 14+ |
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
