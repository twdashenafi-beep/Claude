// What the app does when the device stops accepting writes.
//
// A browser refuses a localStorage write once the origin's quota is spent —
// around seven thousand tasks here, and immediately in a private window. That
// failure used to be caught and dropped on the floor, so the app went on
// looking like it was saving while nothing reached the disk, and the next
// reload lost everything since.
//
// Storage is stubbed to refuse rather than filled for real: writing five
// megabytes through the UI would take longer than the rest of the suite put
// together, and what is under test is the response to the refusal.
//
// Needs a build and a browser:
//   npm i -D playwright && npx playwright install chromium
//   npm run build:pages
//   npm run test:e2e
//
// Realtime is not stubbed. The WebSocket simply fails, which is deliberate:
// it exercises the polling fallback, the path a project without Realtime
// enabled will actually take.
// Imported dynamically so a missing browser driver is a sentence rather than a
// stack trace — this is the one test with a dependency outside the repo.
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
await new Promise(r => server.listen(4713, r));

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
let pushes = 0;
const hits = [];

async function route(r) {
  const req = r.request();
  const url = new URL(req.url());
  const p = url.pathname;
  hits.push(`${req.method()} ${p}`);
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
    pushes += 1;
    for (const row of JSON.parse(req.postData() || '[]')) rows.set(row.id, row);
    return json([], 201);
  }
  return json({});
}

// PLAYWRIGHT_CHROMIUM lets a sandbox point at a browser it already has.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };

async function device(name) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${name}] page error: ${e}`));
  page.on('console', m => { if (/sync|Sync|fail/i.test(m.text())) console.log(`  [${name}] ${m.text()}`); });
  await page.route(u => u.hostname === 'stubproject.supabase.co', route);
  await page.goto('http://localhost:4713/Claude/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const inputs = page.locator('input, textarea');
  await inputs.nth(0).fill(PROJECT);
  await inputs.nth(1).fill(KEY);
  await page.getByText('Connect', { exact: true }).click();
  await page.waitForTimeout(1200);
  return { ctx, page };
}


const A = await device('A');
await A.page.getByText('Create an account').click();
await A.page.waitForTimeout(300);
let inputs = A.page.locator('input, textarea');
await inputs.nth(0).fill(USER.email);
await inputs.nth(1).fill('a strong master password');
await inputs.nth(2).fill('a strong master password');
await A.page.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await A.page.waitForTimeout(2500);
const ack = A.page.locator('text=/written|saved|wrote|understand|acknowledge/i').first();
if (await ack.count()) await ack.click();
const cont = A.page.locator('text=/continue|done|open/i').first();
if (await cont.count()) await cont.click();
await A.page.waitForTimeout(1500);

const body = () => A.page.evaluate(() => document.body.innerText);
async function add(title) {
  const box = A.page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await A.page.waitForTimeout(800);
}

await add('Before the disk fills');
ok('nothing is said while saving works', !/out of storage|failed/i.test(await body()),
   (await body()).slice(0, 240));

// From here the vault write is refused, exactly as a full origin refuses it.
await A.page.evaluate(() => {
  const real = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (String(key).includes('dayflow_vault')) {
      const err = new Error("Failed to execute 'setItem' on 'Storage': the quota has been exceeded.");
      err.name = 'QuotaExceededError';
      throw err;
    }
    return real.call(this, key, value);
  };
});

await add('After the disk fills');
await A.page.waitForTimeout(1200);
let text = await body();
console.log('AFTER QUOTA:', JSON.stringify(text.replace(/\n+/g, ' | ').slice(0, 400)));

ok('the app says the device is out of storage', /out of storage/i.test(text), text.slice(0, 300));
ok('and says it plainly, not as a sync problem', !/sync failed/i.test(text));
ok('and says what to do about it', /archive|other devices/i.test(text), text.slice(0, 300));

// The warning has to be an alert, or a screen reader passes straight over the
// one message that matters.
ok('it is announced rather than just drawn',
   (await A.page.locator('[role="alert"]').count()) > 0);

// The app keeps working — the task is on the page, it is only the disk that
// refused. Losing the session as well would make a bad situation worse.
ok('the task is still added to the page', text.includes('After the disk fills'));
ok('and the earlier one is still there', text.includes('Before the disk fills'));

// And it goes away by itself once writing works again, rather than needing a
// reload to clear a warning that is no longer true.
await A.page.evaluate(() => { delete Storage.prototype.setItem; });
await add('Once there is room again');
await A.page.waitForTimeout(1500);
text = await body();
ok('the warning clears when saving works again', !/out of storage/i.test(text),
   text.slice(0, 300));
ok('and the task went in', text.includes('Once there is room again'));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
