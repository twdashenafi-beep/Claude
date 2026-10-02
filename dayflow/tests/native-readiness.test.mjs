// What only goes wrong off the web.
//
// The app was written, run and tested in a browser. Browsers and Node both
// provide Web Crypto; Hermes, the engine an iOS or Android build runs on,
// provides no `crypto` global at all. Everything here is about that one
// difference, because the way it failed was the dangerous way: not a crash, but
// encryption quietly turning itself off.
//
// Run with `npm test`.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { generateDataKey, generateRecoveryCode, deriveAccountKeys } from '../src/services/crypto.js';
import { encrypt, decrypt } from '../src/services/encryption.js';

const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const threw = fn => { try { fn(); return false; } catch { return true; } };

// A fresh crypto-js, loaded against whatever `globalThis.crypto` currently is.
// It captures the global once, in its module body, so the only way to see what
// it does on a different platform is to load it again.
function loadCryptoJsFresh() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('crypto-js')) delete require.cache[key];
  }
  return require('crypto-js');
}

// Run something with the platform's randomness taken away, which is what Hermes
// looks like from inside the bundle.
function withoutCrypto(fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  delete globalThis.crypto;
  try { return fn(); } finally {
    if (saved) Object.defineProperty(globalThis, 'crypto', saved);
  }
}

// And with only what the polyfill installs — getRandomValues and nothing else.
// Notably no `subtle`, which is what the old code gated on.
//
// Puts the platform back only once the work is actually finished. A derivation
// is asynchronous and awaits partway through, so a plain try/finally hands
// `subtle` back while the second half is still to run — and the second half
// would then quietly take the fast path this harness exists to avoid. The test
// would pass, and would be proving nothing.
function withPolyfillOnly(fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const real = globalThis.crypto;
  const restore = () => { if (saved) Object.defineProperty(globalThis, 'crypto', saved); };
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues: a => real.getRandomValues(a) },
    configurable: true, writable: true,
  });
  let result;
  try {
    result = fn();
  } catch (e) {
    restore();
    throw e;
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      value => { restore(); return value; },
      error => { restore(); throw error; },
    );
  }
  restore();
  return result;
}

// ── The premise: crypto-js has no randomness of its own ──
//
// If this ever stops being true the polyfill is still harmless, but the reason
// for its import order is gone and this test should be the thing that says so.
//
// Deleting the global is not enough to see it here: crypto-js has a fourth
// source, `require('crypto')`, which succeeds in Node and does not exist under
// Metro. So its core is loaded in a sandbox with every source removed — no
// crypto global, no require — which is what the module actually sees on Hermes.
{
  const vm = require('node:vm');
  const fs = require('node:fs');
  const core = fs.readFileSync(require.resolve('crypto-js/core.js'), 'utf8');

  const load = extraGlobals => {
    const sandbox = { module: { exports: {} }, ...extraGlobals };
    sandbox.exports = sandbox.module.exports;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(core, sandbox);
    return sandbox.module.exports;
  };

  const hermes = load({});
  ok('crypto-js cannot make random bytes without a platform source',
    threw(() => hermes.lib.WordArray.random(8)));
  ok('and says so rather than falling back to Math.random',
    (() => { try { hermes.lib.WordArray.random(8); return ''; } catch (e) { return e.message; } })
      .call().includes('secure random'));

  const polyfilledSandbox = load({ crypto: { getRandomValues: a => globalThis.crypto.getRandomValues(a) } });
  ok('given only getRandomValues, crypto-js works again',
    polyfilledSandbox.lib.WordArray.random(8).toString().length === 16);

  // AES needs the rest of the library, so that half is checked in-process,
  // where the polyfill shape is what matters rather than the absence.
  const polyfilled = withPolyfillOnly(() => loadCryptoJsFresh());
  ok('and AES, which needs a random salt, encrypts',
    polyfilled.AES.encrypt('hello', 'a key').toString().length > 0);

  loadCryptoJsFresh(); // leave the cache holding a good one for later tests
}

// ── Keys are never drawn from a weak source ──
ok('generating a data key stops rather than using a weak source',
  withoutCrypto(() => threw(generateDataKey)));
ok('so does generating a recovery code',
  withoutCrypto(() => threw(generateRecoveryCode)));
ok('and the reason says what is wrong',
  withoutCrypto(() => { try { generateDataKey(); return ''; } catch (e) { return e.message; } })
    .includes('secure source of randomness'));

