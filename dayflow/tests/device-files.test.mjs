// Getting a file off the phone, and back onto it.
//
// Both halves of this were broken on a phone and working on the web, which is
// the shape of every bug in this file.
//
// Exporting answered "too large to send from here — export from the browser
// instead" on a real backup, because the JSON was handed to the share sheet as
// a *message* and a message has a size past which the sheet is a spinner. A
// backup carries voice notes, so an ordinary export reaches that size. It is
// written to a file now.
//
// Restoring did nothing at all, and then said it could not be done, on a note
// claiming expo-file-system's picker had no implementation behind it. It has
// one; the package ships TypeScript, so looking in its compiled output found
// nothing because nothing compiled is there. Both directions work on a phone
// now, and the one that matters is this one: restoring is the button somebody
// presses after losing everything.
//
// None of it can be reached by importing the module: saveFile.js imports
// react-native, which Node cannot parse, and both routes are behind
// `Platform.OS`. So the source is compiled here and run against stand-ins for
// react-native and expo-file-system — the only way to see branches that run
// only on a phone, the one place none of this is tested.
//
// Run with `npm test`.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// ── The harness ─────────────────────────────────────────────────────────────

const SOURCE = fs.readFileSync(new URL('../src/services/saveFile.js', import.meta.url), 'utf8');
const { code: TRANSLATED } = babel.transformSync(SOURCE, {
  babelrc: false,
  configFile: false,
  filename: 'saveFile.js',
  plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
});

