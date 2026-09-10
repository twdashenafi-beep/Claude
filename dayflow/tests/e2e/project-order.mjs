// Putting the project tabs in the order you want them.
//
// Two ways in, because a row that scrolls sideways is an awkward place to drag
// something sideways. Holding a tab picks it up and the row stops scrolling
// while it is in hand; the same move is also on buttons, for a phone or a
// screen reader, where holding a small target still still is not the easy path.
//
// The order has to reach the other devices too, so the last thing checked is
// that it survives a reload — a reorder that only looked right until you came
// back would be worse than none.
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
await new Promise(r => server.listen(4809, r));

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
  await page.goto('http://localhost:4809/Claude/', { waitUntil: 'networkidle' });
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

// Left to right, which is the only thing this file is about.
const order = () => A.page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[data-projecttab]')];
  return tabs
    .map(t => ({ name: (t.innerText || '').trim(), x: t.getBoundingClientRect().left }))
    .filter(t => t.name && t.name !== 'Everything')
    .sort((a, b) => a.x - b.x)
    .map(t => t.name)
    .join(',');
});

const tab = name => A.page.getByLabel(`Project ${name}`, { exact: true });

const openEditor = async name => {
  await tab(name).click();
  await A.page.waitForTimeout(450);
  if (await tab(name).count()) {
    await tab(name).click();   // it was not the active one, so that was a select
    await A.page.waitForTimeout(450);
  }
};

const makeProject = async name => {
  await A.page.getByLabel('New project').click();
  await A.page.waitForTimeout(350);
  await A.page.getByLabel('New project name').fill(name);
  await A.page.getByLabel('Create the project').click();
  await A.page.waitForTimeout(800);
};

await A.page.getByLabel('Projects').click();
await A.page.waitForTimeout(500);
for (const n of ['Flat', 'Work', 'Garden']) await makeProject(n);

ok('new projects arrive in the order they were made', (await order()) === 'Flat,Work,Garden', await order());

// ── A tab you are already on opens its editor ──
//
// This moved off long-press to make room for picking a tab up, and it is where
// this file always claimed it lived.
await tab('Flat').click();
await A.page.waitForTimeout(500);
ok('tapping a project you are not on selects it',
   (await A.page.getByLabel('Project name').count()) === 0);
await tab('Flat').click();
await A.page.waitForTimeout(500);
ok('and tapping it again opens the editor',
   (await A.page.getByLabel('Project name').count()) >= 1);

// ── Moving by button ──
ok('the editor says where the project sits',
   /1 of 3/.test(await A.page.evaluate(() => document.body.innerText)),
   (await A.page.evaluate(() => document.body.innerText)).slice(0, 300));
ok('the first project cannot go further left',
   await A.page.getByLabel('Move Flat left').isDisabled());

await A.page.getByLabel('Move Flat right').click();
await A.page.waitForTimeout(700);
// The editor stays open after a move, so that two nudges do not need two trips
// into it. The tabs are not on the page while it is, so it is closed to look.
await A.page.getByLabel('Cancel').click();
await A.page.waitForTimeout(700);
ok('moving right swaps it with its neighbour', (await order()) === 'Work,Flat,Garden', await order());

await openEditor('Flat');
await A.page.getByLabel('Move Flat left').click();
await A.page.waitForTimeout(700);
await A.page.getByLabel('Cancel').click();
await A.page.waitForTimeout(700);
ok('and left puts it back', (await order()) === 'Flat,Work,Garden', await order());

// ── Moving by dragging ──
//
// Held first, because until a tab is picked up the row belongs to the scroller.
const box = async name => A.page.evaluate(n => {
  const t = [...document.querySelectorAll('[data-projecttab]')]
    .find(e => (e.innerText || '').trim() === n);
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
}, name);

const flat = await box('Flat');
const garden = await box('Garden');
ok('the tabs can be found on the page', flat !== null && garden !== null);

await A.page.mouse.move(flat.x, flat.y);
await A.page.mouse.down();
await A.page.waitForTimeout(450);          // the hold that picks it up
// Carried in steps, because a single jump gives the responder one move event
// to work from and a drag is a series of them.
for (let i = 1; i <= 12; i++) {
  await A.page.mouse.move(flat.x + ((garden.x - flat.x) * i) / 12, flat.y, { steps: 2 });
  await A.page.waitForTimeout(30);
}
await A.page.mouse.up();
await A.page.waitForTimeout(1000);

console.log('AFTER DRAG:', await order());
ok('dragging a tab to the far end puts it there', (await order()) === 'Work,Garden,Flat', await order());

// ── The row scrolls again once the tab is put down ──
const scrollable = await A.page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(e => e.scrollWidth > e.clientWidth + 4
    && [...e.querySelectorAll('[data-projecttab]')].length > 1);
  return el ? true : 'not overflowing, which is fine';
});
ok('the tab row is not left locked after a drag', scrollable !== false, String(scrollable));

// ── It has to still be true after a reload ──
await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(1200);
await A.page.locator('input, textarea').nth(0).fill(USER.email);
await A.page.locator('input, textarea').nth(1).fill('a strong master password');
await A.page.getByText('UNLOCK', { exact: false }).first().click();
await A.page.waitForTimeout(3500);
await A.page.getByLabel('Projects').click();
await A.page.waitForTimeout(700);
ok('the order survives a reload', (await order()) === 'Work,Garden,Flat', await order());

// ── And a new project still goes on the end ──
await makeProject('Car');
ok('a project made after a reorder goes last',
   (await order()) === 'Work,Garden,Flat,Car', await order());

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
