// Reading a copy back in.
//
// DayFlow encrypts everything with a key derived from a master password that
// nothing can recover — not the server, which holds only ciphertext, and not
// the app. That is the whole point of it, and it is also why there has to be a
// way to hold a copy: one forgotten password, one cleared browser, and the
// vault is unreadable for good.
//
// A backup is never checked when it is made. It is checked years later, by
// somebody who no longer has the app that wrote it. So this does not test that
// a button exists — it presses the button, catches the file the browser
// downloads, opens it, and reads what is inside.
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
await new Promise(r => server.listen(4843, r));

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
await page.goto('http://localhost:4843/Claude/', { waitUntil: 'networkidle' });
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
await add('Renew the passport');
await add('Book the dentist');
await add('Pay the window cleaner');

await openAccount();
const waitFor = page.waitForEvent('download', { timeout: 15000 });
await page.getByText('Export a copy', { exact: true }).click();
const file = await waitFor;
const copy = await file.path();
ok('a copy is made to restore from', !!copy);
await closeAccount();

// ── Lose one ──
await page.getByLabel('Delete Book the dentist').click();
// Waited for by the row going, not by a stopwatch: deleting fades the row out,
// and asking during the fade finds it still there.
for (let i = 0; i < 100 && (await shown('Book the dentist')); i += 1) {
  await page.waitForTimeout(100);
}
await page.waitForTimeout(300);
ok('a task deleted is gone', !(await shown('Book the dentist')), (await body()).slice(0, 300));

// And change another, so there is something the copy must NOT undo.
await page.locator('text=Renew the passport').first().click();
await page.waitForTimeout(900);
const titleField = page.getByLabel('Task title');
await titleField.fill('Renew the passport — urgent');
await page.getByText('Save', { exact: true }).last().click();
await page.waitForTimeout(1200);
ok('and an edit made since is on the page', await shown('urgent'), (await body()).slice(0, 300));

// And add one that the copy has never heard of.
await add('Bought after the copy');

// ── Read it back ──
await openAccount();
ok('the account sheet offers to restore', await shown('Restore from a copy'),
   (await body()).slice(0, 400));

const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
await page.getByText('Restore from a copy', { exact: true }).click();
const picker = await chooser;
await picker.setFiles(copy);
await appears(/to add|Nothing in that copy/);
await page.waitForTimeout(300);

ok('it says what it would do before doing it', await shown(/to add/), (await body()).slice(0, 500));
ok('and promises to remove nothing', await shown(/Nothing is removed/), (await body()).slice(0, 500));
ok('and nothing has happened yet', !(await shown(/Brought in/)), (await body()).slice(0, 300));

await page.getByLabel('Bring this copy in').click();
await appears(/Brought in|Nothing to bring/);
await page.waitForTimeout(400);
ok('it says what it did', await shown(/Brought in/), (await body()).slice(0, 400));
await closeAccount();

// ── What the page looks like afterwards ──
const after = await body();
ok('the deleted task is back', after.includes('Book the dentist'), after.slice(0, 400));
ok('the task that was never lost is still there', after.includes('Pay the window cleaner'));
ok('the one added since is untouched', after.includes('Bought after the copy'));

// The edit is the one that matters: the copy holds an older version of that
// task, and bringing an older version forward over a newer one would be the
// import quietly losing work.
ok('an edit made after the copy is not undone', after.includes('urgent'), after.slice(0, 400));

const count = async title => page.evaluate(t => [...document.querySelectorAll('*')]
  .filter(e => e.children.length === 0 && (e.innerText || '').trim() === t).length, title);
ok('and nothing is doubled', (await count('Pay the window cleaner')) === 1,
   String(await count('Pay the window cleaner')));
ok('nor is the one that came back', (await count('Book the dentist')) === 1,
   String(await count('Book the dentist')));

// ── The same copy a second time ──
await openAccount();
const again = page.waitForEvent('filechooser', { timeout: 15000 });
await page.getByText('Restore from a copy', { exact: true }).click();
(await again).setFiles(copy);
await appears(/Nothing in that copy|to add/);
await page.waitForTimeout(300);
ok('the same copy again has nothing left to do',
   await shown(/Nothing in that copy is missing/), (await body()).slice(0, 400));
await closeAccount();
ok('and the page is unchanged by asking', (await count('Book the dentist')) === 1,
   String(await count('Book the dentist')));

// ── A file that is not a copy ──
await openAccount();
const wrong = page.waitForEvent('filechooser', { timeout: 15000 });
await page.getByText('Restore from a copy', { exact: true }).click();
(await wrong).setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
await appears(/not a DayFlow copy/i);
await page.waitForTimeout(300);
ok('something that is not a copy is refused', await shown(/not a DayFlow copy/i),
   (await body()).slice(0, 400));
ok('and refusing it changes nothing', !(await shown(/Brought in/)));

// ── One survives the round trip to the server ──
await closeAccount();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
await page.waitForTimeout(3500);
const reloaded = await body();
ok('what was brought back is still there after a reload',
   reloaded.includes('Book the dentist'), reloaded.slice(0, 400));
ok('and it did not take the deletion with it',
   !/Deleted/.test(reloaded), reloaded.slice(0, 200));

if (process.env.SHOT) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: process.env.SHOT });
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