// Static imports are now plain `require` calls, but `import(...)` is left as it
// was — the commonjs transform does not touch it, and a real dynamic import has
// no module to resolve against inside `new Function`. So the one call is pointed
// at the same resolver the static ones use.
//
// A rewrite that quietly matched nothing would leave the file route unreachable
// and every assertion about it passing on the fallback instead, so the count is
// checked rather than assumed.
const DYNAMIC = (TRANSLATED.match(/\bimport\(/g) || []).length;
const COMPILED = TRANSLATED.replace(/\bimport\(/g, 'require(');
ok('both modules loaded only on a phone are reachable from here', DYNAMIC === 2, String(DYNAMIC));

// Loads saveFile.js with the modules it asks for replaced. Anything it reaches
// for that is not listed throws, so a route quietly taking a different module
// than the one it is supposed to shows up as a failure rather than a pass.
function load(stubs) {
  const mod = { exports: {} };
  const resolve = name => {
    if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
    throw new Error(`saveFile asked for ${name}, which this test did not offer`);
  };
  new Function('require', 'module', 'exports', COMPILED)(resolve, mod, mod.exports);
  return mod.exports;
}

// A share sheet. Records what it was handed, and answers however the test says.
function sheet(answer = { action: 'sharedAction' }) {
  const calls = [];
  const Share = {
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
    share(content) {
      calls.push(content);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer);
    },
  };
  return { Share, calls };
}

// expo-file-system, as far as this code uses it. `broken` makes writing fail,
// which is what a full disk or a sandbox refusal looks like from in here.
function files({ broken = false } = {}) {
  const written = [];
  class File {
    constructor(dir, name) {
      this.dir = dir;
      this.name = name;
      this.uri = `file://${dir}/${name}`;
      this.created = null;
    }
    create(opts) {
      if (broken) throw new Error('could not create');
      this.created = opts || {};
    }
    write(text) {
      if (broken) throw new Error('could not write');
      written.push({ dir: this.dir, name: this.name, text, created: this.created });
    }
  }
  return { mod: { File, Paths: { cache: '/cache' } }, written };
}

const rn = (os, Share) => ({ Platform: { OS: os }, Share });

// Big enough that the old message route refused it, which is the whole point.
const BIG = JSON.stringify({ note: 'x'.repeat(700 * 1024) });

// ── On an iPhone: a file, whatever its size ─────────────────────────────────
{
  const { Share, calls } = sheet();
  const fsStub = files();
  const { saveTextFile } = load({ 'react-native': rn('ios', Share), 'expo-file-system': fsStub.mod });

  const result = await saveTextFile('dayflow-2026-10-11.json', BIG);
  ok('a backup past the old message limit saves on a phone', result === 'saved', String(result));
  ok('and it was written to a file', fsStub.written.length === 1, String(fsStub.written.length));
  ok('with all of it, not a truncation',
     fsStub.written[0] && fsStub.written[0].text === BIG,
     `${fsStub.written[0] ? fsStub.written[0].text.length : 0} of ${BIG.length}`);
  ok('under the name the export chose',
     fsStub.written[0] && fsStub.written[0].name === 'dayflow-2026-10-11.json',
     fsStub.written[0] && fsStub.written[0].name);
  ok('in the cache, which is where a file handed straight to the sheet belongs',
     fsStub.written[0] && fsStub.written[0].dir === '/cache',
     fsStub.written[0] && fsStub.written[0].dir);
  ok('overwriting yesterday rather than appending to it',
     fsStub.written[0] && fsStub.written[0].created
       && fsStub.written[0].created.overwrite === true,
     JSON.stringify(fsStub.written[0] && fsStub.written[0].created));
  ok('the sheet was asked once', calls.length === 1, String(calls.length));
  ok('and handed the file, by path', calls[0] && calls[0].url === 'file:///cache/dayflow-2026-10-11.json',
     JSON.stringify(calls[0] && calls[0].url));
  ok('not the text as a message, which is the bug this replaces',
     calls[0] && calls[0].message === undefined, typeof (calls[0] || {}).message);
}

// ── Exporting twice writes one file, not two ────────────────────────────────
{
  const { Share } = sheet();
  const fsStub = files();
  const { saveTextFile } = load({ 'react-native': rn('ios', Share), 'expo-file-system': fsStub.mod });
  await saveTextFile('dayflow-2026-10-11.json', '{"a":1}');
  await saveTextFile('dayflow-2026-10-11.json', '{"a":2}');
  ok('exporting twice in a day leaves the second copy', fsStub.written.length === 2
     && fsStub.written[1].text === '{"a":2}');
  ok('under the same one name', new Set(fsStub.written.map(w => w.name)).size === 1);
}

// ── Dismissing the sheet is not a failure ──────────────────────────────────
{
  const { Share } = sheet({ action: 'dismissedAction' });
  const fsStub = files();
  const { saveTextFile } = load({ 'react-native': rn('ios', Share), 'expo-file-system': fsStub.mod });
  const result = await saveTextFile('dayflow-2026-10-11.json', BIG);
  ok('closing the sheet without choosing is a cancellation', result === 'cancelled', String(result));
}

// ── Nothing could be written: the old route is still better than refusing ───
{
  const { Share, calls } = sheet();
  const fsStub = files({ broken: true });
  const { saveTextFile } = load({ 'react-native': rn('ios', Share), 'expo-file-system': fsStub.mod });

  const small = await saveTextFile('dayflow-2026-10-11.json', '{"a":1}');
  ok('a file that cannot be written falls back to the message', small === 'saved', String(small));
  ok('and the message carries the backup', calls[0] && calls[0].message === '{"a":1}');

  const big = await saveTextFile('dayflow-2026-10-11.json', BIG);
  ok('and past the message limit it says so rather than hanging', big === 'toolarge', String(big));
}

// ── Written, but the sheet itself failed ───────────────────────────────────
{
  const { Share, calls } = sheet(new Error('no sheet today'));
  const fsStub = files();
  const { saveTextFile } = load({ 'react-native': rn('ios', Share), 'expo-file-system': fsStub.mod });
  const result = await saveTextFile('dayflow-2026-10-11.json', '{"a":1}');
  ok('a sheet that throws is survived', result === 'unavailable', String(result));
  ok('after both routes were tried', calls.length === 2, String(calls.length));
}

// ── Nothing to save ────────────────────────────────────────────────────────
{
  const { Share, calls } = sheet();
  const fsStub = files();
  const { saveTextFile } = load({ 'react-native': rn('ios', Share), 'expo-file-system': fsStub.mod });
  ok('an empty export is not a file', await saveTextFile('x.json', '') === 'unavailable');
  ok('and nothing was written or shared', fsStub.written.length === 0 && calls.length === 0);
}

// ── Android keeps the message, because its sheet ignores a path ─────────────
//
// There is no Android build today. If there is one, the file route must not
// come with it: Android's share module reads `message` and `title` only, so a
// path would be shared as nothing at all and reported as saved — the silent
// failure the whole file is written against.
{
  const { Share, calls } = sheet();
  const fsStub = files();
  const { saveTextFile } = load({ 'react-native': rn('android', Share), 'expo-file-system': fsStub.mod });
  const result = await saveTextFile('dayflow-2026-10-11.json', '{"a":1}');
  ok('on Android the backup still goes as a message', result === 'saved' && calls.length === 1
     && calls[0].message === '{"a":1}', JSON.stringify(calls[0]));
  ok('and no file is written for a sheet that would ignore it', fsStub.written.length === 0);
}

// ── The web is untouched by any of this ────────────────────────────────────
//
// expo-file-system is deliberately absent from the stubs: the web bundle must
// not reach for it, and asking for it here throws.
{
  const { Share, calls } = sheet();
  const { saveTextFile, SHARE_LIMIT, MAX_PICK_BYTES } = load({ 'react-native': rn('web', Share) });

  const clicked = [];
  const doc = {
    body: { appendChild() {}, removeChild() {} },
    createElement() {
      const link = { click() { clicked.push(link.download); } };
      return link;
    },
  };
  // A desktop browser: share exists and refuses files, so the download runs.
  const nav = { share: () => Promise.reject(new Error('no')), canShare: () => false };
  const blobs = [];
  const keys = ['document', 'navigator', 'File', 'Blob', 'URL'];
  const prior = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const set = (key, value) =>
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  set('document', doc);
  set('navigator', nav);
  set('File', function () {});
  set('Blob', function (parts) { blobs.push(parts.join('')); });
  set('URL', { createObjectURL: () => 'blob:1', revokeObjectURL() {} });
  let result;
  try {
    result = await saveTextFile('dayflow-2026-10-11.json', BIG);
  } finally {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  ok('on the web a big backup still downloads', result === 'saved', String(result));
  ok('and the download carries all of it', blobs.length === 1 && blobs[0] === BIG);
  ok('under the name the export chose', clicked.length === 1
     && clicked[0] === 'dayflow-2026-10-11.json', clicked.join(', '));
  ok('the native sheet was never involved', calls.length === 0, String(calls.length));
  ok('and the limits the sheet publishes are unchanged',
     SHARE_LIMIT === 512 * 1024 && MAX_PICK_BYTES === 25 * 1024 * 1024);
}

// ── Reading a file back in, on a phone ──────────────────────────────────────

// A picked file, as expo-file-system hands one over.
function picked({ name = 'dayflow-2026-10-11.json', text = '{"app":"DayFlow"}', size = text.length, fails = false } = {}) {
  const reads = [];
  return {
    name,
    size,
    uri: `file:///picked/${name}`,
    text() {
      reads.push(name);
      return fails ? Promise.reject(new Error('gone')) : Promise.resolve(text);
    },
    reads,
  };
}

// expo-file-system's File, with only the static the picker needs. `asked`
// records the options it was called with, because what is NOT in them is the
// point: a type filter greys files out on iOS instead of narrowing the list.
function picker(answer) {
  const asked = [];
  const File = {
    pickFileAsync(options) {
      asked.push(options);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer);
    },
  };
  return { mod: { File, Paths: { cache: '/cache' } }, asked };
}

{
  const file = picked();
  const { mod, asked } = picker({ result: file, canceled: false });
  const { pickTextFile } = load({ 'react-native': rn('ios', sheet().Share), 'expo-file-system': mod });

  const result = await pickTextFile();
  ok('a backup chosen on a phone comes back', result !== null && result.text === '{"app":"DayFlow"}',
     JSON.stringify(result));
  ok('under the name it was chosen by', result && result.name === 'dayflow-2026-10-11.json',
     result && result.name);
  ok('and the picker was opened once', asked.length === 1, String(asked.length));
  ok('with nothing filtered out, which is what let a Proton calendar be chosen',
     asked[0] === undefined || asked[0].mimeTypes === undefined, JSON.stringify(asked[0]));
}

{
  const { mod } = picker({ result: null, canceled: true });
  const { pickTextFile } = load({ 'react-native': rn('ios', sheet().Share), 'expo-file-system': mod });
  // Caught rather than awaited plainly: reading the empty result of a
  // cancellation as a file throws, and a throw that takes the whole run down
  // with it says less than a failure standing next to its neighbours.
  let answer, threw = '';
  try { answer = await pickTextFile(); } catch (e) { threw = String(e && e.message); }
  ok('changing your mind in the picker is nothing at all',
     threw === '' && answer === null, threw || String(answer));
}

{
  const { mod } = picker(new Error('the picker would not open'));
  const { pickTextFile } = load({ 'react-native': rn('ios', sheet().Share), 'expo-file-system': mod });
  ok('a picker that will not open is survived', await pickTextFile() === null);
}

{
  // 25MB is the limit, and a film is how somebody reaches it now that nothing
  // is filtered out.
  const film = picked({ name: 'holiday.mov', text: 'not really a film', size: 40 * 1024 * 1024 });
  const { mod } = picker({ result: film, canceled: false });
  const { pickTextFile } = load({ 'react-native': rn('ios', sheet().Share), 'expo-file-system': mod });
  const result = await pickTextFile();
  ok('something far too big is refused by name rather than read',
     result !== null && result.tooBig === true && result.name === 'holiday.mov' && result.text === null,
     JSON.stringify(result));
  ok('and it was never read', film.reads.length === 0, String(film.reads.length));
}

{
  const vanished = picked({ fails: true });
  const { mod } = picker({ result: vanished, canceled: false });
  const { pickTextFile } = load({ 'react-native': rn('ios', sheet().Share), 'expo-file-system': mod });
  const result = await pickTextFile();
  ok('a file chosen and then unreadable says so', result !== null && typeof result.failed === 'string'
     && result.text === null, JSON.stringify(result));
  ok('rather than passing for a cancellation, which the person would not recognise',
     result !== null, String(result));
}

{
  // The one case the old message is the truth: a copy of the package without
  // the picker. It must not arrive as a cancellation, because a button that
  // cannot work must not look like one that was dismissed.
  const { pickTextFile } = load({
    'react-native': rn('ios', sheet().Share),
    'expo-file-system': { File: {}, Paths: { cache: '/cache' } },
  });
  const result = await pickTextFile();
  ok('a copy of the module with no picker is reported, not silently cancelled',
     result !== null && typeof result.failed === 'string', JSON.stringify(result));
}

{
  // And the module missing altogether — the resolver throws on it here.
  const { pickTextFile } = load({ 'react-native': rn('ios', sheet().Share) });
  const result = await pickTextFile();
  ok('and so is the module not being there at all',
     result !== null && typeof result.failed === 'string', JSON.stringify(result));
}

// ── And on the web, still the browser's own input ──────────────────────────
{
  const { pickTextFile } = load({ 'react-native': rn('web', sheet().Share) });
  const listeners = new Map();
  const input = {
    style: {},
    files: [{ name: 'dayflow-2026-10-11.json', size: 20 }],
    addEventListener: (kind, fn) => listeners.set(kind, fn),
    remove() {},
    click() { listeners.get('change')(); },
  };
  const keys = ['document', 'FileReader'];
  const prior = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const set = (key, value) =>
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  set('document', { body: { appendChild() {}, removeChild() {} }, createElement: () => input });
  set('FileReader', function () {
    this.readAsText = () => { this.result = '{"app":"DayFlow"}'; this.onloadend(); };
  });
  let result;
  try {
    result = await pickTextFile();
  } finally {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  ok('on the web the file input still reads what was chosen',
     result !== null && result.text === '{"app":"DayFlow"}' && result.name === 'dayflow-2026-10-11.json',
     JSON.stringify(result));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
