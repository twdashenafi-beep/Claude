# Shipping DayFlow to the App Store

For iPhone, iPad, and Mac. Written to be followed in order.

---

## Before anything else: what a native build changed

DayFlow was written, run and tested entirely as a web app. Browsers and Node
both provide the Web Crypto API. **Hermes — the JavaScript engine an iOS or
Android build runs on — provides no `crypto` global at all.**

That difference had teeth. `crypto-js` reads `globalThis.crypto` once when it
loads and keeps whatever it found; finding nothing, its random-bytes function
throws. AES needs random bytes for its salt, so every call to `encrypt` threw —
and `encrypt` caught the error and returned the plaintext.

The result would not have been a crash. It would have been an iPhone build that
looked completely normal while syncing every task, and the vault key itself, to
the server **in the clear**.

That is fixed:

| Fix | File |
| --- | --- |
| A real randomness source installed before anything can ask for one | `src/services/secureRandom.js`, imported first in `index.js` |
| `encrypt` throws instead of returning the plaintext it was asked to hide | `src/services/encryption.js` |
| Key generation stops rather than falling back to a weak source | `src/services/crypto.js` |
| The app refuses to start if it has no randomness, rather than storing what it cannot protect | `App.js` |
| The dictation button is hidden where dictation does not exist (both mobile keyboards have their own) | `src/components/AIInput.js` |

`tests/native-readiness.test.mjs` covers all of it, including a sandbox that
reproduces the Hermes environment exactly.

**Still unverified:** that `expo-crypto`'s native module loads on a real device.
It is a first-party Expo module so the risk is low, but no test here can prove
it — only a build on hardware can. **The first TestFlight build must be checked
for this**: create an account, add a task, then look at the `tasks` table in
Supabase. The `ciphertext` column must be unreadable. If you can read a task
title in it, stop and say so.

---

## 1. Accounts you need

