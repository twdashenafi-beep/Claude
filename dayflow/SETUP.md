# DayFlow — Setup Guide

## Prerequisites

- Node.js 20+ (`brew install node`) — the API server uses `--env-file-if-exists`
- Xcode 15+ (for iOS builds)
- Apple Developer Account (for TestFlight)
- EAS CLI (`npm install -g eas-cli`) for device builds

## 1. Install

```bash
npm install
cp .env.example .env    # optional — every variable in it is optional
```

DayFlow runs with no configuration at all: tasks live in encrypted local
storage. `.env` only turns on the optional AI and cloud-sync features.

## 2. Run Locally

```bash
npx expo start           # then press w (web), i (iOS simulator), a (Android)
npx expo start --tunnel  # for a physical device on another network
```

Optional backend, in a second terminal:

```bash
npm run api              # http://localhost:3001
curl localhost:3001/health
```

`/health` reports which optional capabilities are active. Set
`EXPO_PUBLIC_API_URL=http://localhost:3001` in `.env` so the app can reach it,
then restart the Expo dev server (`EXPO_PUBLIC_*` values are baked in at bundle
time).

## 3. iPhone & iPad Build (TestFlight)

One-time setup:

```bash
npm install -g eas-cli
eas login
eas init            # writes extra.eas.projectId into app.json
eas build:configure
```

Then fill in `appleId`, `ascAppId` and `appleTeamId` in the `submit` section of
`eas.json`, and build:

```bash
eas build --platform ios --profile development   # simulator/dev client
eas build --platform ios --profile production    # TestFlight
eas submit --platform ios --profile production
```

iPad support is already configured in `app.json`: `supportsTablet: true`,
`orientation: "default"`, and `requireFullScreen: false` for Split View.

## 4. Mac Desktop Build (Electron)

```bash
cd electron && npm install && cd ..
```

Development — two terminals:

```bash
npx expo start --web       # serves on :8081
cd electron && npm start   # NODE_ENV=development, loads localhost:8081
```

Build a `.dmg`:

```bash
cd electron && npm run build
```

That exports the web bundle to `web-build/` and runs electron-builder; the
installer lands in `release/`. (The web export and the installer deliberately
use different directories — `dist/` is Expo's default export target.)

Keyboard shortcuts: `Cmd+N` new task, `Cmd+Return` complete, `Cmd+D` briefing,
`Cmd+Q` quit. The app minimises to the menu bar on close.

## 5. Web Build

```bash
npm run build:web        # static site in web-build/
npx serve web-build      # or any static host
```

## 6. App Icons

Icons live in `assets/` and are already sized:

| File | Size | Used for |
|---|---|---|
| `icon.png` | 1024×1024 | App Store / iOS |
| `adaptive-icon.png` | 1024×1024 | Android adaptive icon |
| `splash-icon.png` | 1024×1024 | Splash screen |
| `favicon.png` | 48×48 | Web |

Replace them in place to rebrand; no config changes needed.

## 7. Supabase (Optional Cloud Sync)

1. Create a project at supabase.com.
2. Run `supabase/schema.sql` in the SQL Editor — it creates the `tasks` table,
   indexes, Row Level Security policies and the `updated_at` trigger.
3. Put the project URL and anon key in `.env`:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
# and, for the API server:
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

RLS scopes every row to `auth.uid()`, so requests must be authenticated as a
Supabase user. Task content is encrypted on-device first — Supabase only ever
stores ciphertext.

## 8. AI Features (Optional)

The Anthropic API key must never ship in the app bundle; anyone who installs
the app can read it. Instead the app calls the DayFlow API server, which holds
the key:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...          # server only
EXPO_PUBLIC_API_URL=http://localhost:3001
```

```bash
npm run api
```

Endpoints: `POST /ai/summary`, `POST /ai/prioritize`, `POST /ai/steps`. With
`ANTHROPIC_API_KEY` unset they return 503 and the app silently falls back to
its offline behaviour. For anything beyond local use, deploy the API server
somewhere private and point `EXPO_PUBLIC_API_URL` at it.

## 9. Backup

```bash
# Source
git push -u origin <your-branch>

# Supabase
npx supabase db dump --project-ref YOUR_PROJECT_REF > backup.sql
```

Local task data is encrypted under your master password and lives only on the
device. There is no recovery path if the password is lost.

## 10. Security Checklist

- [ ] Master password set (encrypts all task data)
- [ ] `.env` not committed — it is in `.gitignore`
- [ ] No secret behind an `EXPO_PUBLIC_*` name (those are public)
- [ ] `ANTHROPIC_API_KEY` only ever on the server
- [ ] Supabase RLS policies enabled
- [ ] Apple certificates managed via EAS
