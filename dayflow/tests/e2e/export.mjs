// Getting your tasks out of the app.
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
await new Promise(r => server.listen(4838, r));

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
await page.goto('http://localhost:4838/Claude/', { waitUntil: 'networkidle' });
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

// ── Something worth backing up ──
async function add(title) {
  const box = page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await page.waitForTimeout(700);
}

await add('Renew the passport');
await add('Book the dentist');
await add('Pay the window cleaner');

// One completed, and one archived — the two that are easiest to leave out of a
// backup and the two you would most regret losing, since between them they are
// the entire record of what you have already done.
await page.getByLabel('Mark Book the dentist as done').click();
await page.waitForTimeout(800);
await page.getByLabel('Mark Pay the window cleaner as done').click();
await page.waitForTimeout(800);

// Archiving is what deleting a finished task does: it leaves the page and goes
// to the archive rather than being thrown away. Which means reaching it through
// the completed list, where it now lives.
const expand = page.getByLabel(/^Show \d+ completed/).first();
if (await expand.count()) { await expand.click(); await page.waitForTimeout(500); }
await page.getByLabel('Delete Pay the window cleaner').click();
await page.waitForTimeout(900);

// ── Export ──
await page.getByLabel('Account settings').click();
await page.waitForTimeout(800);
ok('the account sheet offers a copy', await (async () => (await body()).includes('Export a copy'))(),
   (await body()).slice(0, 400));

const waitForDownload = page.waitForEvent('download', { timeout: 15000 });
await page.getByText('Export a copy', { exact: true }).click();
let download = null;
try {
  download = await waitForDownload;
} catch {
  // Left null; the assertions below say so rather than throwing.
}
ok('pressing it produces a file', !!download, (await body()).slice(0, 400));

if (download) {
  ok('named for the day it was made',
     /^dayflow-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()),
     download.suggestedFilename());

  const where = await download.path();
  const text = fs.readFileSync(where, 'utf8');

  let backup = null;
  try { backup = JSON.parse(text); } catch { /* reported below */ }
  ok('which is readable JSON', !!backup, text.slice(0, 200));

  if (backup) {
    const titles = (backup.tasks || []).map(t => t.title);
    ok('the open task is in it', titles.includes('Renew the passport'), JSON.stringify(titles));
    ok('the completed one too', titles.includes('Book the dentist'), JSON.stringify(titles));
    ok('and the archived one, which is the easiest to forget',
       titles.includes('Pay the window cleaner'), JSON.stringify(titles));
    ok('it says which account it came from', backup.account === USER.email, String(backup.account));
    ok('and when it was made', typeof backup.exportedAt === 'string' && !Number.isNaN(Date.parse(backup.exportedAt)),
       String(backup.exportedAt));
    ok('it admits it is not encrypted', /not encrypted/i.test(backup.whatThisIs || ''));
    ok('the counts match what is in it', backup.counts && backup.counts.total === backup.tasks.length,
       JSON.stringify(backup.counts));
    // Asserted separately, because "the archived one is in it" reads as proof
    // of something this test would still have passed without: if archiving had
    // silently not happened, that task would be in the file as a merely
    // completed one and nothing above would have noticed.
    ok('one of them really is archived',
       (backup.tasks || []).some(t => t.title === 'Pay the window cleaner' && !!t.archivedAt),
       JSON.stringify(backup.counts));
    ok('and the count agrees', backup.counts.archived === 1, JSON.stringify(backup.counts));
    ok('with one completed and one still open',
       backup.counts.completed === 1 && backup.counts.open === 1, JSON.stringify(backup.counts));

    // The point of the whole exercise: this file, unlike everything else the
    // app writes, can be read without the password.
    ok('and it is readable without the master password anywhere in sight',
       !/ciphertext/i.test(text) && text.includes('Renew the passport'));

    // And what the app stores is still not readable, which is the other half of
    // the claim. The backup being plain does not make the vault plain.
    const stored = [...rows.values()].map(r => r.ciphertext || '').join(' ');
    ok('while what was sent to the server still is not',
       stored.length > 0 && !/Renew the passport/.test(stored), stored.slice(0, 120));
  }

  ok('and the sheet says what it saved', /Saved · \d+ task/.test(await body()),
     (await body()).slice(0, 400));
}

// ── The route an iPhone actually takes ──
//
// Everything above went through a download, because that is what a headless
// browser on a desktop offers. The phone this app is used on does not: in a
// home-screen web app the share sheet is the reliable way to end up with a file
// in Files, and a plain download historically did nothing there at all — no
// file, no error, no sign anything had been asked for. That path is the one
// that matters most and the one nothing here would otherwise exercise, so it is
// stood up and pressed.
await page.evaluate(() => {
  window.__shared = null;
  const install = (name, value) => {
    try { navigator[name] = value; } catch { /* read-only below */ }
    if (navigator[name] !== value) Object.defineProperty(navigator, name, { value, configurable: true });
  };
  install('canShare', () => true);
  install('share', async ({ files, title }) => {
    const file = files && files[0];
    window.__shared = {
      name: file ? file.name : null,
      type: file ? file.type : null,
      text: file ? await file.text() : null,
      title: title || null,
    };
  });
});

await page.getByText('Export a copy', { exact: true }).click();
await page.waitForTimeout(1500);
const shared = await page.evaluate(() => window.__shared);
ok('it hands the file to the share sheet when there is one', !!shared,
   (await body()).slice(0, 300));
if (shared) {
  ok('as a file, named the same way', /^dayflow-\d{4}-\d{2}-\d{2}\.json$/.test(shared.name || ''),
     String(shared.name));
  ok('with the whole account inside it',
     (shared.text || '').includes('Renew the passport') && (shared.text || '').includes('Pay the window cleaner'),
     String(shared.text || '').slice(0, 160));
  ok('and the sheet still says what it saved', /Saved · \d+ task/.test(await body()),
     (await body()).slice(0, 300));
}

// Dismissing the share sheet is not a failure and must not be reported as one.
await page.evaluate(() => {
  const err = new Error('dismissed');
  err.name = 'AbortError';
  Object.defineProperty(navigator, 'share', {
    value: () => Promise.reject(err), configurable: true,
  });
});
await page.getByText('Export a copy', { exact: true }).click();
await page.waitForTimeout(1200);
ok('cancelling the share sheet says so rather than claiming a failure',
   /Cancelled/.test(await body()) && !/Could not/.test(await body()),
   (await body()).slice(0, 300));

if (process.env.SHOT) {
  // The sheet is currently showing a cancelled share, which is not what a
  // picture of this is taken to show. Put it back and press it once more.
  await page.evaluate(() => {
    delete navigator.share;
    delete navigator.canShare;
  });
  await page.getByText('Export a copy', { exact: true }).click();
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: process.env.SHOT });
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
