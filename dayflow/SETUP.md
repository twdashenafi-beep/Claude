# DayFlow — Setup Guide

- [Quick start](#1-quick-start)
- [Use it on iPhone & iPad](#2-use-it-on-iphone--ipad)
- [Web app & GitHub Pages](#3-web-app--github-pages)
- [TestFlight / native build](#4-testflight--native-build)
- [Mac desktop](#5-mac-desktop-electron)
- [Optional services](#6-optional-services)
- [Security checklist](#7-security-checklist)

## Prerequisites

- Node.js 20+ (`brew install node`) — the API server uses `--env-file-if-exists`
- Xcode 15+ only if you want to build locally; EAS builds in the cloud instead
- Apple Developer Program ($99/yr) only for the TestFlight path

## 1. Quick start

```bash
cd dayflow
npm install
npx expo start          # press w for web, i for iOS simulator
```

DayFlow needs no configuration to run: tasks live in encrypted local storage,
with no account and no network. `.env` only turns on the optional AI and
cloud-sync features.

## 2. Use it on iPhone & iPad

Two routes, and they are not exclusive.

### a. Expo Go — instant, for trying it out

Install **Expo Go** from the App Store, then:

```bash
npx expo start          # scan the QR code with the iPhone/iPad camera
```

Both devices must be on the same Wi-Fi; add `--tunnel` if they are not. This is
the fastest way to see the real app, but it runs inside Expo Go rather than
installing as its own app, and it only works while your machine is serving.

### b. Home-screen web app — permanent, free

Once the site is deployed (section 3), open it in **Safari** on the device:

1. Go to `https://twdashenafi-beep.github.io/Claude/`
2. Tap the **Share** button → **Add to Home Screen** → **Add**

It then launches full-screen from its own icon, with no Safari chrome, and
works offline — a service worker caches the app shell, and your tasks are in
the device's own storage. It updates itself whenever you reopen it online.

Use Safari for the install step. Chrome and Firefox on iOS can open the site
but cannot add a standalone home-screen app.

**What the web app cannot do**, because iOS reserves these for native apps:

| Feature | Home-screen web app | TestFlight build |
|---|---|---|
| Tasks, encryption, offline | ✅ | ✅ |
| Natural-language input | ✅ | ✅ |
| Voice dictation | Safari only, partial | ✅ |
| Due-time reminders | ❌ | ✅ |
| Device calendar sync | ❌ | ✅ |

Each device keeps its own separate data — the encryption key never leaves the
device, so there is no sync between them unless you configure Supabase.

## 3. Web app & GitHub Pages

Build locally:

```bash
npm run build:web       # -> web-build/, served from the domain root
npm run preview:web     # local preview
```

Deploying to GitHub Pages is automated by `.github/workflows/pages.yml`, which
publishes DayFlow at the site root and moves the older World Monitor dashboard
to `/world-monitor/`.

**One-time setup:** in the repo, **Settings → Pages → Source: GitHub Actions**.
Push to a branch the workflow watches (or run it from the Actions tab) and it
deploys. If a run fails on deployment protection, allow the branch under
**Settings → Environments → github-pages → Deployment branches**.

The site is public, since the repository is. Your tasks are not — they are
encrypted in your own browser's storage and never sent anywhere.

### Serving from a different path

`npm run build:pages` bakes in the `/Claude` base path that GitHub Pages serves
this repo from. For any other host, set your own:

```bash
EXPO_BASE_URL=/my/path npx expo export --platform web --output-dir web-build
node scripts/make-pwa.js web-build /my/path
```

At a domain root, plain `npm run build:web` is right.

## 4. TestFlight / native build

This is the full app: reminders, calendar sync, voice notes. It needs an
**Apple Developer Program** membership ($99/yr). EAS builds in the cloud, so a
Mac is not required.

```bash
npm install -g eas-cli
eas login
eas init                  # writes extra.eas.projectId into app.json
```

Then fill in the `submit.production.ios` block of `eas.json` with your
`appleId`, `ascAppId` (from App Store Connect) and `appleTeamId`.

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

EAS handles certificates and provisioning for you. Once processed, install
**TestFlight** on the iPhone and iPad and the build appears there; each build
is testable for 90 days. iPad support is already configured in `app.json`
(`supportsTablet: true`, `requireFullScreen: false` for Split View).

To try a build on your own devices without TestFlight:

```bash
eas build --platform ios --profile preview   # internal distribution
```

Register each device's UDID first with `eas device:create`.

## 5. Mac desktop (Electron)

```bash
cd electron && npm install && cd ..
```

Development, in two terminals:

```bash
npx expo start --web       # serves on :8081
cd electron && npm start   # loads localhost:8081
```

Build a `.dmg`:

```bash
cd electron && npm run build     # installer lands in release/
```

Shortcuts: `Cmd+N` new task, `Cmd+Return` complete, `Cmd+D` briefing, `Cmd+Q`
quit. The app minimises to the menu bar on close.

## 6. Optional services

Copy `.env.example` to `.env` and set only what you want. `EXPO_PUBLIC_*`
values are inlined into the app bundle and are therefore **public** — never put
a secret behind that prefix.

### AI features

The Anthropic key must never ship in the app bundle; anyone who installs the
app can read it. The app calls the DayFlow API server, which holds the key:

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...            # server only
EXPO_PUBLIC_API_URL=http://localhost:3001
```

```bash
npm run api                             # then: curl localhost:3001/health
```

Endpoints: `POST /ai/summary`, `/ai/prioritize`, `/ai/steps`. Unset the key and
they return 503 while the app falls back to its offline behaviour. Restart the
Expo dev server after changing `EXPO_PUBLIC_*` — those are baked in at bundle
time. Beyond local use, deploy the API server somewhere private and point
`EXPO_PUBLIC_API_URL` at it; the deployed web app cannot reach your localhost.

### Encrypted sync across your devices

Sync is end-to-end encrypted. The server stores one row per task holding a
ciphertext blob, a timestamp and a deleted flag — no title, no priority, no due
date, no names. Neither Supabase nor anyone with a database dump can read it.

**How the keys work.** One password, derived twice, with your email as the salt:

```
masterKey     = PBKDF2-SHA256(password, email, 210,000 iterations)
authHash      = PBKDF2(masterKey, password, 1)   -> sent to Supabase as the password
encryptionKey = PBKDF2(masterKey, "dayflow-encryption-v1", 1)   -> never leaves the device
```

Supabase only ever sees `authHash`, which is a one-way function of the master
key, so it cannot derive the key that decrypts your tasks. And because the salt
is your email rather than a per-device random value, every device that signs in
with the same email and password arrives at the same key — which is exactly
what makes the tasks readable on all three.

**Set it up once:**

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New Query**, paste `supabase/schema.sql`, and run it.
3. Copy **Project URL** and the **anon public** key from **Settings → API**.
4. Put them in `.env`:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

5. For the deployed web app, add the same two as **repository secrets**
   (Settings → Secrets and variables → Actions) and the deploy workflow passes
   them into the build.

**Then, on each device:** open the app, create the account once, and sign in on
the other two with the same email and password. Tasks sync within a minute, and
on every launch.

**Two settings worth changing in Supabase**, since the anon key ships in a
public web bundle:

- **Authentication → Providers → Email**: turn off **Enable sign-ups** once your
  own account exists, so nobody else can register against your project.
- Leave **Confirm email** on. The first sign-up then needs a link clicked before
  it can be used.

**Your recovery code.** Sign-up shows a 32-character code once. Tasks are
encrypted with a random data key that nobody types; that key is then stored
twice over, sealed once by your password and once by this code. Either opens the
vault, and neither reveals the other.

Two things follow. Changing your password re-seals one small key rather than
re-encrypting anything, so a vault of ten thousand tasks changes password as
fast as an empty one — and, more importantly, stays readable afterwards. And a
forgotten password stops being fatal.

Keep the code somewhere real: a password manager, or paper. It is shown once,
because the vault stores only a value derived from it. Lose both the password
and the code and the data is genuinely gone — there is nothing on any server
capable of recovering it, which is the point of end-to-end encryption.

**Conflicts.** If you edit the same task on two devices before they sync, the
later edit wins. Deletes are kept as tombstones so a device that was offline
during a delete does not bring the task back.

## 7. App Store submission

Not yet done, in the order they block you.

**In-app account deletion — done.** Guideline 5.1.1(v) rejects any app offering
account creation without in-app deletion. It lives in **Account → Delete
account**, behind a typed confirmation, and calls a `security definer` function
rather than shipping a service-role key.

**Encryption export declaration — your call to make.** App Store Connect asks
about encryption on every submission until `app.json` answers it:

```json
"ios": {
  "infoPlist": {
    "ITSAppUsesNonExemptEncryption": false
  }
}
```

`false` asserts the app uses no *non-exempt* encryption. Apps using only
standard algorithms to protect the user's own data commonly qualify for the
exemption, and DayFlow uses AES and PBKDF2 for exactly that. But this is a legal
attestation about US export rules, not a technical setting, so it is left unset
deliberately — read Apple's export-compliance questions and answer them
yourself rather than inheriting an answer from this file.

**Privacy policy and support URLs** — both required App Store metadata, and
neither exists yet. They must be reachable public pages; the Pages site can host
them.

**Privacy nutrition labels** — declared in App Store Connect. DayFlow collects
an email address for authentication, and nothing else: task content is
ciphertext the server cannot read.

**VoiceOver labels** — only the voice-note controls have them. Apple checks
accessibility, and it is the right thing regardless.

## 8. Security checklist

- [ ] Master password set (encrypts all task data; unrecoverable if lost)
- [ ] Supabase sign-ups disabled once your account exists
- [ ] `.env` not committed — it is in `.gitignore`
- [ ] No secret behind an `EXPO_PUBLIC_*` name (those are public)
- [ ] `ANTHROPIC_API_KEY` only ever on the server
- [ ] Supabase RLS policies enabled
- [ ] Apple certificates managed via EAS

## App icons

| File | Size | Used for |
|---|---|---|
| `assets/icon.png` | 1024×1024 | App Store / iOS |
| `assets/adaptive-icon.png` | 1024×1024 | Android |
| `assets/splash-icon.png` | 1024×1024 | Splash screen |
| `assets/favicon.png` | 48×48 | Web favicon |
| `web/icon-180.png` | 180×180 | iOS home-screen icon |
| `web/icon-192,512.png` | 192, 512 | Web app manifest |

Replace `assets/icon.png` to rebrand, then regenerate the web icons:

```bash
node -e "const J=require('jimp-compact');(async()=>{const s=await J.read('assets/icon.png');
for(const n of [180,192,512]) await s.clone().resize(n,n).writeAsync('web/icon-'+n+'.png');})()"
```