// ── getRandomValues alone is enough ──
//
// The old code asked for `subtle` before it would use getRandomValues, so a
// platform with one and not the other fell through to the weak path.
ok('a key is generated with getRandomValues and no subtle',
  withPolyfillOnly(() => generateDataKey()).length === 64);
ok('and a recovery code too',
  withPolyfillOnly(() => generateRecoveryCode()).length > 0);
ok('two keys in a row differ', generateDataKey() !== generateDataKey());

// ── The two key derivations have to agree, byte for byte ──
//
// Web Crypto on a browser, @noble/hashes on Hermes, and if they ever disagree a
// task written on the laptop cannot be opened on the phone. Nothing would
// crash: the vault would simply refuse the password, on one device, for ever,
// and the ciphertext on the server is all there is.
//
// So both are run here, in the same process, against the same input. The
// polyfill harness is what makes that possible — it takes `subtle` away and
// leaves getRandomValues, which is exactly the shape of a native build.
{
  const EMAIL = 't.ashenafi@pm.me';
  const PASSWORD = 'correct horse battery';

  const web = await deriveAccountKeys(EMAIL, PASSWORD);
  const hermes = await withPolyfillOnly(() => deriveAccountKeys(EMAIL, PASSWORD));

  ok('the same password derives the same key with and without Web Crypto',
     web.kek === hermes.kek, `${web.kek}\n    vs ${hermes.kek}`);
  ok('and the same auth hash', web.authHash === hermes.authHash);

  // The pinned value, so this is an agreement on the right answer rather than
  // two implementations being wrong together.
  ok('and it is the value the rest of the suite pins',
     hermes.kek === '07532576c0a78e4ddc9bdabc5d40ab78c01c61b47efa18a8f561862561110ba8',
     hermes.kek);

  // Hermes has no TextEncoder either, so the step that turns a password into
  // bytes is the app's own. This is the input that catches a borrowed one.
  const accentedWeb = await deriveAccountKeys(EMAIL, 'Ünïcodé pässwörd 😀');
  const accentedHermes = await withPolyfillOnly(() => deriveAccountKeys(EMAIL, 'Ünïcodé pässwörd 😀'));
  ok('accents and emoji derive the same key on both paths',
     accentedWeb.kek === accentedHermes.kek, `${accentedWeb.kek}\n    vs ${accentedHermes.kek}`);
  ok('and that key is the pinned one too',
     accentedHermes.kek === '57bbc24159f7c4a5ad58d1f3c1df258f6b7acd93df9aae66ec1be35a0f2dceaa',
     accentedHermes.kek);
}

// ── Encryption never hands back the thing it was asked to hide ──
{
  const secret = 'the stopcock is behind the panel';
  ok('no key is an error, not a passthrough', threw(() => encrypt(secret, '')));
  ok('an undefined key is an error too', threw(() => encrypt(secret, undefined)));

  const bad = (() => { try { return encrypt(secret, null); } catch { return null; } })();
  ok('and nothing readable comes back from the attempt', bad !== secret);

  const cipher = encrypt(secret, 'a key');
  ok('a real encrypt does not resemble its input', !cipher.includes('stopcock'));
  ok('and round-trips', decrypt(cipher, 'a key') === secret);
  ok('the wrong key reads as nothing, not as garbage', decrypt(cipher, 'other') === null);
}

// ── The import that has to come first, still comes first ──
//
// crypto-js keeps whatever global it found when it loaded, so the polyfill only
// works if it runs before any import that reaches crypto-js. Nothing at runtime
// can check that; the order in the entry file is the guarantee.
{
  const entry = require('node:fs').readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const imports = entry.split('\n').filter(l => l.trim().startsWith('import '));
  ok('the entry point imports the randomness polyfill',
    imports.some(l => l.includes('secureRandom')));
  ok('and imports it before anything else',
    imports.length > 0 && imports[0].includes('secureRandom'), imports[0]);
}

