// The add sheet: committing a task, and the two lists taking distinct ones.
//
// The sheet had no Add button — the only way to commit was pressing Enter in
// the title, which is invisible and stops working the moment focus moves. And
// it announced itself as "New Task" from either column, so nothing on screen
// said which list was about to receive it.
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


// ── To Do ──
await A.page.getByLabel('Add a task to To Do').click();
await A.page.waitForTimeout(500);

let text = await body(A.page);
ok('the sheet says which list it is for', text.includes('New To Do'), text.slice(0, 120));
ok('the sheet does not call both lists the same thing', !text.includes('New Task'));

const addTodo = A.page.getByLabel('Add to To Do');
ok('there is an Add button', (await addTodo.count()) === 1);
ok('Add is disabled until there is a title',
   (await addTodo.getAttribute('aria-disabled')) === 'true');

await A.page.getByPlaceholder('What needs to be done?').fill('cancel the gym membership');
await A.page.waitForTimeout(300);
ok('Add becomes available once a title is typed',
   (await addTodo.getAttribute('aria-disabled')) !== 'true');

await addTodo.click();
await A.page.waitForTimeout(900);
ok('the sheet closes on Add', !(await body(A.page)).includes('New To Do'));
ok('a To Do task lands in To Do', (await columnOf('cancel the gym membership')) === 'todo',
   await columnOf('cancel the gym membership'));

// ── Owe Me ──
await A.page.getByLabel('Add something you are waiting on to Owe Me').click();
await A.page.waitForTimeout(500);

text = await body(A.page);
ok('the Owe Me sheet is labelled as its own thing', text.includes('New Owe Me'));
ok('the Owe Me sheet asks what is being waited on',
   (await A.page.getByPlaceholder('What are you waiting on?').count()) === 1);
ok('the Owe Me sheet asks who owes it',
   (await A.page.getByPlaceholder('Who owes you this?').count()) === 1);

await A.page.getByPlaceholder('What are you waiting on?').fill('the signed lease');
await A.page.getByPlaceholder('Who owes you this?').fill('Priya');
await A.page.getByLabel('Add to Owe Me').click();
await A.page.waitForTimeout(900);

ok('an Owe Me task lands in Owe Me', (await columnOf('the signed lease')) === 'owe',
   await columnOf('the signed lease'));
ok('the person is kept', (await columnOf('Priya')) === 'owe', await columnOf('Priya'));

// The two lists stay separate.
ok('the To Do task did not move', (await columnOf('cancel the gym membership')) === 'todo');
ok('nothing was marked done by adding it', !(await body(A.page)).includes('1 of 2 done'));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
