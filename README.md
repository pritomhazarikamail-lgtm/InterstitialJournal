# 📓 Interstitial Journal

A fast, private, PWA-installable journal designed around **interstitial logging** — the practice of capturing short, time-stamped notes between tasks throughout your day rather than writing a single end-of-day entry. Think of it as a personal captain's log.

**[➜ Open the App](https://pritomhazarikamail-lgtm.github.io/InterstitialJournal/)**

---

## What is Interstitial Journaling?

Most journaling systems ask you to reflect once a day. Interstitial journaling flips this: you log a quick note every time you switch tasks — what you just finished, what you're starting, any blockers or wins. Over time this creates a rich, time-stamped record of your actual workday, not just what you remember at 10 pm.

---

## Features

### ✍️ Write
- **Quick capture** — a focused textarea with a 5,000-character limit and live counter
- **Slash commands** — type `/` to insert structured entries: `/win`, `/todo`, `/block`, `/focus`, `/idea`
- **#tag support** — any `#hashtag` in your note is extracted and indexed automatically
- **Next Up field** — set your next task before saving; it becomes the placeholder for your next entry, keeping your train of thought
- **Recent strip** — the last 3 entries shown on the write page so you have context

### 📅 History
- **Calendar heatmap** — colour-coded grid showing days by entry volume (4 intensity levels)
- **Timeline view** — entries shown in order with time-gap badges between them (e.g. "⏱️ 42m gap")
- **Tag cloud** — all your tags sorted by frequency, with a two-row overflow popover
- **Full-text search** — debounced, with highlighted matches

### 🎯 Focus (Pomodoro)
- **25/5/15 Pomodoro timer** — animated SVG ring, long break every 4 rounds
- **Pause / Resume** — without losing your progress
- **Auto-logging** — each completed round and session finish are saved as notes automatically
- **Dopamine streak** — 3 completed focus sessions lights up the streak dots with a celebration

### ✨ AI Day Summary (100% On-Device)
- Summarises your day's notes into **Wins**, **Themes**, and a **Reflection**
- Runs entirely in your browser via [WebLLM](https://github.com/mlc-ai/web-llm) — no data ever leaves your device
- Two model options:
  - **Llama 3.2 1B** (~700 MB, recommended) — structured output with sections
  - **SmolLM2 360M** (~200 MB) — fastest, plain reflection style
- Downloaded once, cached in IndexedDB, works offline forever after

### ☁️ Google Drive Sync
- Syncs your journal to Google Drive `appDataFolder` — a private, app-sandboxed space no other app or human can see
- **Last-writer-wins** merge for multi-device use
- Tombstone-based deletion so deleted notes stay deleted across devices
- Silent background sync every 3 minutes when signed in
- Token lives in memory only — never persisted to disk

### 📦 Data Portability
- **Export** — download all notes as a formatted JSON file
- **Import** — load a JSON file back in; notes are validated and merged

### 🌙 Appearance
- Dark mode by default (matches the focused journaling aesthetic)
- One-tap light/dark toggle; preference persisted across sessions

---

## Getting Started

### Use it directly
Visit **[https://pritomhazarikamail-lgtm.github.io/InterstitialJournal/](https://pritomhazarikamail-lgtm.github.io/InterstitialJournal/)** — no account required. Data is stored locally in your browser.

### Install as a PWA
| Platform | Steps |
|---|---|
| Android (Chrome) | Tap the **"Add to Home Screen"** banner when it appears, or use the browser menu → *Install App* |
| iOS (Safari) | Tap the **Share** button → *Add to Home Screen* |
| Desktop (Chrome/Edge) | Click the install icon in the address bar |

Once installed, the app runs fully offline.

### Self-host
The entire app is three files:

```
index.html    ← HTML structure
style.css     ← All styles
app.js        ← All logic (ES module)
manifest.json ← PWA metadata
sw.js         ← Service worker (offline caching)
```

Clone the repo and serve from any static file host:

```bash
git clone https://github.com/pritomhazarikamail-lgtm/InterstitialJournal.git
cd InterstitialJournal

# Any static server works, e.g.:
npx serve .
# or
python3 -m http.server 8080
```

> **Note:** The Pomodoro audio, WebLLM, and service worker require HTTPS in production. `localhost` is treated as secure by all modern browsers.

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

This app was built with privacy as a first principle:

- **All data stored locally** — `localStorage` in your browser. No server, no database.
- **No analytics, no ads, no tracking** of any kind.
- **Google Drive sync is optional** — uses the `drive.appdata` scope, which is sandboxed exclusively to this app. No other Google Drive files are readable or writable.
- **OAuth token lives in memory only** — never written to `localStorage` or cookies. Cleared after 55 minutes.
- **Content Security Policy** — defined in the HTML `<meta>` header. Blocks all unknown origins for scripts, connections, and frames.
- **XSS protection** — all user content is rendered via `textContent` and DOM text nodes. No user string ever touches `innerHTML`.
- **Input validation** — every note imported from Drive or JSON is validated against a strict schema before touching storage.
- **On-device AI** — the LLM summarisation runs entirely in your browser. Your notes are never sent to any server.

---

## Project Structure

```
InterstitialJournal/
├── index.html        # App shell — HTML structure only
├── style.css         # All styles (design tokens → components)
├── app.js            # All logic as an ES module
├── manifest.json     # PWA manifest (name, icons, display mode)
├── sw.js             # Service worker — offline caching strategy
├── journal_icon.png  # App icon
└── README.md
```

`app.js` is organised into 17 clearly commented sections:

1. Security helpers (sanitise, validate, safeJSON)
2. Notes cache (localStorage wrapper with invalidation)
3. Custom modal (replaces `prompt()` / `confirm()`)
4. Toast notifications
5. Config & state
6. Slash commands
7. Next Up field
8. Recent strip
9. Google Drive sync
10. Pomodoro + Focus timer
11. CRUD (save / edit / delete / theme)
12. Calendar & History
13. AI summary (on-device via WebLLM)
14. Search & Tags
15. Navigation & utilities
16. Event wiring
17. Init

---

## Browser Compatibility

| Feature | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| Core journaling | ✅ | ✅ | ✅ |
| PWA install | ✅ | ✅ | ✅ (iOS 16.4+) |
| AI Summary | ✅ (WebGPU) | ❌ (no WebGPU yet) | ✅ (macOS 14+) |
| Offline | ✅ | ✅ | ✅ |
| Google Drive Sync | ✅ | ✅ | ✅ |

---

## License

[MIT](LICENSE.md) — do whatever you like with it.

---

## Acknowledgements

- [WebLLM](https://github.com/mlc-ai/web-llm) by MLC AI — on-device LLM inference in the browser
- [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) + [DM Sans](https://fonts.google.com/specimen/DM+Sans) — Google Fonts
- The concept of interstitial journaling is described by [Tiago Forte](https://fortelabs.com/blog/the-interstitial-journal-combining-notes-to-do-lists-and-time-tracking/)