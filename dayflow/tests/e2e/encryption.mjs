// The app checking its own central claim.
//
// Everything DayFlow syncs is supposed to be ciphertext. Checking that used to
// mean a desk, the Supabase dashboard and a column of base64, which on a phone
// is not a check anybody performs — and a check nobody performs is not a check.
// So the app asks the server what it is holding and reads it back the way an
// intruder would.
//
// Both halves have to be proved, and the second matters more. An all-clear that
// is always an all-clear is worth nothing, so this poisons the server with a
// row of plain text and insists the app notices. That is the alarm nobody ever
// tests until the day it should have gone off.
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
await new Promise(r => server.listen(4816, r));

// ── the fake project ──
const PROJECT = 'https://stubproject.supabase.co';
const KEY = 'sb_publishable_stubkeyabcdefghijkl';
const USER = { id: 'user-1', email: 't@example.com', aud: 'authenticated', role: 'authenticated' };
// Long-lived, and minted fresh on every request. This test looks at the app
// months into the future, and a session that expired on the way there would put
// the sign-in screen up instead of the list.
const YEAR = 365 * 24 * 3600;
const session = () => ({
  access_token: 'stub-access', token_type: 'bearer', expires_in: YEAR,
  expires_at: Math.floor(Date.now() / 1000) + YEAR, refresh_token: 'stub-refresh', user: USER,
});
let vault = null;
const rows = new Map();

async function route(r) {
  const req = r.request();
  const p = new URL(req.url()).pathname;
  const json = (body, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (p.startsWith('/auth/v1/signup') || p.startsWith('/auth/v1/token')) return json(session());
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
await page.goto('http://localhost:4816/Claude/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
let inputs = page.locator('input, textarea');
await inputs.nth(0).fill(PROJECT);
await inputs.nth(1).fill(KEY);
await page.getByText('Connect', { exact: true }).click();
await page.waitForTimeout(1200);

await page.getByText('Create an account').click();
await page.waitForTimeout(300);
inputs = page.locator('input, textarea');
await inputs.nth(0).fill(USER.email);
await inputs.nth(1).fill('a strong master password');
await inputs.nth(2).fill('a strong master password');
await page.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await page.waitForTimeout(2500);
const ack = page.locator('text=/written|saved|wrote|understand|acknowledge/i').first();
if (await ack.count()) await ack.click();
const cont = page.locator('text=/continue|done|open/i').first();
if (await cont.count()) await cont.click();
await page.waitForTimeout(1500);


const body = async () => page.evaluate(() => document.body.innerText);

async function toDo(title) {
  const box = page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await page.waitForTimeout(900);
}

// The row reports its result in its own subtitle, and the accessibility label
// carries both halves — which is also the only way a screen reader would ever
// learn the answer.
const verdict = async () => page.evaluate(() => {
  const el = [...document.querySelectorAll('[aria-label]')]
    .find(e => (e.getAttribute('aria-label') || '').startsWith('Encryption'));
  return el ? el.getAttribute('aria-label') : null;
});

async function openAccount() {
  await page.getByLabel('Account settings').click();
  await page.waitForTimeout(700);
}
async function closeAccount() {
  await page.getByLabel('Close account settings').click();
  await page.waitForTimeout(500);
}
async function check() {
  await page.getByLabel(/^Encryption/).click();
  await page.waitForTimeout(1400);
  return verdict();
}

// ── Something to look at ──
await toDo('Chase Priya about the signed inventory');
await toDo('Cancel the gym membership');
// Pushing is debounced, so this waits for the rows rather than guessing how
// long they will take.
for (let i = 0; i < 40 && rows.size < 2; i += 1) await page.waitForTimeout(250);
ok('the tasks reached the stub server', rows.size >= 2, `rows: ${rows.size}`);

await openAccount();
ok('the account screen offers the check', (await verdict()) !== null, String(await verdict()));
ok('and says what it is for before it is pressed',
   /server is holding/i.test(await verdict() || ''), String(await verdict()));

// ── The all-clear ──
let said = await check();
ok('it reports the rows unreadable', /Unreadable/i.test(said || ''), String(said));
ok('and shows some of what is actually stored', /U2FsdGVkX1/.test(said || ''), String(said));
ok('and how many rows it looked at', /\d+ rows/.test(said || ''), String(said));
ok('and does not claim anything is readable', !/\bReadable/.test(said || ''), String(said));

// The sample must be the server's own bytes, not something the app made up.
const stored = [...rows.values()].map(r => r.ciphertext).filter(Boolean);
ok('the server really is holding ciphertext',
   stored.length > 0 && stored.every(c => /^[A-Za-z0-9+/=]+$/.test(c)),
   JSON.stringify(stored[0] || '').slice(0, 80));
const shown = (said.match(/· ([A-Za-z0-9+/=]+)…/) || [])[1];
ok('and the sample shown came from one of those rows',
   !!shown && stored.some(c => c.startsWith(shown)), String(said));

// ── The alarm ──
//
// An all-clear that is always an all-clear is worth nothing. So the server is
// given a row of plain text — exactly what a broken encrypt() would have
// written — and the app has to notice on the next press, with no reload and
// nothing else changed.
await closeAccount();
const victim = [...rows.keys()][0];
rows.set(victim, {
  ...rows.get(victim),
  ciphertext: JSON.stringify({ id: victim, title: 'Chase Priya about the signed inventory' }),
});
await openAccount();
said = await check();
ok('a plaintext row is caught', /Readable/i.test(said || ''), String(said));
ok('and named for what went wrong', /stored as plain text/i.test(said || ''), String(said));

// It must look like an alarm, not like a subtitle.
const pen = await page.evaluate(() => {
  const row = [...document.querySelectorAll('[aria-label]')]
    .find(e => (e.getAttribute('aria-label') || '').startsWith('Encryption'));
  if (!row) return null;
  const label = [...row.querySelectorAll('*')]
    .find(e => e.children.length === 0 && (e.innerText || '').trim() === 'Encryption');
  return label ? getComputedStyle(label).color : null;
});
ok('and the row turns red', pen !== null && pen !== 'rgb(87, 83, 75)', String(pen));

// ── Words in the clear, with no JSON to give it away ──
rows.set(victim, { ...rows.get(victim), ciphertext: 'xxxx Cancel the gym membership xxxx' });
said = await check();
ok('a bare title in a row is caught too', /Readable/i.test(said || ''), String(said));
ok('and your own words are quoted back',
   /Cancel the gym membership/.test(said || ''), String(said));

// ── And a row that is simply not base64 ──
rows.set(victim, { ...rows.get(victim), ciphertext: 'nothing here was ever encrypted' });
said = await check();
ok('anything outside the ciphertext alphabet is caught', /Readable/i.test(said || ''), String(said));

// ── Putting it back makes it clear again ──
//
// The verdict has to be a reading of what is there now, not a flag that latches.
rows.set(victim, { ...rows.get(victim), ciphertext: stored[0] });
said = await check();
ok('repairing the row clears the alarm', /Unreadable/i.test(said || ''), String(said));

if (process.env.SHOT) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: process.env.SHOT, fullPage: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
