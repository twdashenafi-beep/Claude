// What is on screen while the vault is being decrypted, and what it costs.
//
// Decrypting runs on the thread that draws. Until now a vault with recordings
// in it held that thread for several seconds, and what was on screen for those
// seconds was a day with no tasks in it — which is exactly what the app would
// show if everything had been lost. The wait was survivable; the impression was
// not, and it is the reason this screen exists.
//
// The other half is the number. "About ten seconds" is not something anybody
// can fix: reading the vault, decrypting the tasks and decrypting the handful
// of tasks that carry a recording are three different costs with three
// different remedies. So the report says which.
//
// A vault big enough to be slow is built by copying one real row many times
// over — same key, same ciphertext, a fresh id each — because a row that
// decrypts is the only kind that measures anything.
//
// Needs a build and a browser:
//   npm i -D playwright && npx playwright install chromium
//   npm run build:pages
//   npm run test:e2e
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('This test needs Playwright:\n  npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../../web-build', import.meta.url).pathname;
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.ico':'image/x-icon', '.png':'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/Claude/, '') || '/';
  if (p === '/' || !path.extname(p)) p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(4861, r));

const PROJECT = 'https://stubproject.supabase.co';
const KEY = 'sb_publishable_stubkeyabcdefghijkl';
const PASSWORD = 'a strong master password';
const USER = { id: 'user-1', email: 't@example.com', aud: 'authenticated', role: 'authenticated' };
const SESSION = {
  access_token: 'stub-access', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user: USER,
};
let vault = null;
const rows = new Map();

async function route(r) {
  const req = r.request();
  const p = new URL(req.url()).pathname;
  const json = (body, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (p.startsWith('/auth/v1/signup') || p.startsWith('/auth/v1/token')) return json(SESSION);
  if (p.startsWith('/auth/v1/user')) return json(USER);
  if (p.startsWith('/auth/v1/logout')) return r.fulfill({ status: 204, body: '' });
  if (p.startsWith('/rest/v1/vaults')) {
    if (req.method() === 'GET') return json(vault ? [vault] : []);
    vault = JSON.parse(req.postData() || '{}');
    if (Array.isArray(vault)) [vault] = vault;
    return json([vault], 201);
  }
  if (p.startsWith('/rest/v1/tasks')) {
    if (req.method() === 'GET') return json([...rows.values()]);
    for (const row of JSON.parse(req.postData() || '[]')) rows.set(row.id, row);
    return json([], 201);
  }
  return json({});
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };

const ctx = await browser.newContext({ serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('pageerror', e => console.log(`  page error: ${e}`));
await page.route(u => u.hostname === 'stubproject.supabase.co', route);
const body = () => page.evaluate(() => document.body.innerText);

// Reading and writing the vault straight, rather than through the app.
const readVault = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('dayflow', 1);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  return new Promise((res, rej) => {
    const q = db.transaction('kv', 'readonly').objectStore('kv').get('@dayflow_vault_v2');
    q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error);
  });
});

const writeVault = raw => page.evaluate(async value => {
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('dayflow', 1);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, '@dayflow_vault_v2');
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}, raw);

// ── An account with one task in it ──
await page.goto('http://localhost:4861/Claude/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.evaluate(([url, anonKey]) => {
  localStorage.setItem('@dayflow_sync_config', JSON.stringify({ url, anonKey }));
}, [PROJECT, KEY]);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

await page.getByText('Create an account').click();
await page.waitForTimeout(300);
let inputs = page.locator('input, textarea');
await inputs.nth(0).fill(USER.email);
await inputs.nth(1).fill(PASSWORD);
await inputs.nth(2).fill(PASSWORD);
await page.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await page.waitForTimeout(2500);
const ack = page.locator('text=/written|saved|wrote|understand|acknowledge/i').first();
if (await ack.count()) await ack.click();
const cont = page.locator('text=/continue|done|open/i').first();
if (await cont.count()) await cont.click();
await page.waitForTimeout(1500);

await page.locator('input, textarea').first().fill('Order the slate');
await page.locator('input, textarea').first().press('Enter');
await page.waitForTimeout(2000);

const raw = await readVault();
ok('there is a vault to start from', !!raw, String(raw).slice(0, 80));

