// Reordering by tapping, which is the way that works on a phone.
//
// Dragging is fine with a mouse. On a phone it competes with scrolling the
// list, and a finger held still on a row is how text gets selected everywhere
// else — so the same thing is available as buttons.
//
// The arithmetic is unit-tested; what needs a browser is that the gesture is
// wired to it — that the handle picks a row up, that where it is dropped is
// where it lands, and that the new order is still there after a reload rather
// than living only in the component that drew it.
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


for (const title of ['alpha', 'bravo', 'charlie']) {
  const box = A.page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await A.page.waitForTimeout(700);
}

async function order() {
  return A.page.evaluate(() => {
    const rows = [...document.querySelectorAll('*')]
      .filter(el => el.children.length === 0 &&
        ['alpha', 'bravo', 'charlie'].includes((el.innerText || '').trim()))
      .map(el => ({ title: el.innerText.trim(), y: el.getBoundingClientRect().top }));
    return rows.sort((a, b) => a.y - b.y).map(r => r.title).join(',');
  });
}

// Press and hold opens the sheet; a click would open the task instead.
async function hold(title) {
  const row = A.page.locator(`text=${title}`).first();
  const at = await row.boundingBox();
  await A.page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await A.page.mouse.down();
  await A.page.waitForTimeout(700);
  await A.page.mouse.up();
  await A.page.waitForTimeout(600);
}

ok('newest task is at the top', (await order()) === 'charlie,bravo,alpha', await order());

// ── Down ──
await hold('charlie');
ok('the sheet says where the task sits',
   /1 of 3 in this list/.test(await body(A.page)), (await body(A.page)).slice(0, 300));
ok('it cannot be moved up from the top',
   (await A.page.getByLabel('Move up one place').getAttribute('aria-disabled')) === 'true');
ok('nor to the top', (await A.page.getByLabel('Move to the top of the list').getAttribute('aria-disabled')) === 'true');

await A.page.getByLabel('Move down one place').click();
await A.page.waitForTimeout(900);
ok('down moves it one place', (await order()) === 'bravo,charlie,alpha', await order());

// ── Up ──
await hold('alpha');
await A.page.getByLabel('Move up one place').click();
await A.page.waitForTimeout(900);
ok('up moves it one place', (await order()) === 'bravo,alpha,charlie', await order());

// ── Top ──
await hold('charlie');
await A.page.getByLabel('Move to the top of the list').click();
await A.page.waitForTimeout(900);
ok('top sends it all the way up', (await order()) === 'charlie,bravo,alpha', await order());

await hold('charlie');
ok('the bottom move is offered from the top',
   (await A.page.getByLabel('Move down one place').getAttribute('aria-disabled')) !== 'true');
await A.page.keyboard.press('Escape');
await A.page.waitForTimeout(300);

// ── It has to survive a reload, like a drag does ──
await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(1200);
await A.page.locator('input, textarea').nth(0).fill(USER.email);
await A.page.locator('input, textarea').nth(1).fill('a strong master password');
await A.page.getByText('UNLOCK', { exact: false }).first().click();
await A.page.waitForTimeout(3000);
ok('the order survives a reload', (await order()) === 'charlie,bravo,alpha', await order());

// ── And the handle no longer invites a text selection ──
const guarded = await A.page.evaluate(() => {
  const grip = document.querySelector('[data-grip]');
  const row = document.querySelector('[data-taskrow]');
  if (!grip || !row) return null;
  const g = getComputedStyle(grip);
  const r = getComputedStyle(row);
  return {
    touchAction: g.touchAction,
    gripSelect: g.userSelect || g.webkitUserSelect,
    rowSelect: r.userSelect || r.webkitUserSelect,
  };
});
ok('the handle claims its own touches', guarded && guarded.touchAction === 'none', JSON.stringify(guarded));
ok('the handle cannot be selected', guarded && guarded.gripSelect === 'none', JSON.stringify(guarded));
ok('nor can the row it sits in', guarded && guarded.rowSelect === 'none', JSON.stringify(guarded));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