// ── Zones, on an engine that may not have them ──────────────────────────────
//
// Times now carry the zone they were set in, and the arithmetic leans on Intl
// rather than on a shipped copy of the zone database — the platform has one and
// a second would be large and out of date. Hermes has shipped Intl for a while
// and older builds have not, and the dangerous failure is not a crash: it is a
// formatToParts that quietly ignores timeZone and returns answers that look
// right. So support is established by asking a question with a known answer.
{
  const zones = await import('../src/services/zones.js');

  ok('this engine can do zone arithmetic', zones.supported() === true);

  // With Intl taken away, everything must decline rather than guess. The app
  // then falls back to the wall clock it has always kept, which is the
  // behaviour people already have rather than a new and worse one.
  const saved = globalThis.Intl;
  try {
    delete globalThis.Intl;
    zones.forget();
    ok('without it, nothing claims to know a zone', zones.supported() === false);
    ok('no zone is known', zones.knownZone('America/New_York') === false);
    ok('no offset is offered', zones.offsetAt('America/New_York', new Date()) === null);
    ok('no moment is named', zones.instantOf(2026, 10, 2, 15, 0, 'America/New_York') === null);
    ok('and no clock is read', zones.clockIn('America/New_York', new Date()) === null);
    ok('the device admits it does not know where it is', zones.deviceZone() === '');
    // Two zones it cannot compare are not worth a sentence about.
    ok('and nothing is said about a difference it cannot see',
       zones.sameClock('Europe/London', 'America/New_York') === true);
  } finally {
    globalThis.Intl = saved;
    zones.forget();
  }

  ok('and it comes back when Intl does', zones.supported() === true);
}

// ── A layout that only collapses off the web ──
//
// `flex: 1` is a shorthand. react-native-web expands it into three CSS
// longhands, so a style laid over the top of it — flexBasis: 'auto', say —
// wins the way anyone reading the file would expect. Native does not do that.
// Yoga receives the shorthand and the longhands as separate properties and
// applies them in an order the stylesheet does not choose, so the shorthand can
// win instead and take flexBasis: 0 with it.
//
// The button then collapses to its padding. Nothing errors, nothing logs, and
// the text inside is clipped to nothing — which is how every project name in
// the task sheet came to be nine blank squares on a device while reading
// perfectly in the browser.
//
// So the rule is that the conflict never gets composed in the first place.
// Whatever it would have resolved to, a style that sets `flex` is not mixed
// with one that sets a flex longhand.
//
// This reads the source rather than a running layout, because a running layout
// is the one thing this suite cannot have: Yoga is the native side. It
// understands top-level StyleSheet entries and `style={[...]}` arrays, which is
// how this codebase writes them, and it would miss a style composed some other
// way.
{
  const SRC = new URL('../src/', import.meta.url).pathname;

  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
  };

  // The entries of a file's StyleSheet.create, as name -> the text of its body.
  const sheetEntries = src => {
    const entries = new Map();
    const at = src.indexOf('StyleSheet.create(');
    if (at < 0) return entries;

    let body = '';
    let depth = 0;
    for (let i = src.indexOf('{', at); i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '{') depth += 1;
      if (depth > 0) body += ch;
      if (ch === '}') { depth -= 1; if (depth === 0) break; }
    }

    let key = '', value = '', inKey = true, nested = 0;
    for (let i = 1; i < body.length; i += 1) {
      const ch = body[i];
      if (inKey) {
        if (ch === ':') { inKey = false; value = ''; continue; }
        if (ch === ',' || ch === '\n') { key = ''; continue; }
        key += ch;
        continue;
      }
      if (ch === '{') nested += 1;
      if (ch === '}') nested -= 1;
      if (nested === 0 && ch === ',') {
        entries.set(key.trim(), value);
        key = ''; value = ''; inKey = true;
        continue;
      }
      value += ch;
    }
    return entries;
  };

  const SHORTHAND = /(^|[^a-zA-Z])flex\s*:/;
  const LONGHAND = /flexBasis|flexGrow|flexShrink/;

  const clashes = [];
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    const entries = sheetEntries(src);
    if (!entries.size) continue;
    const where = path.relative(SRC, file);

    for (const [name, text] of entries) {
      if (SHORTHAND.test(text) && LONGHAND.test(text)) clashes.push(`${where}: ${name}`);
    }

    for (const found of src.matchAll(/style=\{\[([^\]]*)\]\}/g)) {
      const names = [...found[1].matchAll(/styles?\.([A-Za-z0-9_]+)/g)].map(m => m[1]);
      const texts = names.map(n => entries.get(n) || '');
      if (texts.some(t => SHORTHAND.test(t)) && texts.some(t => LONGHAND.test(t))) {
        clashes.push(`${where}: [${names.join(', ')}]`);
      }
    }
  }

  ok('no style mixes the flex shorthand with a flex longhand',
     clashes.length === 0, clashes.join('; '));
}