| What | Cost | Who |
| --- | --- | --- |
| Apple Developer Program | £79 / $99 per year | You — [developer.apple.com/programs](https://developer.apple.com/programs/) |
| Expo account | Free | You — [expo.dev](https://expo.dev) |

Enrolment as an individual is usually approved within 24–48 hours. As a company
it needs a D-U-N-S number and takes longer.

No Mac is required. EAS builds on Apple hardware in the cloud.

---

## 2. First build

```bash
cd dayflow
npm install -g eas-cli
eas login
eas init                 # creates the project, writes extra.eas.projectId into app.json
eas build --platform ios --profile production
```

The first build asks to create signing certificates and provisioning profiles.
Let it manage them — say yes to everything it offers to generate.

Roughly 15–25 minutes. The result is an `.ipa`.

To try it on a simulator first, without any Apple account at all:

```bash
eas build --platform ios --profile simulator
```

---

## 3. TestFlight, before the store

```bash
eas submit --platform ios --latest
```

Then in App Store Connect → TestFlight, add yourself as an internal tester and
install it on your iPhone and iPad.

**What to check on the device, in this order:**

1. **Encryption is real.** Create an account, add a task, then open the
   `tasks` table in Supabase. `ciphertext` must be unreadable. This is the one
   that would be catastrophic to miss.
2. **Unlocking is slow but not broken.** Key derivation is 210,000 PBKDF2
   rounds. Browsers do this in native code in about a fifth of a second; on
   Hermes it is pure JavaScript and takes several seconds, during which the UI
   is frozen. The iteration count cannot be lowered — it must match the web
   build exactly or an account made on the Mac will not open on the iPhone.
   Time it. If it is unbearable, the fix is a native PBKDF2, not fewer rounds.
3. **Sync across devices.** Same account on the phone and in the browser; a task
   added in one appears in the other.
4. **Reminders.** Set a task for two minutes ahead, lock the phone, wait.
   The notification should arrive with a sound.
5. **Voice notes** record and play back.
6. **iPad layout** in both orientations, and in Split View.

---

## 4. App Store Connect

Create the app record at [appstoreconnect.apple.com](https://appstoreconnect.apple.com):

- **Bundle ID** `com.tewodros.dayflow` — matches `app.json`
- **Privacy policy URL** `https://twdashenafi-beep.github.io/Claude/privacy.html`
- **Support URL** `https://twdashenafi-beep.github.io/Claude/support.html`

### Screenshots

App Store Connect lists the exact sizes it wants when you get there — at the
time of writing it is one large iPhone and one large iPad, and it upscales the
rest. Take them from TestFlight on the real devices, or from the simulator
build; screenshots from the actual hardware are always the right size.

Six are plenty: the two columns side by side, the add sheet, a project, the
archive, search results, and a reminder arriving.

### Privacy nutrition label

DayFlow's honest answers:

- **Data collected:** none linked to the user by DayFlow itself.
- The email address is used only to derive the encryption key and to sign in to
  *your own* Supabase project. Task content is end-to-end encrypted before it
  leaves the device.
- No tracking, no analytics, no third-party SDKs that collect anything.

### Export compliance — a decision only you can make

Apple asks whether the app uses encryption. It does: AES-256, to protect your
own data.

Apps in this position normally qualify for the exemption at EAR 740.17(b)(1)
and answer that they use no *non-exempt* encryption. **This is a legal
declaration, so it is yours to make, not mine.** I have deliberately left it out
of `app.json` so that Apple asks you directly at submission.

If you decide it applies and want to stop being asked on every build, add this
to `app.json` under `"ios"`:

```json
"config": { "usesNonExemptEncryption": false }
```

---

## 5. iPad

Already done. `app.json` sets `"supportsTablet": true`, and the layout is a
centred sheet with a maximum width, so it reads as a page on a large screen
rather than a stretched phone app. Check Split View on the device.

---

## 6. Mac — three routes, and what each costs

**a. Designed for iPad — free, and already working.**
Any Apple Silicon Mac can run an iPad app from the App Store. It is opt-*out*,
so you get it by doing nothing. It runs in a fixed window and behaves like an
iPad app. For a task list this is genuinely fine, and it syncs with everything
else because it is the same app.

**b. The Electron wrapper in `desktop/` — a real Mac app, outside the store.**
Already built this session. It is a proper resizable Mac window with a Dock
icon. To hand it to anyone else without a Gatekeeper warning it needs a
Developer ID certificate and notarisation — which the same $99 membership
covers. Signing is currently unconfigured on purpose, because an unsigned build
will not open on Apple Silicon at all.

**c. Mac Catalyst or a native Mac app — not worth it.**
Expo does not support Catalyst, and a React Native macOS target is a separate
build system, a separate set of components, and weeks of work for a window you
already have two ways of getting.

**Recommendation: (a) now, (b) when you want a real desktop app.** Do not do (c).

---

## Known limitation: voice notes do not travel

A voice note is stored as a file path on the device that recorded it
(`src/components/VoiceRecorder.js` keeps `recorder.uri`). That path means
nothing on any other device, so a note recorded on the iPhone shows a play
button on the Mac that cannot play anything. On the web build the URI is a
`blob:` URL, which does not even survive a page reload.

Everything else about a task syncs correctly — this is specific to the audio.

Fixing it means putting the audio itself inside the encrypted blob rather than a
pointer to it: read the file, base64 it, and let it ride along with the task the
way notes do. That is a real piece of work with a size question attached (a
minute of audio is roughly 1 MB, and a row that large is worth thinking about),
so it is called out here rather than done quietly. It is not a blocker for
submission — the feature works on the device that recorded it.

---

## 7. Version numbers

`eas.json` sets `"appVersionSource": "remote"` and `autoIncrement` on the
production profile, so the build number rises on its own. The user-facing
version is `expo.version` in `app.json` — raise that by hand when a release is
worth naming.

---

## What is not done, and is not mine to do

- Apple Developer Program enrolment
- The export-compliance declaration in section 4
- A legal read of `pages/terms.html` and `pages/privacy.html`
- A real VoiceOver pass on a device
- **Supabase: turn "Allow new users to sign up" back OFF.** The publishable key
  is public by design, so while that setting is on, anyone who has it can create
  an account against your project.
