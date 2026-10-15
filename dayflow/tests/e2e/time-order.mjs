// The clock decides the order, not the order things were typed in.
//
// "Call Bob at 11am" went in first and sat at the top, because the list put the
// newest task there. "Call John at 9am" went in second and landed above it, for
// the same reason and with nothing to do with the day: one arrangement was
// right by accident, the other wrong by the same accident. A list that has to
// be dragged into the order the clock already decided is doing work it could
// have had for nothing.
//
// The sort is unit-tested. What needs a browser is the whole path: that typing
// "at 9am" into the box really does attach a time, that the column draws the
// rows in that order, that it survives a reload rather than living in the
// component that drew it — and that the three move buttons, which can no longer
// achieve anything for a task with a time, say so instead of sitting there dead.
//
// Needs a build and a browser:
//   npm i -D playwright && npx playwright install chromium
//   npm run build:pages
//   npm run test:e2e
//
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

// Press and hold opens the sheet; a click would open the task instead.
async function hold(title) {
  const row = A.page.locator(`text=${title}`).first();
  await row.click();
  await A.page.waitForTimeout(900);
}

// The sheet has to be shut again between looks.
async function escape() {
  const cancel = A.page.getByText('Cancel', { exact: true }).last();
  if (await cancel.count()) { await cancel.click(); await A.page.waitForTimeout(600); }
}

// ── The two calls, typed so that the old rule gets it wrong ───────────────
//
// The order matters, and getting it the other way round made this assertion
// worthless for a while. Typed Bob-then-John, the newest-first rule puts John
// on top — which is also where the clock puts him, so the test passed with the
// clock taken out entirely.
//
// So: John first, Bob second. Newest-first would now put Bob on top, 11am
// above 9am, and only a sort that reads the clock pulls John back above him.
await say('Call John at 9am');
await say('Call Bob at 11am');

const NAMES = ['Call Bob', 'Call John', 'Call Sue'];
async function order() {
  return A.page.evaluate(names => {
    const rows = [...document.querySelectorAll('*')]
      .filter(el => el.children.length === 0
        && names.some(n => (el.innerText || '').trim().startsWith(n)))
      .map(el => ({ title: el.innerText.trim().split('\n')[0], y: el.getBoundingClientRect().top }));
    return rows.sort((a, b) => a.y - b.y).map(r => r.title).join(',');
  }, NAMES);
}

ok('both calls are in the list', (await order()).split(',').length === 2, await order());
ok('nine in the morning is above eleven, though eleven was typed last',
   (await order()) === 'Call John,Call Bob', await order());

// ── A third, dropped into the middle of the day ───────────────────────────
//
// Newest, so the old rule would put it top. Its time says the middle, which is
// a place no insertion rule can reach.
await say('Call Sue at 10am');
ok('the newest task takes its place by the clock, not at the top',
   (await order()) === 'Call John,Call Sue,Call Bob', await order());

// ── It is the order on the page, not a trick of when it was drawn ──────────
await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(2500);
const unlock = A.page.locator('input, textarea');
if (await A.page.getByText('UNLOCK', { exact: false }).count()) {
  await unlock.nth(1).fill('a strong master password');
  await A.page.getByText('UNLOCK', { exact: false }).first().click();
  await A.page.waitForTimeout(3000);
}
ok('and the order is the same after a reload',
   (await order()) === 'Call John,Call Sue,Call Bob', await order());

// ── The move buttons, which can no longer move it ─────────────────────────
//
// Three dead controls with no explanation read as a fault. The sheet says why.
await hold('Call Sue');
ok('the sheet is open on a task the clock is holding, and says so',
   (await A.page.locator('[data-bytime]').count()) === 1,
   String(await A.page.locator('[data-bytime]').count()));
for (const [label, what] of [
  ['Move to the top of the list', 'to the top'],
  ['Move up one place', 'up'],
  ['Move down one place', 'down'],
]) {
  ok(`${what} is off, rather than doing nothing`,
     (await A.page.getByLabel(label).getAttribute('aria-disabled')) === 'true',
     await A.page.getByLabel(label).getAttribute('aria-disabled'));
}
await escape();

// ── Clearing the time hands the task back to you ──────────────────────────
//
// The counter-case, and the one that proves the rule is about times rather
// than about these three particular tasks. A task with no time is placed by
// hand again, and the buttons have to come back to life to say so.
await hold('Call Sue');
// The chip opens the picker rather than clearing — its label has promised
// "change or clear" since the day clearing moved inside, where changing a time
// does not mean starting from nothing. So: chip, then Clear.
const timeChip = A.page.locator('[aria-label*="clear the time"]').first();
ok('the task still carries a time to clear', (await timeChip.count()) === 1,
   String(await timeChip.count()));
await timeChip.click();
await A.page.waitForTimeout(600);
await A.page.getByLabel('Remove the time').click();
await A.page.waitForTimeout(600);
ok('clearing the time brings the buttons back without waiting for a save',
   (await A.page.locator('[data-bytime]').count()) === 0
   && (await A.page.getByLabel('Move to the top of the list').getAttribute('aria-disabled')) !== 'true',
   `note ${await A.page.locator('[data-bytime]').count()}, top ${await A.page.getByLabel('Move to the top of the list').getAttribute('aria-disabled')}`);

const save = A.page.getByText('Save', { exact: false }).last();
if (await save.count()) { await save.click(); await A.page.waitForTimeout(900); }

ok('and a task with no time is no longer held in the day',
   (await order()).startsWith('Call John,Call Bob'), await order());

await A.ctx.close();
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
