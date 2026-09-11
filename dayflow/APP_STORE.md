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

## 1. Accounts

The Apple Developer Program is **done**. The only other account is an Expo one,
which is free: [expo.dev](https://expo.dev). Sign up before the first command
below, or `eas login` will offer to make one.

No Mac is required for any of this. EAS builds on Apple hardware in the cloud.

Two things in `app.json` are still blank because only you can fill them:

- `extra.eas.projectId` — written automatically by `eas init` in step 2.
  **Commit that change**; without it every machine builds a different project.
- `ios.config.usesNonExemptEncryption` — a legal declaration, deliberately left
  out. See section 4.

---

## 2. First build

Nothing below carries a trailing comment, on purpose. macOS runs zsh, and zsh
does not treat `#` as the start of a comment when you type it at the prompt —
paste a line with one and everything after the hash arrives as arguments:

    Unexpected arguments: #, writes, extra.eas.projectId

Start from a clone rather than an unpacked archive, so that what `eas init`
writes can be committed back:

```bash
git clone https://github.com/twdashenafi-beep/Claude.git dayflow-app
```

```bash
cd dayflow-app/dayflow
```

One line at a time from here.

```bash
npm ci
```

**This one is not optional and not obvious.** A fresh clone has no
`node_modules`, and every `eas` command reads `app.json`, which names plugins —
`expo-calendar`, `expo-notifications`, `expo-audio` — that it then has to
resolve on disk. Without them, every command fails the same way and the message
does not mention which step was missed:

    Failed to resolve plugin for module "expo-calendar" relative to ...
    Do you have node modules installed?

```bash
npm install -g eas-cli
```

```bash
eas login
```

```bash
eas init
```

`eas init` creates the project on Expo and writes `extra.eas.projectId` into
`app.json`. **Commit that change** — without it, every machine builds a
different project.

```bash
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

## 2a. The audit warning after npm ci

`npm ci` reports ten moderate advisories. They come from two roots, and neither
reaches the app anyone runs:

**`@anthropic-ai/sdk`** — used only by `api-server.js`, the optional server for
the AI features. It is never bundled: the built web bundle contains no
reference to it, and nothing under `src/` imports it.

**`uuid@7`**, which accounts for the other eight — `expo` → `@expo/config-plugins`
→ `xcode` → `uuid`. That is build tooling, run on the machine doing the
building, not code shipped to a device.

**Do not run `npm audit fix --force`.** It would try to move `expo` off SDK 55
to satisfy a transitive dependency of a build tool. That is how the expo-audio
mismatch happened earlier in this project: a version that looked fine on the web
and would have failed on the first native build. The advisories are worth
re-checking when Expo next publishes an SDK, and not before.

To see the reasoning yourself rather than taking it on trust:

```bash
npm ls uuid
```

```bash
grep -rn "@anthropic-ai/sdk" src/ App.js
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

### Export compliance — declared

Apple asks whether the app uses encryption. It does: AES-256, to protect your
own data on your own devices.

`app.json` now carries the declaration, at your instruction:

```json
"ios": { "config": { "usesNonExemptEncryption": false } }
```

Apple will stop asking on every build. Recorded here because `app.json` cannot
hold a comment and this is a legal statement rather than a setting.

**What it asserts, in plain terms.** That DayFlow uses no encryption which is
*not* exempt from US export regulations. The reasoning is that its only use of
cryptography is standard, published algorithms — AES-256 and PBKDF2-HMAC-SHA256
— protecting the user's own data, which is the case described by the exemption
at EAR 740.17(b)(1). The app implements no cryptography of its own, offers no
cryptographic service to anything else, and is not sold to a government.

**When it would stop being true.** If DayFlow ever gained a bespoke cipher, or
became a tool whose purpose was encrypting other people's data rather than its
own, this line would need revisiting. Adding an ordinary feature will not
change it.

Neither this note nor the declaration is legal advice. If the app's purpose
changes, or if it is ever distributed somewhere with different rules, the
declaration is worth putting in front of somebody qualified.

---

## 4a. The listing, drafted

Edit freely — this is a starting point, not a submission. Apple's limits are in
brackets and every line below is inside them.

**Subtitle** [30]

    Two lists, side by side

**Promotional text** [170] — changeable any time, without a new build

    What you owe and what you are owed, on one page. Nothing leaves your
    device unencrypted, and nobody but you can read it.

**Keywords** [100] — commas, no spaces, no words already in the name

    todo,owe,chase,follow up,reminders,encrypted,private,projects,planner,day,week,month,tasks

**Description** [4000]

    DayFlow is a task list with one idea behind it: the things you have to do
    and the things other people owe you are different kinds of work, and they
    belong side by side rather than jumbled together.

    TWO COLUMNS
    To Do is yours. Owe Me is what you are waiting on — the deposit, the
    signed contract, the reply — with the person's name against it, so
    chasing is a glance rather than a hunt through your inbox.

    DAY, WEEK, MONTH
    Three pages, not three apps. Move a task between them in a tap.

    WRITE IT THE WAY YOU SAY IT
    "Call Mekdi tomorrow at 11" arrives dated, timed and filed. "Owe me the
    signed lease" goes to the right column. Dictate it if your hands are full.

    PROJECTS
    A project is the same page holding a different slice — its own two
    columns, its own three scopes. Drag the tabs into whatever order suits.

    NOTHING IS LOST
    Finish a task and delete it and it goes to the Archive, with its notes, for
    as long as you want it. Delete something unfinished and there is a moment
    to undo.

    IT KNOWS WHAT IS LATE
    Overdue says overdue. A task nobody dated stays quiet — a list that cries
    wolf is worse than one that says nothing.

    PRIVATE BY CONSTRUCTION
    Your tasks are encrypted on the device with a key your master password
    unlocks, before anything is sent anywhere. The server stores an unreadable
    blob and a timestamp. It cannot read your tasks, and neither can we,
    because there is nothing to read and no key to read it with.

    YOUR DEVICES, YOUR SERVER
    DayFlow syncs through a Supabase project you own. No account with us, no
    subscription, no advertising, nothing collected.

**What's New** — for the first release

    First release.

---

## 4b. Privacy — the answers, and why

Apple asks what you collect. The honest answers are short:

| Question | Answer |
| --- | --- |
| Data collected | **None** |
| Tracking | **No** |
| Third-party analytics | **None** |

The email address is used to derive the encryption key and to sign in to *your
own* Supabase project. It is not collected by the app's publisher, because
there is no publisher-side server. Task content is encrypted before it leaves
the device.

If the form insists on an entry for the email address, the accurate shape is
"Contact Info → Email Address", used for "App Functionality", **not** linked to
the user and **not** used for tracking.

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

## Known limitation: tombstones are never pruned

Every deletion leaves a permanent record — `{id, updatedAt}`, about 54 bytes —
so that a device which was offline at the time learns the task is gone rather
than resurrecting it on its next sync. Nothing ever removes them.

At the scale of one person this is slow-moving: 10,000 deletions is about
540 KB, against a browser storage quota of roughly 5 MB that the tasks
themselves fill first (a task costs around 600–750 bytes encrypted, so the
ceiling is somewhere near 7,000). It is written down rather than fixed because
the fix has a real cost: dropping tombstones older than, say, 90 days means a
device left unused for longer than that resurrects everything deleted while it
slept.

The app now says so when the ceiling is actually reached, rather than silently
failing to save, which was the more urgent half of the problem.

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
