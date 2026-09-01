# DayFlow

AI-powered task manager with end-to-end encryption. Built with React Native (Expo) for iPhone, iPad, Mac, and Web.

**Owner:** Tewodros Ashenafi
**License:** MIT

## Features

- **Natural Language Input** — Type or speak "Call Mekdi tomorrow at 11am urgent" and the task is created with the right date, time and priority
- **Voice Commands** — Speak naturally to create tasks (web speech recognition)
- **Voice Notes** — Hold to record voice memos attached to tasks
- **End-to-End Encryption** — Task titles, notes, amounts and names are encrypted with AES-256 before they touch storage. Only you have the key.
- **One Page, Two Columns** — To Do and Owe Me sit side by side on a single A4-proportioned sheet, divided by a ruled line
- **Day/Week/Month Views** — Tasks are scoped to their view for clear separation
- **Daily Briefing** — Progress, high-priority items and owed totals at a glance, with an optional Claude-written summary
- **Quick Actions** — Double-tap to complete, long-press for options, swipe to delete
- **Calendar Sync** — Push any dated task to your device calendar from the quick-actions sheet
- **Owe Me** — A follow-up column for what other people owe *you*: the task, who you are waiting on, and when to chase it
- **Reminders** — Local notifications at the due time, with early-reminder options
- **Persistent Storage** — Tasks survive restarts via encrypted AsyncStorage
- **Encrypted Sync** — Sign in on each device and they share the same tasks. The server stores only ciphertext; the key is derived from your password and never leaves the device
- **Multi-Platform** — iPhone, iPad, Mac (Electron), and Web

## Quick Start

```bash
cd dayflow
npm install
npx expo start           # dev server (press w for web, i for iOS)
npm run build:web        # installable web app -> web-build/
npm run api              # optional API server (AI + Supabase) on :3001
```

DayFlow runs fully offline out of the box — no account, no keys, no network.
The optional cloud and AI features are configured through `.env`; copy
`.env.example` to get started.

## Install it

| Where | How | Notes |
|---|---|---|
| **Web** | `https://twdashenafi-beep.github.io/Claude/` | Deployed by `.github/workflows/pages.yml` |
| **iPhone / iPad** | Open that URL in Safari → Share → **Add to Home Screen** | Full-screen, works offline, free |
| **iPhone / iPad (native)** | `eas build --platform ios --profile production` → TestFlight | Adds reminders and calendar sync; needs an Apple Developer account |
| **Mac** | `cd electron && npm run build` | `.dmg` in `release/` |
| **Trying it out** | `npx expo start`, scan the QR with Expo Go | No install, runs while your machine serves |

Full instructions, including the one-time GitHub Pages switch, are in
[SETUP.md](SETUP.md).

## Tech Stack

- **Framework:** React Native + Expo SDK 55
- **Encryption:** CryptoJS (AES-256, PBKDF2 key derivation)
- **Storage:** AsyncStorage (local), Supabase (optional encrypted sync)
- **Notifications:** expo-notifications
- **Audio:** expo-audio
- **NLP:** Custom natural language parser
- **AI:** Claude via the DayFlow API server (optional)
- **Desktop:** Electron wrapper for macOS

## Project Structure

```
dayflow/
├── App.js                          # Entry point with encryption gate
├── index.js                        # Expo root registration
├── api-server.js                   # Optional backend: Claude proxy + Supabase
├── app.json                        # Expo configuration
├── app.config.js                   # Layers in the web base path per build
├── eas.json                        # EAS Build configuration
├── .env.example                    # Environment template
├── electron/                       # macOS Electron wrapper
│   ├── main.js                     # Electron main process
│   └── package.json                # Electron build config
├── src/
│   ├── components/
│   │   ├── AIInput.js              # Natural language + voice input bar
│   │   ├── AddTaskModal.js         # Task creation form
│   │   ├── ConfettiOverlay.js      # Celebration when a view is cleared
│   │   ├── DailyBriefing.js        # Daily briefing modal
│   │   ├── MasterPasswordScreen.js # Encryption setup/unlock
│   │   ├── QuickActions.js         # Long-press action sheet
│   │   ├── TaskDetail.js           # Task edit screen
│   │   ├── TaskItem.js             # Individual task row
│   │   ├── ViewToggle.js           # Day/Week/Month switch
│   │   └── VoiceRecorder.js        # Voice recording + playback
│   ├── context/
│   │   └── TaskContext.js          # Task state + encrypted persistence
│   ├── screens/
│   │   └── TodoScreen.js           # Main screen (To Do + Owe Me tabs)
│   ├── services/
│   │   ├── account.js              # Sign in / sign up (sends only an auth hash)
│   │   ├── ai.js                   # Claude client (talks to api-server.js)
│   │   ├── crypto.js               # Key derivation: auth hash vs encryption key
│   │   ├── merge.js                # Conflict policy (pure, tested)
│   │   ├── sync.js                 # Push/pull ciphertext rows
│   │   ├── calendar.js             # Device calendar sync
│   │   ├── encryption.js           # AES-256 encryption service
│   │   ├── nlParser.js             # Natural language parser
│   │   ├── notifications.js        # Local notification scheduling
│   │   └── supabase.js             # Supabase client (optional)
│   └── utils/
│       ├── constants.js            # App constants
│       └── id.js                   # Task id generation
├── scripts/make-pwa.js             # Adds manifest + service worker post-export
├── web/                            # Home-screen icons for the web app
├── supabase/schema.sql             # Cloud schema + RLS policies
└── assets/                         # Icons, splash screens
```

## Security

All task content (titles, notes, amounts, person names) is encrypted client-side
with AES-256 before being written to storage. The key is derived from your
master password with PBKDF2 (10,000 iterations, random salt) and never leaves
the device. Forget the password and the data is unrecoverable — by design.

**No secrets live in this repository.** The client bundle is public by
definition, so the Anthropic API key stays on the API server (`api-server.js`)
and the app reaches Claude only through it. Supabase credentials come from the
environment, and the anon key is safe to expose only because Row Level Security
scopes every row to its owner (see `supabase/schema.sql`).

## Configuration

Everything is optional. Copy `.env.example` to `.env` and set what you need:

| Variable | Side | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | client | Points the app at the API server; enables AI features |
| `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | client | Supabase cloud sync |
| `ANTHROPIC_API_KEY` | server | Used by `/ai/*` on the API server |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | server | Used by `/task` and `/tasks` |
| `PORT` | server | API server port (default 3001) |

`EXPO_PUBLIC_*` values are inlined into the app bundle and are therefore public.
Never put a secret behind that prefix.

## Building

See [SETUP.md](SETUP.md) for build instructions for all platforms.
