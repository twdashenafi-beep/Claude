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
import { generateDataKey, generateRecoveryCode } from '../src/services/crypto.js';
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
function withPolyfillOnly(fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues: a => real.getRandomValues(a) },
    configurable: true, writable: true,
  });
  try { return fn(); } finally {
    if (saved) Object.defineProperty(globalThis, 'crypto', saved);
  }
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
