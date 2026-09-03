# DayFlow for Mac

A Mac application wrapper: a Dock icon, its own window, its own menu.

It loads the hosted app rather than carrying a copy, so the desktop app is
never a version behind the phone, and its service worker means it still opens
without a connection once it has run at least once.

Sync is the app's own and works exactly as it does in a browser — same account,
same Supabase project, same end-to-end encryption. The Mac app keeps its own
storage, so the first launch asks for the project URL and key once, and then
you sign in.

## Building the .dmg

Needs a Mac. A `.dmg` is an Apple disk image, and only Apple's own tools
(`hdiutil`, `sips`, `codesign`) can produce one — none of which exist on Linux
or in CI without macOS.

```bash
cd desktop
npm install
npm run dmg
```

The result is in `desktop/dist/`, one for Apple Silicon and one for Intel.
`npm run dmg:universal` builds a single image that runs on both, at roughly
twice the size.

To run it without packaging, `npm start`.

## Opening it the first time

With no Apple Developer certificate, electron-builder signs the app ad-hoc.
That is enough for it to launch — an unsigned app will not run on Apple Silicon
at all — but macOS still does not recognise the signer, so the first open needs
one of:

- **Right-click the app → Open**, then Open again in the dialog. Once only.
- Or, if macOS calls it damaged (which is what a quarantine flag looks like):

  ```bash
  xattr -dr com.apple.quarantine /Applications/DayFlow.app
  ```

With a Developer ID certificate in your keychain, electron-builder finds and
uses it automatically, and neither step is needed. Notarising it — so it opens
with no warning at all on any Mac — is a separate step with `notarytool` and an
app-specific password.

## Pointing it somewhere else

`DAYFLOW_URL` overrides the address, which is what to use when testing against
a local build:

```bash
DAYFLOW_URL=http://localhost:8081 npm start
```

## Do you actually need this?

Probably not, if all you want is a Dock icon. Safari on macOS Sonoma and later
has **File → Add to Dock**, which gives the same thing — own window, no browser
chrome, Dock icon, notifications — with nothing to build and nothing to sign.

This wrapper is worth it when you want a real `.app` you can hand to someone, or
a Mac build to sit alongside the iOS one.