// ── A sheet you can pull down, and nobody told ──
//
// On iOS a pageSheet is dismissed by pulling it down. React Native reports that
// through onRequestClose and asks for the prop on every pageSheet for exactly
// that reason. Without it the sheet disappears, nothing is called, and whatever
// was on it is gone — while the parent goes on believing it is open.
//
// There is no such gesture on the web, so nothing in the browser suite can see
// this, and the way it showed up was a voice note recorded on a phone that was
// never anywhere afterwards: it lives in the sheet until Save, and the pull-down
// is not Save.
{
  const SRC = new URL('../src/', import.meta.url).pathname;
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
  };

  const silent = [];
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    // Each <Modal …> opening tag, up to the > that ends it.
    for (const tag of src.matchAll(/<Modal\b[^>]*>/g)) {
      const text = tag[0];
      if (!/presentationStyle=["']?\{?["']?(pageSheet|formSheet)/.test(text)) continue;
      if (/onRequestClose/.test(text)) continue;
      silent.push(path.relative(SRC, file));
    }
  }

  ok('every sheet that can be pulled down says what that means',
     silent.length === 0, silent.join(', '));
}

// ── A native module built for a different React Native ──
//
// This is the check that would have stopped a day being lost. Installing
// expo-speech-recognition on Expo SDK 55 produced a build that compiled and
// then killed the app the first moment anything rendered the quick-add line —
// because a native module can compile against the wrong React Native and still
// fail as it registers, which no try/catch around the require can help with.
//
// The package publishes one release per SDK and names it for that SDK: after
// 3.1.3 come 56 and 57, and 55 is the one it skipped. So the major of the
// installed package has to be the major of the installed Expo, and a build
// succeeding is not evidence of anything until it is.
{
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const majorOf = range => {
    const match = String(range || '').match(/(\d+)\./);
    return match ? Number(match[1]) : null;
  };
  const sdk = majorOf(pkg.dependencies.expo);
  const speech = pkg.dependencies['expo-speech-recognition'];

  ok('the Expo SDK in use is readable from the manifest', sdk !== null, String(pkg.dependencies.expo));

  // Absent is a perfectly good answer: the phone falls back to the keyboard's
  // own microphone key, which is what it did between the two attempts.
  if (speech) {
    ok('the speech package is built for the SDK this app is on',
       majorOf(speech) === sdk, `expo ${pkg.dependencies.expo}, speech ${speech}`);

    // Installed, not merely asked for. A range that resolves to something else
    // is the same failure wearing a different hat.
    const installed = JSON.parse(
      fs.readFileSync(new URL('../node_modules/expo-speech-recognition/package.json', import.meta.url), 'utf8')
    ).version;
    ok('and the copy actually installed is that one too',
       majorOf(installed) === sdk, `expo ${pkg.dependencies.expo}, installed ${installed}`);

    // Asking for the microphone is not optional on a phone, and the error it
    // gives when you skip it looks exactly like a microphone that is broken.
    const speechSrc = fs.readFileSync(new URL('../src/services/speech.js', import.meta.url), 'utf8');
    ok('and permission is asked for before anything listens',
       /requestPermissionsAsync/.test(speechSrc), 'services/speech.js never asks');
  }
}

