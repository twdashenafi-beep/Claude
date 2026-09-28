// Which drawer the app keeps things in, and how what was in the old one gets
// to the new one.
//
// On the web this used to be localStorage, which is about five megabytes and
// which Safari charges two bytes a character against. That was room enough
// while a task cost seven hundred bytes and stopped being room enough the day a
// voice note could be attached: sixteen recordings filled it at two hundred and
// ninety tasks. What the failure looked like was a note that was there and then
// was not — memory does not care about quotas, so the list kept showing a
// recording that the next launch had never heard of.
//
// So there are three things to prove here. That nothing of ours is left in the
// old drawer. That whatever was already in it arrives in the new one and is
// still believed. And that the new one holds what the old one could not, which
// is the entire point of moving.
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
await new Promise(r => server.listen(4853, r));

// ── the fake project ──
const PROJECT = 'https://stubproject.supabase.co';
const KEY = 'sb_publishable_stubkeyabcdefghijkl';
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

// What is in each drawer, read straight rather than through the app.
const drawers = () => page.evaluate(async () => {
  const ls = Object.keys(localStorage);
  let idb = [];
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dayflow', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    idb = await new Promise((resolve, reject) => {
      const request = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
      request.onsuccess = () => resolve(request.result.map(String));
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    idb = [`could not open: ${e.message}`];
  }
  return { ls, idb };
});

const ours = list => list.filter(k => k.startsWith('@dayflow') || k.startsWith('sb-'));

// ── Something already in the old drawer, put there the way the old app did ──
//
// Written before the app has ever run here, so what follows is a device coming
// to this version with a drawer that is already full of the last one's things.
await page.goto('http://localhost:4853/Claude/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.evaluate(([url, anonKey]) => {
  localStorage.setItem('@dayflow_sync_config', JSON.stringify({ url, anonKey }));
  localStorage.setItem('@dayflow_alerts_shown', JSON.stringify(['an-old-alert']));
}, [PROJECT, KEY]);

const before = await drawers();
ok('the old drawer is holding something to begin with',
   ours(before.ls).length === 2, JSON.stringify(before.ls));

// ── The move happens on the next launch ──
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const after = await drawers();
ok('and afterwards the old drawer is empty of ours',
   ours(after.ls).length === 0, JSON.stringify(after.ls));
ok('the settings arrived in the new one',
   after.idb.includes('@dayflow_sync_config'), JSON.stringify(after.idb));
ok('and so did everything else that was there',
   after.idb.includes('@dayflow_alerts_shown'), JSON.stringify(after.idb));

// Moved is not the same as believed. The app asks for a project on a device it
// has never been told about, and asks for a password on one it has — so the
// screen says whether the settings that came across were actually read.
ok('and the app is using them rather than asking again',
   (await body()).includes('Welcome back'), (await body()).slice(0, 200));

// ── Ordinary use writes to the new drawer and not the old one ──
await page.getByText('Create an account').click();
await page.waitForTimeout(300);
let inputs = page.locator('input, textarea');
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

const box = page.locator('input, textarea').first();
await box.fill('Order the slate');
await box.press('Enter');
await page.waitForTimeout(1500);

const working = await drawers();
ok('the tasks are written to the new drawer',
   working.idb.includes('@dayflow_vault_v2'), JSON.stringify(working.idb));
ok('and nothing of ours has gone back to the old one',
   ours(working.ls).length === 0, JSON.stringify(working.ls));
ok('the session travels with them, so signing in is not asked for twice',
   working.idb.some(k => k.startsWith('sb-')), JSON.stringify(working.idb));

// ── And it survives a reload, which is the only thing storage is for ──
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
await page.waitForTimeout(3500);
ok('the task is still there after a reload', (await body()).includes('Order the slate'),
   (await body()).slice(0, 200));

// ── The new drawer holds what the old one could not ──
//
// Six megabytes, which is past what any browser allows in localStorage and
// nothing at all to IndexedDB. This is the move's whole reason: sixteen
// recordings is 2.7 MB, and that was enough to fill the old one.
const capacity = await page.evaluate(async () => {
  const big = 'x'.repeat(6 * 1024 * 1024);

  let oldDrawer = 'accepted it';
  try {
    localStorage.setItem('@dayflow_probe', big);
    localStorage.removeItem('@dayflow_probe');
  } catch (e) {
    oldDrawer = e.name || 'refused it';
  }

  let newDrawer = 'accepted it';
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dayflow', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(big, '@dayflow_probe');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete('@dayflow_probe');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    newDrawer = e.name || `refused it: ${e.message}`;
  }

  return { oldDrawer, newDrawer };
});

ok('six megabytes is more than the old drawer would take',
   capacity.oldDrawer !== 'accepted it', JSON.stringify(capacity));
ok('and nothing to the new one',
   capacity.newDrawer === 'accepted it', JSON.stringify(capacity));

// And the vault is untouched by all that.
ok('the tasks are still readable afterwards', (await body()).includes('Order the slate'));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
