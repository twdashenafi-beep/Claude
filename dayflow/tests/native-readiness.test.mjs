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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