// ── Purpose strings Apple will ask for ──
//
// Apple rejects a build whose binary references certain APIs without a
// user-facing reason in Info.plist, and it does not care whether the app calls
// them. A dependency deep in the tree is enough: expo depends on
// expo-file-system, which carries a legacy path for copying a photo out of the
// library, and that one linked symbol cost a build and an upload.
//
// The rejection arrives after the build, the submission and the wait, which is
// the worst possible place to learn it. Everything needed to know it earlier is
// on this disk.
{
  const appJson = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const MODULES = new URL('../node_modules/', import.meta.url).pathname;

  // Kept narrow on purpose. A false alarm here sends somebody looking for a
  // permission the app does not want, so each pattern is one that means the
  // API itself rather than a word that appears near it.
  const NEEDS = [
    { api: /PHPhotoLibrary|PHPickerViewController|UIImagePickerController/, key: 'NSPhotoLibraryUsageDescription' },
    { api: /SFSpeechRecognizer/, key: 'NSSpeechRecognitionUsageDescription' },
    { api: /CNContactStore/, key: 'NSContactsUsageDescription' },
    { api: /CLLocationManager/, key: 'NSLocationWhenInUseUsageDescription' },
    { api: /LAContext\b/, key: 'NSFaceIDUsageDescription' },
    { api: /EKEntityType\.reminder|EKEntityMaskReminder/, key: 'NSRemindersUsageDescription' },
  ];

  const NATIVE = /\.(swift|m|mm|h)$/;
  const sources = [];
  const gather = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) gather(full);
      else if (NATIVE.test(entry.name)) sources.push(full);
    }
  };

  // The native surface of this app: every expo module, and the one other
  // package that ships iOS code.
  for (const name of fs.readdirSync(MODULES)) {
    if (!name.startsWith('expo')) continue;
    gather(path.join(MODULES, name, 'ios'));
    gather(path.join(MODULES, name, 'apple'));
  }
  gather(path.join(MODULES, '@react-native-async-storage', 'async-storage', 'ios'));

  ok('there is native code to look at', sources.length > 50, String(sources.length));

  // A string counts as present whether it is written here or added by a config
  // plugin, because the build sees no difference between the two.
  const declared = new Set(Object.keys((appJson.expo.ios || {}).infoPlist || {}));
  const pluginNames = (appJson.expo.plugins || []).map(entry => (Array.isArray(entry) ? entry[0] : entry));
  //
  // Where a plugin keeps its code varies — some ship plugin/build/*.js, some a
  // single app.plugin.js at the root — and reading only one of those reports a
  // string as missing when it is not, which is a worse failure than the one
  // this is guarding against.
  const pluginText = pluginNames.map(name => {
    const root = path.join(MODULES, name);
    const files = [];
    const collect = dir => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    collect(path.join(root, 'plugin'));
    const single = path.join(root, 'app.plugin.js');
    if (fs.existsSync(single)) files.push(single);
    return files.map(file => {
      try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
    }).join('\n');
  }).join('\n');

  const provided = key => declared.has(key) || pluginText.includes(key);

  const wanted = new Map();
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    for (const need of NEEDS) {
      if (!wanted.has(need.key) && need.api.test(text)) {
        wanted.set(need.key, path.relative(MODULES, file));
      }
    }
  }

  const missing = [...wanted].filter(([key]) => !provided(key));
  ok('every API Apple asks a reason for has one',
     missing.length === 0,
     missing.map(([key, where]) => `${key} (referenced by ${where})`).join('; '));

  // The one that was actually missed, named, so removing it by accident is a
  // failure with a sentence attached rather than a puzzle.
  ok('including the photo library, which expo-file-system reaches into',
     provided('NSPhotoLibraryUsageDescription'), 'nothing declares it');
}

// ── The yield that cost forty-five seconds ──
//
// noble yields to the event loop every `asyncTick` milliseconds so a long
// derivation cannot freeze the page. Its default is 10, and in a browser that
// is free — the yield is a scheduler callback. On a phone it falls back to
// setTimeout(0), which on React Native means the timer bridge, and the device
// reported 45.5 s to derive one key that takes 277 ms on a machine with a JIT.
//
// Left to the default it will be ten again, and nothing about the result will
// look wrong — the key is correct either way. Only the clock says anything,
// and only on hardware.
{
  const src = fs.readFileSync(new URL('../src/services/crypto.js', import.meta.url), 'utf8');
  const set = src.match(/asyncTick:\s*(\d+)/);
  ok('the derivation says how often it may stop to look up', !!set, 'asyncTick is left to the default');
  if (set) {
    ok('and it is not the default, which is a yield every ten milliseconds',
       Number(set[1]) >= 100, `asyncTick: ${set[1]}`);
  }
}