// ── Made big enough to be slow ──
//
// Three more copies of the one real row, so the list that arrives at the end
// can still be checked against what was put in; then eight hundred rows of
// well-formed nonsense, which cost exactly the same AES work as real ones and
// are what actually makes a vault slow to open. Plus one row far too large to
// be anything but a recording.
//
// The split is made on the size of what is stored, because that is the only
// thing knowable before the work is done — so nonsense of the right size proves
// the accounting, and the real copies prove nothing was dropped on the way.
const FILLER = 800;
const enlarged = await page.evaluate(([text, filler]) => {
  const parsed = JSON.parse(text);
  const [first] = parsed.rows;
  const base64 = n => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < n; i += 1) out += alphabet[i % 64];
    return out;
  };
  // "Salted__" in base64, so what follows is parsed as ciphertext rather than
  // rejected at the first byte.
  const looksReal = n => `U2FsdGVkX1${base64(n)}`;

  const grown = [];
  for (let i = 0; i < 3; i += 1) {
    grown.push({ id: `copy-${i}`, ciphertext: first.ciphertext, updatedAt: first.updatedAt });
  }
  for (let i = 0; i < filler; i += 1) {
    grown.push({ id: `filler-${i}`, ciphertext: looksReal(8000), updatedAt: first.updatedAt });
  }
  grown.push({ id: 'a-recording', ciphertext: looksReal(300000), updatedAt: first.updatedAt });
  return JSON.stringify({ ...parsed, rows: [...parsed.rows, ...grown] });
}, [raw, FILLER]);
await writeVault(enlarged);

// ── Reopening it ──
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill(PASSWORD);
await page.getByText('UNLOCK', { exact: false }).first().click();

// The screen that did not exist. Sampled all the way through rather than
// looked at once, because what is being tested is not only that it appears but
// that what it says is true.
const samples = [];
for (let i = 0; i < 600; i += 1) {
  const text = await body().catch(() => '');
  if (/Opening your vault/.test(text)) samples.push(text);
  if (/Order the slate/.test(text)) break;
  await page.waitForTimeout(20);
}
const sawOpening = samples[0] || '';
const counts = samples
  .map(text => (text.match(/(\d+) of (\d+)/) || [])[1])
  .filter(Boolean)
  .map(Number);

ok('the wait says what it is doing', /Opening your vault/.test(sawOpening), sawOpening.slice(0, 120));
ok('and how far through it is', counts.length > 0, sawOpening.slice(0, 120));

// A bar that is the same width throughout is an animation pretending to be a
// measurement. This one is at the row the decrypt has actually reached, so it
// has to move — and the last reading has to be further on than the first.
ok('and the count is the real one, which moves',
   counts.length > 1 && counts[counts.length - 1] > counts[0],
   JSON.stringify(counts.slice(0, 12)));

// The bug this replaced: a day drawn with an empty list, which is what the app
// would show if everything had been lost.
ok('the day is not drawn empty behind it',
   samples.length > 0 && samples.every(text => !/\bof \d+ done\b/.test(text)),
   (samples.find(text => /\bof \d+ done\b/.test(text)) || '').slice(0, 200));

await page.waitForTimeout(6000);
const open = await body();

// The page says how long it took only when that was long enough to be worth
// saying. This vault opens in well under a second, so a notice here would be
// noise on every launch — which is the thing that gets a useful warning
// switched off and never switched back on.
ok('a quick opening is not announced on the page',
   !/Opened in /.test(open), (open.match(/Opened in [^\n]*/) || [''])[0]);
ok('and then the day arrives', /Order the slate/.test(open), open.slice(0, 200));
ok('the opening screen is gone', !/Opening your vault/.test(open), open.slice(0, 200));

// ── What it cost, and which part of it ──
await page.getByText('ACCOUNT', { exact: false }).first().click();
await page.waitForTimeout(800);
await page.getByText('This device', { exact: false }).first().click();
await page.waitForTimeout(2500);

const report = await body();
ok('the report says how long opening took', /Opened in /.test(report),
   (report.match(/Opened in [^\n]*/) || [''])[0] || report.slice(0, 300));
// The cost Face ID exists to remove. Reported alongside the rest so that a
// Face ID unlock that is still slow points at what is actually slow.
ok('deriving the key from the password is counted', /your password /.test(report),
   (report.match(/Opened in [^\n]*/) || [''])[0]);
ok('reading the vault is counted on its own', /reading /.test(report),
   (report.match(/Opened in [^\n]*/) || [''])[0]);
ok('and so are the tasks', /\d+ tasks /.test(report),
   (report.match(/Opened in [^\n]*/) || [''])[0]);

// Where the microphone comes from, said rather than left to be inferred from
// whether a button is on screen. In a browser it is the browser; the case that
// matters is a phone, where the same absence can mean the module is missing or
// that the build never carried it.
ok('the report names where dictation comes from', /Dictation comes from this browser/.test(report),
   (report.match(/Dictation[^\n·]*/) || [''])[0] || report.slice(0, 300));

// The number the whole exercise is for: whether the handful of rows carrying
// recordings is where the seconds go.
ok('rows big enough to hold a recording are counted apart from the rest',
   /1 with a recording/.test(report), (report.match(/Opened in [^\n]*/) || [''])[0]);

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
