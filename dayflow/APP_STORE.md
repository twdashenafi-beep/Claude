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

There are now two Apple accounts in this story: the first enrolment, which
stalled on a payment the bank never received a request for, and a second
developer account created after it. Before touching any command below, settle
which one is real — it is the difference between a ten-minute setup and a lost
afternoon.

**An Apple ID with a developer account attached is not the same as completed,
paid enrolment.** EAS reports the gap in a way that sounds like something else
entirely:

    You have no team associated with your Apple account

That is not a permissions problem and no amount of signing in again fixes it.
It means enrolment has not finished being paid for and approved. Check at
[developer.apple.com/account](https://developer.apple.com/account): under
**Membership details** you want a **Team ID** and an expiry roughly a year out.
No Team ID, no signing, and every build below fails at the same place.

### Pointing EAS at the new account

EAS caches the Apple ID it last signed in with and does not offer to change it.
The first attempt here used a mistyped address, and that typo survived every
retry until the cache was deleted:

```bash
rm -rf ~/.app-store
```

The next `eas build` then asks for an Apple ID again. Give it the new one.

Two consequences of the account being new, both easy to trip over:

- **The App Store Connect app record belongs to a team.** Nothing created under
  the abandoned enrolment carries over. Section 4 is written as a first-time
  setup, which is now exactly what it is.
- **The bundle identifier is unchanged.** `com.tewodros.dayflow` was never
  registered against the old team, so there is nothing to release or transfer.
  Switching account changes signing, and only signing.

The only other account needed is an Expo one, which is free:
[expo.dev](https://expo.dev). Sign up before the first command below, or
`eas login` will offer to make one.

No Mac is required for any of this. EAS builds on Apple hardware in the cloud.

### What `app.json` already carries

Both blanks this file used to list are filled and committed:

- `extra.eas.projectId` — `b5d74812-ef07-41f7-8fd6-ea31f0c8673d`. `eas init` in
  step 2 will now find that project instead of creating one. If you happen to be
  signed in as a different Expo account, it will offer to make a second project
  — decline, and sign in as the owner instead.
- `ios.config.usesNonExemptEncryption` — `false`. A legal declaration rather
  than a setting; the reasoning is in section 4.

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

`extra.eas.projectId` is already committed, so `eas init` should link to the
existing project rather than write a new id. If it offers to create one, you
are signed in as the wrong Expo account — decline and sign in as the owner.

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

The answers are in section 4b, along with why an earlier draft of them was
wrong. In short: declare the email address and the task content, both **linked**
to the user, both for **App Functionality**, and **no** to tracking.

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

    todo,owe,chase,follow up,voice note,reminders,encrypted,private,projects,planner,day,week,tasks

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

    SAY IT INSTEAD OF TYPING IT
    Hold the button and talk. A voice note lives on the task, encrypted with
    everything else, so it survives a reload and reaches your other devices —
    up to five per task, for the things that are quicker said than written.

    CHASING, WRITTEN FOR YOU
    One tap on anything in Owe Me writes the message asking for it back, and
    covers everything that person owes you rather than one item at a time.
    Each row says how long it has been waiting, and turns red past a fortnight.

    PRIVATE BY CONSTRUCTION
    Your tasks are encrypted on the device with a key your master password
    unlocks, before anything is sent anywhere. The server stores an unreadable
    blob and a timestamp. It cannot read your tasks, and neither can we,
    because there is nothing to read and no key to read it with.

    A COPY YOU KEEP
    The honest cost of that is that nobody can recover your password for you.
    So the app will write your whole list — finished and archived items
    included — to a single plain file whenever you ask, to keep wherever you
    keep a password.

    YOUR DEVICES, YOUR SERVER
    DayFlow syncs through a Supabase project you own. No account with us, no
    subscription, no advertising, nothing collected.

**What's New** — for the first release

    First release.

---

## 4b. Privacy — the answers, and why

This section used to say **Data collected: None**, and to suggest that if the
form insisted on the email address it was "not linked to the user". Both were
wrong, and wrong in the direction that gets an app rejected or pulled later.
Apple defines "linked to you" as data associated with a user's identity through
their account — an address you sign in with is the definition of that, not an
exception to it. And a reviewer who sees a sign-up screen, a server and a label
saying nothing is collected does not go looking for the subtlety.

Fill it in like this:

| Question | Answer |
| --- | --- |
| Contact Info → Email Address | Collected · **Linked to you** · App Functionality |
| User Content → Other User Content | Collected · **Linked to you** · App Functionality |
| Used for tracking | **No** |
| Third-party analytics | **None** |
| Data used to advertise | **None** |

**Why over-declaring is the right way to be wrong.** Whether encrypted task
content counts as "collected" is genuinely arguable: it is stored as ciphertext
in a Supabase project *you* own, and the app's publisher has no server and no
key. But the rows do leave the device and sit somewhere, and Apple's test is
about what leaves, not about who can read it. Declaring more than is strictly
required has never cost anybody a release. Declaring less is how apps get taken
down months after approval.

**What to say if a reviewer asks**, in one breath: the email signs you in and
derives your key; the task content is encrypted on the device with AES-256
before any of it is sent, so the only thing stored is ciphertext and a
timestamp; there is no analytics SDK, no advertising identifier, and nothing is
shared with anyone. The privacy policy at the URL above says the same in the
same order, which is the part that makes it check out.

**One thing in DayFlow's favour, worth knowing you have.** Guideline 5.1.1(i)
objects to apps that demand an account for things that do not need one. DayFlow
runs entirely without an account, offline, against local encrypted storage; the
account exists only to sync between devices. Say so if it comes up. And 5.1.1(v)
— account deletion from inside the app — is already there under
**Account → Delete account**.

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

## Known limitation: voice notes may not travel from a native build

This used to say that voice notes do not travel at all, because what was stored
was the path the recorder handed back — meaningless on any other device, and on
the web a `blob:` URL that did not survive a reload.

That is fixed on the web. `src/services/audio.js` turns the recording into a
`data:` URI before it is attached, so the audio itself goes inside the encrypted
blob and reaches every device by the path every other field already takes. Notes
over about 700 KB are refused rather than quietly filling a vault measured in a
few megabytes.

**What no test here can prove** is that the same conversion works on a device.
It reads the recording with `fetch` and `FileReader`, both of which a browser
provides and neither of which React Native guarantees for a `file://` URI. If
either is missing the original path is handed back untouched — deliberately, so
a native build is no worse than it was — and a note recorded on the iPhone would
again be a play button the Mac cannot use.

**So add this to the TestFlight list in section 3**: record a note on the phone,
then open the same account in a browser and play it. If it plays, the conversion
works on the device. If it does not, the fix is to read the file through
`expo-file-system` (`readAsStringAsync` with base64 encoding) inside
`toDurableUri` — the shape of the rest, including the size limit, stays as it
is.

---

## 7. Version numbers

`eas.json` sets `"appVersionSource": "remote"` and `autoIncrement` on the
production profile, so the build number rises on its own, kept on EAS's side
rather than in the repository. The user-facing version is `expo.version` in
`app.json` — raise that by hand when a release is worth naming.

`ios.buildNumber` and `android.versionCode` used to sit in `app.json` as well,
and the first real build said what that was worth:

    ios.buildNumber field in app config is ignored when version source is set
    to remote

Ignored, but still shipped in the manifest, where anything reading it through
`expo-constants` would get a number that stopped being true after the first
build. They are gone. If you ever move the version source back to `local`, they
come back — that is the switch that makes them mean something again.

---

## What is not done, and is not mine to do

- **Completing Apple Developer Program enrolment**, to the point where
  [developer.apple.com/account](https://developer.apple.com/account) shows a
  Team ID. A created account is not an enrolled one. See section 1.
- A legal read of `pages/terms.html` and `pages/privacy.html`
- A real VoiceOver pass on a device

Two that were open and are now closed, recorded so they are not chased again:

- The export-compliance declaration — made, in `app.json`. Section 4 says what
  it asserts.
- Supabase's **"Allow new users to sign up"** — off. It matters because the
  publishable key is public by design: while that setting is on, anyone holding
  it can create an account against the project.
