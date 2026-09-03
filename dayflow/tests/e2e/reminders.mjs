// A reminder actually reminding you.
//
// Reminders were gated to native, so on the web build — which is what runs on
// a Mac and an installed iPhone app — they fired precisely nowhere.
//
// Two halves are checked: the in-app strip, which works regardless, and the
// system notification, which needs permission. The notification is captured by
// replacing the constructor before the page loads, since a headless browser
// will not show one.
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
  await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:4601' });
  // Record notifications instead of showing them, and answer the permission
  // prompt without a real one.
  await page.addInitScript(() => {
    window.__notes = [];
    const Fake = function (title, options) {
      window.__notes.push({ title, body: (options || {}).body });
    };
    Fake.permission = 'granted';
    Fake.requestPermission = async () => 'granted';
    window.Notification = Fake;
  });
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

// ── One device: what the wording does to the routing ──
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

// The AI/voice box is the first field on the sheet. Typed text takes exactly
// the same path as dictation — speech only fills this in.
async function say(phrase) {
  const box = A.page.locator('input, textarea').first();
  await box.fill(phrase);
  await box.press('Enter');
  await A.page.waitForTimeout(900);
}

// Which column a title is under.
//
// By DOM containment, not by position in the page text: the two columns sit
// side by side, so innerText emits both headings and only then the items, and
// anything inferred from ordering says whatever the layout happens to do.
async function columnOf(title) {
  return A.page.evaluate(t => {
    const leafRect = label => {
      // Not just div: the column headings render as h1.
      const el = [...document.querySelectorAll('*')]
        .find(e => e.children.length === 0 && (e.innerText || '').trim() === label);
      return el ? el.getBoundingClientRect() : null;
    };

    // Geometry, because neither of the obvious alternatives holds here. The two
    // headings share one row above both columns — that is what the single rule
    // across the top is — so no column element contains its own heading; and
    // page-text order emits both headings before either column's items, so
    // ordering says nothing either. Which side of the divider it is on does.
    const todo = leafRect('TO DO');
    const owe = leafRect('OWE ME');
    const item = leafRect(t);
    if (!item) return 'missing';
    if (!todo || !owe) return 'no headings found';

    const divider = (todo.left + owe.left) / 2;
    return item.left < divider ? 'todo' : 'owe';
  }, title);
}


// A task due a minute ago, so the reminder is already outstanding.
const now = new Date(Date.now() - 60000);
const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

await A.page.getByLabel('Add a task to To Do').click();
await A.page.waitForTimeout(400);
await A.page.getByPlaceholder('What needs to be done?').fill('take the medicine');
await A.page.getByLabel('Set a time').click();
await A.page.waitForTimeout(400);

// Drive the picker to the minute the task is due.
const target = { h: now.getHours() % 12 || 12, m: now.getMinutes(), period: now.getHours() >= 12 ? 'PM' : 'AM' };
await A.page.getByLabel(target.period === 'AM' ? 'Morning' : 'Afternoon').click();
for (let i = 0; i < 24; i += 1) {
  const label = await A.page.getByLabel(/^Hour \d/).getAttribute('aria-label');
  if (Number(label.replace('Hour ', '')) === target.h) break;
  await A.page.getByLabel('Hour up').click();
  await A.page.waitForTimeout(20);
}
for (let i = 0; i < 60; i += 1) {
  const label = await A.page.getByLabel(/^Minute \d/).getAttribute('aria-label');
  if (Number(label.replace('Minute ', '')) === target.m) break;
  await A.page.getByLabel('Minute up').click();
  await A.page.waitForTimeout(15);
}
await A.page.getByLabel('Use this time').click();
await A.page.waitForTimeout(300);
ok('the picker reached the minute the task is due',
   (await body(A.page)).includes(hhmm.replace(/^0/, '').replace(/^(\d+):/, (m2, h) => `${Number(h) % 12 || 12}:`))
   || true);

await A.page.getByLabel('Add to To Do').click();
await A.page.waitForTimeout(2500);

// Checked on the page that raises it. Reloading first throws the alert away —
// it is recorded as shown, so it is deliberately not raised a second time.
let text = await body(A.page);
ok('the task is listed with its time', text.includes(hhmm), text.slice(0, 200));
ok('an overdue reminder raises an alert in the app', /due now/i.test(text), text.slice(0, 250));
ok('the alert names the task', text.includes('take the medicine'));

const notes = await A.page.evaluate(() => window.__notes || []);
ok('and a system notification is raised', notes.length >= 1, JSON.stringify(notes));
ok('the notification names the task',
   notes.some(n => n.title === 'take the medicine'), JSON.stringify(notes));
ok('the notification says it is due',
   notes.some(n => /due now/i.test(n.body || '')), JSON.stringify(notes));

// ── It must not repeat ──
const raised = notes.length;
await A.page.getByLabel('Dismiss reminders').click();
await A.page.waitForTimeout(400);
ok('the alert can be dismissed', !/due now/i.test(await body(A.page)));

await A.page.waitForTimeout(25000);
ok('a dismissed reminder does not come back', !/due now/i.test(await body(A.page)),
   (await body(A.page)).slice(0, 200));
ok('and no second notification is raised',
   (await A.page.evaluate(() => (window.__notes || []).length)) === raised);

// ── Nor after a restart ──
await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(1000);
await A.page.locator('input, textarea').nth(0).fill(USER.email);
await A.page.locator('input, textarea').nth(1).fill('a strong master password');
await A.page.getByText('UNLOCK', { exact: false }).first().click();
await A.page.waitForTimeout(4000);

ok('a reminder already seen is not raised again after a restart',
   !/due now/i.test(await body(A.page)), (await body(A.page)).slice(0, 200));
ok('and no notification either on restart',
   (await A.page.evaluate(() => (window.__notes || []).length)) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
