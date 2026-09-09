// What a row says about when a task is due.
//
// The list used to show the bare time, so a task due this evening, one due
// tomorrow morning and one that was due a fortnight ago all read the same. What
// has to be proved is the one thing that was missing — that late looks like
// late — and, just as importantly, that an ordinary task with no date anyone
// chose still says nothing at all. Marking half the list overdue would be
// worse than the silence it replaced.
//
// The overdue case is made by walking the calendar back a month rather than by
// leaning on the clock, so it reads the same at nine in the morning and at
// midnight.
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
await new Promise(r => server.listen(4805, r));

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
  await page.goto('http://localhost:4805/Claude/', { waitUntil: 'networkidle' });
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

const page = async () => A.page.evaluate(() => {
  const notices = [...document.querySelectorAll('[data-notice]')].map(el => el.innerText);
  return notices.reduce((t, n) => t.split(n).join(''), document.body.innerText);
});
async function add(title) {
  const box = A.page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await A.page.waitForTimeout(800);
}

// ── A task nobody dated says nothing ──
await add('Pick up the prescription');
let text = await page();
ok('an undated task carries no date', !/Overdue|Tomorrow/.test(text), text.slice(0, 300));
ok('and it is on the page', text.includes('Pick up the prescription'));

// ── Tomorrow says tomorrow ──
await add('Book the MOT tomorrow');
text = await page();
ok('a task for tomorrow says so', /Tomorrow/.test(text), text.slice(0, 300));
ok('and is not called late', !/Overdue/.test(text), text.slice(0, 300));

// ── Late looks like late ──
//
// Walked back a month through the calendar, so the result does not depend on
// what time of day the suite is run.
await A.page.getByLabel('Add a task to To Do').click();
await A.page.waitForTimeout(400);
await A.page.getByPlaceholder('What needs to be done?').fill('Send the meter reading');
const dateToggle = A.page.getByText(/^(Date|Due date|Add a date)/i).first();
if (await dateToggle.count()) { await dateToggle.click(); await A.page.waitForTimeout(400); }
await A.page.getByLabel('Previous month').click();
await A.page.waitForTimeout(400);
// The 15th of last month, which is behind today whatever today is.
const fifteenth = A.page.getByLabel(/^\w+day 15 \w+ \d{4}$/).first();
if (await fifteenth.count()) await fifteenth.click();
else await A.page.getByText('15', { exact: true }).first().click();
await A.page.waitForTimeout(400);
await A.page.getByLabel('Add to To Do').click();
await A.page.waitForTimeout(1000);

text = await page();
console.log('WITH A PAST DATE:', JSON.stringify(text.replace(/\n+/g, ' | ').slice(0, 400)));
ok('a task whose date has gone says Overdue', /Overdue/.test(text), text.slice(0, 400));
ok('and the task itself is still listed', text.includes('Send the meter reading'));

// It has to be findable by colour, which means it must be its own element
// rather than a word inside the rest of the line.
const styled = await A.page.evaluate(() => {
  const el = [...document.querySelectorAll('*')]
    .find(e => e.children.length === 0 && (e.innerText || '').trim() === 'Overdue');
  if (!el) return null;
  const c = getComputedStyle(el);
  return { colour: c.color, weight: c.fontWeight };
});
ok('Overdue is drawn as its own element', styled !== null);
ok('and in the red pen rather than the ordinary grey',
   styled && styled.colour !== 'rgb(87, 83, 75)', JSON.stringify(styled));

// ── Finishing it stops it being late ──
await A.page.getByLabel('Mark Send the meter reading as done').click();
await A.page.waitForTimeout(800);
text = await page();
ok('a finished task is no longer called overdue', !/Overdue/.test(text), text.slice(0, 400));

// ── And a screen reader is told the same thing ──
await A.page.getByLabel(/^Show \d+ completed/).first().click();
await A.page.waitForTimeout(400);
await A.page.getByLabel('Mark Send the meter reading as not done').click();
await A.page.waitForTimeout(800);
const spoken = await A.page.evaluate(() => {
  const el = [...document.querySelectorAll('[aria-label]')]
    .find(e => (e.getAttribute('aria-label') || '').startsWith('Send the meter reading'));
  return el ? el.getAttribute('aria-label') : null;
});
ok('the row announces that it is overdue', /overdue/i.test(spoken || ''), String(spoken));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