// ── Calling a function the module no longer has ──
//
// expo-calendar 57 renamed requestCalendarPermissionsAsync, getCalendarsAsync
// and getEventsAsync and did not keep the old names at the package root; they
// moved to build/legacy. Calling one that is not there is a TypeError, and the
// catch around reading the phone's calendar turned that into "this device has
// no calendar" — indistinguishable from a refused permission.
//
// Nothing in a browser can catch that: the whole path is skipped on web. So
// the names the app calls are checked against the names the installed package
// actually exports, which is a question answerable from this disk.
{
  const MODULES = new URL('../node_modules/', import.meta.url).pathname;
  const feed = fs.readFileSync(new URL('../src/services/calendarFeed.js', import.meta.url), 'utf8');

  // Every `Calendar.something` the source reaches for.
  const wanted = [...new Set(
    [...feed.matchAll(/\bCalendar\.([A-Za-z_]\w*)/g)].map(m => m[1])
  )];
  ok('the calendar module is reached for by name', wanted.length > 0, JSON.stringify(wanted));

  // What it exports, read from the built JavaScript rather than the types: the
  // types describe an intention, the build is what gets bundled.
  const built = ['Calendar.js', 'index.js']
    .map(file => {
      try { return fs.readFileSync(path.join(MODULES, 'expo-calendar', 'build', file), 'utf8'); }
      catch { return ''; }
    })
    .join('\n');
  ok('and the built module can be read', built.length > 0, 'expo-calendar/build is missing');

  // Exported as a function, as a const, or re-exported in a braced list.
  const exported = new Set();
  for (const m of built.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) exported.add(m[1]);
  for (const m of built.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) exported.add(m[1]);
  for (const m of built.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(',')) {
      const name = piece.trim().split(/\s+as\s+/).pop().trim();
      if (name) exported.add(name);
    }
  }

  // A name the source only reaches for behind a fallback is fine as long as one
  // of the pair exists; what must never happen is every spelling being absent.
  const missing = wanted.filter(name => !exported.has(name));
  const stillThere = wanted.filter(name => exported.has(name));

  ok('at least some of what it calls exists', stillThere.length > 0,
     `none of ${JSON.stringify(wanted)} is exported`);

  // The three that moved, each tried under both spellings. One of each pair has
  // to be there or the phone has no diary and says nothing about why.
  const pairs = [
    ['requestCalendarPermissions', 'requestCalendarPermissionsAsync'],
    ['getCalendars', 'getCalendarsAsync'],
    ['listEvents', 'getEventsAsync'],
  ];
  for (const pair of pairs) {
    const reached = pair.filter(name => wanted.includes(name));
    if (!reached.length) continue;
    // Among the spellings the source actually reaches for — not among the
    // spellings that exist. Asking whether either name is exported passes
    // happily while the source calls only the one that is gone, which is the
    // precise bug this is here to catch.
    ok(`what the source calls for ${pair.join(' / ')} is exported`,
       reached.some(name => exported.has(name)),
       `the source calls ${reached.join(' and ')}, and none of those is exported`);
  }

  // Said rather than hidden: a name that is gone is worth knowing about even
  // when a fallback covers it, because the fallback is the thing that will be
  // deleted one day as dead code.
  if (missing.length) {
    console.log(`      (not exported, covered by a fallback: ${missing.join(', ')})`);
  }
}

// ── Two features that were dead on a phone and said nothing ──
//
// pickTextFile returned null immediately on anything but the web, so "Read a
// calendar" did nothing when tapped and so did restoring a backup from a file.
// The callers read that null as a cancellation, which is why neither said
// anything. Restoring is the one that matters: it is the button somebody
// presses after losing everything.
//
// It still cannot pick a file on a phone — that needs expo-document-picker,
// which is a native module and a decision of its own. What it must never do
// again is be silent about it.
//
// Nothing in the browser suite can see any of this: on the web it works.
{
  const MODULES = new URL('../node_modules/', import.meta.url).pathname;
  const picker = fs.readFileSync(new URL('../src/services/saveFile.js', import.meta.url), 'utf8');
  const sheet = fs.readFileSync(new URL('../src/components/AccountSheet.js', import.meta.url), 'utf8');

  ok('a phone is not handed the same null as a cancellation',
     !/Platform\.OS !== 'web'\)\s*return Promise\.resolve\(null\)/.test(picker),
     'pickTextFile still returns a bare null on native');
  ok('and it says why instead', /failed:/.test(picker), 'no way to report a picker that cannot open');

  // Both callers have to act on it. One of them reporting it and the other
  // swallowing it is the same bug half fixed.
  const reported = sheet.match(/file\.failed/g) || [];
  ok('both features report it, not one', reported.length >= 2,
     `file.failed is handled ${reported.length} time(s)`);

  // And the reason it is not simply implemented: the picker expo-file-system
  // declares is not reachable from JavaScript in this version. If a later one
  // connects it, this fails and the note above can be deleted.
  let reachable = false;
  try {
    const fsPkg = JSON.parse(fs.readFileSync(path.join(MODULES, 'expo-file-system', 'package.json'), 'utf8'));
    const entries = Object.keys(fsPkg.exports || {});
    const built = fs.readFileSync(path.join(MODULES, 'expo-file-system', 'build', 'File.js'), 'utf8');
    reachable = /pickFileAsync/.test(built) || entries.some(e => /ExpoFileSystem/.test(e));
  } catch { reachable = false; }
  ok('expo-file-system still offers no picker JavaScript can call',
     reachable === false,
     'a picker is reachable now — saveFile.js can use it and the note can go');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
