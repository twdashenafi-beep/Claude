// A vault that will not open must not be emptied.
//
// This is the bug that cost somebody every task they had.
//
// The vault is decrypted a row at a time, and a row that will not open is
// skipped — which is right when one malformed row sits among hundreds, and
// catastrophic when the key itself is wrong, because then every row is
// skipped. The app was then holding an empty list, showing no error, with a
// timer already counting down to saving that empty list over the only copy
// there was. Two hundred and fifty milliseconds between "I cannot read this"
// and "there is nothing here".
//
// What this insists on is the distinction the app failed to make: an empty
// vault and an unreadable one are not the same thing. The first is saved over
// quite happily. The second is left exactly as it is, said out loud, and still
// there when the right key comes back.
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
await new Promise(r => server.listen(4867, r));

const PROJECT = 'https://stubproject.supabase.co';
const KEY = 'sb_publishable_stubkeyabcdefghijkl';
const USER = { id: 'user-1', email: 't@example.com', aud: 'authenticated', role: 'authenticated' };
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

const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log(`  page error: ${e}`));
await page.route(u => u.hostname === 'stubproject.supabase.co', route);
await page.goto('http://localhost:4867/Claude/', { waitUntil: 'networkidle' });
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

// Read from the DOM rather than from innerText.
//
// document.body.innerText is the *rendered* text, and with a sheet sliding over
// the page it came back as the single word DAYFLOW — for long enough that three
// assertions failed on it while the thing they were testing was on screen and
// working. Asking the document what it contains does not depend on what has
// been painted.
const body = async () => page.evaluate(() => document.body.textContent || '');
const shows = async t => (await body()).includes(t);

async function add(title) {
  const box = page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await page.waitForTimeout(700);
}

// Waited on by visibility, which is the only one of the three ways of asking
// that is true here.
//
// innerText is the rendered text, and half way through a sheet sliding in it
// came back as the single word DAYFLOW. textContent is everything in the
// document, which includes a sheet that has been closed but not unmounted — so
// waiting for "Export a copy" to go away waited for ever, and the next thing
// clicked went under an overlay that was still there.
const seen = (text, exact = true) => page.getByText(text, { exact });
const visible = (text, state = 'visible') =>
  seen(text).first().waitFor({ state, timeout: 10000 });

const openAccount = async () => {
  await page.getByLabel('Account settings').click();
  await visible('Export a copy');
  await page.waitForTimeout(300);
};
const closeAccount = async () => {
  // The sheet's one header action is Done on the menu and Back inside any of
  // its sub-views, so getting out of a preview takes both — which is a thing a
  // person does without noticing and a test has to be told.
  const back = page.getByText('Back', { exact: true });
  if ((await back.count()) > 0 && (await back.first().isVisible())) {
    await back.first().click();
    await page.waitForTimeout(500);
  }
  await page.getByText('Done', { exact: true }).first().click();
  await visible('Export a copy', 'hidden');
  await page.waitForTimeout(400);
};
const shown = async pattern => {
  const hits = await page.getByText(pattern).all();
  for (const hit of hits) if (await hit.isVisible()) return true;
  return false;
};

// Waits for any *visible* match, rather than for the first match to become
// visible. The distinction cost an hour: a sheet that has been closed leaves
// its text in the document, so `.first()` kept resolving to the previous
// preview — hidden, and never going to be anything else — while the new one was
// on screen the whole time.
const appears = async (pattern, ms = 15000) => {
  for (let i = 0; i < ms / 100; i += 1) {
    if (await shown(pattern)) return true;
    await page.waitForTimeout(100);
  }
  return false;
};

// ── Something worth losing ──
// Three tasks, left exactly as written: this suite is about whether they
// survive, not about what a restore merges.
await add('Renew the passport');
await add('Book the dentist');
await add('Pay the window cleaner');


// ── A key that does not fit must not empty the drawer ───────────────────────
//
// This is the one that cost somebody their tasks.
//
// The vault is decrypted a row at a time and a row that will not open is
// skipped, which is right when one row among hundreds is malformed. When the
// key itself is wrong every row is skipped, and the app then had an empty
// list, no error, and a timer already counting down to saving that empty list
// over the only copy there was. Two hundred and fifty milliseconds between
// "cannot read this" and "there is nothing here".
//
// So: unreadable rows must leave the drawer exactly as it was, say so, and
// stay recoverable the moment the right key comes back.

// The vault, read and written straight rather than through the app.
const vaultNow = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('dayflow', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return new Promise((res, rej) => {
    const r = db.transaction('kv', 'readonly').objectStore('kv').get('@dayflow_vault_v2');
    r.onsuccess = () => res(r.result === undefined ? null : r.result);
    r.onerror = () => rej(r.error);
  });
});

const putVault = text => page.evaluate(async value => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('dayflow', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, '@dayflow_vault_v2');
    tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
  });
}, text);

const held = await vaultNow();
ok('the vault is on the device to begin with', !!held, String(held).slice(0, 80));
const before = JSON.parse(held);
ok('with the tasks in it', before.rows.length >= 2, String(before.rows.length));

// Every row made unreadable, which is what a wrong key looks like from here.
await putVault(JSON.stringify({
  ...before,
  rows: before.rows.map(r => ({ ...r, ciphertext: 'U2FsdGVkX1/not/the/right/key' })),
}));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText(/unlock|open/i).first().click();
await page.waitForTimeout(2600);

ok('a vault that will not open says so', await shown(/could not be read/i),
   (await body()).slice(0, 500));

// The whole point. Two and a half seconds is ten times the window in which
// the empty list used to be written back.
const after = JSON.parse(await vaultNow());
ok('and the rows are still there, not written over',
   after.rows.length === before.rows.length, String(after.rows.length));
ok('and a copy has been put aside as well', await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('dayflow', 1);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return new Promise(res => {
    const r = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
    r.onsuccess = () => res(r.result.map(String).includes('@dayflow_vault_v2_unreadable'));
    r.onerror = () => res(false);
  });
}));

// Hidden, not gone: the proof is that the right key still opens it.
await putVault(held);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText(/unlock|open/i).first().click();
await page.waitForTimeout(2600);

const back = await body();
ok('and when the key fits again, everything is still there',
   back.includes('Pay the window cleaner'), back.slice(0, 400));
ok('all of it', back.includes('Book the dentist'), back.slice(0, 400));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
