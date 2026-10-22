# CLAUDE.md

Guidance for Claude working in this repository. Owner: Tewodros Ashenafi.

## What is here

| Path | What it is |
| --- | --- |
| `dayflow/` | **DayFlow**, the main product: an end-to-end encrypted task manager. React Native + Expo SDK 57, shipping to iPhone/iPad (TestFlight), web (GitHub Pages PWA) and Mac (via `desktop/`). |
| `desktop/` | Electron wrapper that loads the hosted web app. A `.dmg` can only be built on a Mac. |
| `pages/` | Static privacy, terms, support and about pages. Apple requires the privacy and support URLs to stay reachable. |
| `index.html` | **World Monitor**, a separate single-file dashboard for the Horn of Africa and strategic commodities. No build step. Published at `/world-monitor/`. |
| `LAUNCH.md` | The business and launch checklist: entity, payments, App Store. Things that can't be done from a session. |
| `.claude/skills/support/` | Skill for triaging DayFlow support messages and drafting replies. |
| `.github/workflows/` | `pages.yml` deploys the site, `ios.yml` builds and submits to TestFlight, `watchdog.yml` runs a weekly liveness check. |

## Commands (run from `dayflow/`)

```bash
npm ci                 # install
npm test               # unit tests (plain node .mjs scripts, no test runner)
npm run build:pages    # web build into web-build/, as deployed to Pages
npm run test:e2e       # Playwright e2e: needs build:pages first, plus playwright installed
npx expo start         # dev server (w = browser, i = iOS simulator)
```

- Unit tests are `tests/*.test.mjs`. Each one prints PASS/FAIL lines and exits non-zero on failure. Run a single file with `node tests/<name>.test.mjs`.
- Date-sensitive suites run under `TZ=Europe/London` (see the `test` script). Use the same timezone when running one by hand.
- **Add every new test file to the `test` or `test:e2e` script in `package.json`.** A file left out never runs, in CI or anywhere else.
- E2e tests serve `web-build/` themselves on a local port and drive Chromium. In this cloud container, use the pre-installed Chromium; don't run `playwright install`.
- `npm test` is the gate in `ios.yml` before every TestFlight build. `native-readiness.test.mjs` catches faults that compile fine but break on a phone (moved Expo APIs, missing iOS purpose strings). Never weaken it to get a build through.

## Architecture (DayFlow)

- `App.js` → `src/context/TaskContext.js` (state) → `src/screens/TodoScreen.js` and `src/components/*Sheet.js`.
- `src/services/` holds the logic, kept pure where possible so it can be tested in node: parsing (`nlParser`), ordering, repeats, due dates, the encrypted store and vault (`encryption`, `crypto`, `vault`, `localVault`, `keyParcel`), sync (`sync`, `merge`, `supabase`), backup and restore, and calendar (`ics`, `calendarFeed`, `calendarLink`).
- Sync is optional Supabase (`supabase/schema.sql`, RLS). The server only ever holds ciphertext. The key is derived from the user's password on the device.
- `modules/dayflow-kdf/` is a native Expo module (Swift/Kotlin) for key derivation.

## Rules that matter

- **Privacy is the product.** Never send task content anywhere, and never add analytics, a network model call or logging of plaintext. Everything that interprets tasks runs locally and works offline.
- **No password recovery exists, and none may be added.** No backdoor, server-side reset or key escrow. The recovery code and an exported copy are the only ways back in.
- Restore **never removes** data. Exports are deliberately unencrypted.
- `EXPO_PUBLIC_*` values are bundled into the app and are therefore public. Never commit `.env`, and never put a real secret in an `EXPO_PUBLIC_` variable.
- Keep `pages/privacy.html` and `pages/terms.html` true to what the app actually does. Update them in the same change as any feature that touches data.
- `index.html` (World Monitor) must stay a single self-contained file. Its market values are illustrative and labelled as such.

## Deploying

- Pages deploys **only** from the branch named in `pages.yml` (currently `claude/plw-vpvdd9`). Publishing means merging there. Adding a branch to `pages.yml` alone gives a permanently red run, because the `github-pages` environment must also allow that branch.
- TestFlight: Actions → "Build for TestFlight", or push an `ios-*` tag. Builds are slow and cost money, so never trigger one without being asked.
- The support skill drafts replies. **It never sends them.**

## Style

- Commit messages: a plain-English sentence saying what changed and why, in the imperative, with no `feat:` or `fix:` prefixes. Example: "Say which kind of "none coming up" it is".
- Comments explain *why*, often with the incident that made the code necessary. Match that: write few comments, but make each one count.
- User-facing text is plain, honest and specific. Say what is true, including when it is bad news. On screen, prefer showing the exact state (a quotable line) over a vague message.
- UK English.
