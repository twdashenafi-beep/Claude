// Deleting a task without completing it, and taking it back.
//
// The delete has to be visible — it was reachable only by swiping or holding,
// which a mouse never finds — and reversible, since it asks nothing first.
//
// The undo also has to survive a sync: the server still holds the tombstone
// after a delete, so a restored task that is not pushed back with a newer
// stamp is simply deleted again on the next pull.
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
await new Promise(r => server.listen(4601, r));

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
let writes = 0;
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
    writes += 1;
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
  await page.goto('http://localhost:4601/Claude/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const inputs = page.locator('input, textarea');
  await inputs.nth(0).fill(PROJECT);
  await inputs.nth(1).fill(KEY);
  await page.getByText('Connect', { exact: true }).click();
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const body = page => page.evaluate(() => document.body.innerText);

// ── One device: delete, undo, and make it stick ──
const A = await device('A');
await A.page.getByText('Create an account').click();
await A.page.waitForTimeout(300);
let inputs = A.page.locator('input, textarea');
await inputs.nth(0).fill(USER.email);
await inputs.nth(1).fill('a strong master password');
await inputs.nth(2).fill('a strong master password');
await A.page.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await A.page.waitForTimeout(2500);
for (const sel of ['text=/written|saved|wrote|understand|acknowledge/i', 'text=/continue|done|open/i']) {
  const l = A.page.locator(sel).first();
  if (await l.count()) await l.click();
}
await A.page.waitForTimeout(1500);

async function add(phrase) {
  const box = A.page.locator('input, textarea').first();
  await box.fill(phrase);
  await box.press('Enter');
  await A.page.waitForTimeout(900);
}

await add('cancel the gym membership');
await add('renew the passport');
ok('both tasks are listed', (await body(A.page)).includes('cancel the gym membership'));

// ── The control is on the row, not behind a gesture ──
const remove = A.page.getByLabel('Delete cancel the gym membership');
ok('every row carries a delete control', (await remove.count()) === 1, String(await remove.count()));

await remove.click();
await A.page.waitForTimeout(600);
let text = await body(A.page);
// By the row being gone, not by the title being absent from the page: the undo
// bar names what it deleted, so the words are still on screen.
ok('the task goes without a confirmation step',
   (await A.page.getByLabel('Delete cancel the gym membership').count()) === 0);
ok('the undo bar names what went', text.includes('cancel the gym membership'));
ok('the other task is untouched', text.includes('renew the passport'));
ok('deleting is not the same as completing', !text.includes('1 of 2 done'), text.slice(0, 90));
ok('an undo is offered', /UNDO/.test(text));

// ── Undo brings it back ──
await A.page.getByText('UNDO', { exact: true }).click();
await A.page.waitForTimeout(1000);
text = await body(A.page);
ok('undo restores the task', text.includes('cancel the gym membership'));
ok('the undo bar goes away once used', !/UNDO/.test(text));

// The tombstone is still on the server; a sync must not undo the undo.
await A.page.waitForTimeout(3000);
ok('the restored task survives a sync', (await body(A.page)).includes('cancel the gym membership'));
ok('the server no longer holds it as deleted',
   [...rows.values()].filter(r => r.deleted).length === 0,
   JSON.stringify([...rows.values()].map(r => r.deleted)));

// ── And the undo bar times out on its own ──
await A.page.getByLabel('Delete renew the passport').click();
await A.page.waitForTimeout(600);
ok('a second delete offers undo again', /UNDO/.test(await body(A.page)));
await A.page.waitForTimeout(7500);
ok('the undo bar clears itself', !/UNDO/.test(await body(A.page)));
ok('the task stays deleted once the window passes',
   !(await body(A.page)).includes('renew the passport'));

// ── The traffic has to stop ──
//
// Every sync used to re-send every tombstone. The write raised a change event,
// the event asked for another sync, and that sync wrote again — so one delete
// left the app syncing for good. Arriving data was never the problem; the
// absence of a resting state was.
// The window has to outlast the polling interval, or a loop driven by polling
// simply does not get a turn inside it and the check passes for the wrong
// reason. Realtime is not connected here, so polling is the driver.
await A.page.waitForTimeout(4000);
const settled = writes;
await A.page.waitForTimeout(45000);
ok('writes stop once a delete has been recorded', writes === settled,
   `${settled} -> ${writes} over 45s`);
ok('the app is not left saying it is syncing', !/syncing/i.test(await body(A.page)),
   (await body(A.page)).slice(0, 120));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
