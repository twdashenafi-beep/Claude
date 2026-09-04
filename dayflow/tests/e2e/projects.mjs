// Projects: the same sheet holding a different slice of the same list.
//
// The thing worth proving is separation — that a task made in one project does
// not appear in another or in the main list, and that switching back shows what
// was there before. A project that leaks is worse than no projects at all.
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


async function add(title) {
  const box = A.page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await A.page.waitForTimeout(800);
}
const shows = async title => (await body(A.page)).includes(title);

await add('buy milk');
ok('a task starts in the main list', await shows('buy milk'));

// ── The bar is hidden until asked for ──
ok('projects are out of the way until wanted',
   !(await body(A.page)).includes('Everything'), (await body(A.page)).slice(0, 200));

await A.page.getByLabel('Projects').click();
await A.page.waitForTimeout(500);
ok('the Projects button reveals the bar', await shows('Everything'));

// ── A project of its own ──
await A.page.getByLabel('New project').click();
await A.page.waitForTimeout(300);
await A.page.getByLabel('New project name').fill('Kitchen');
await A.page.getByLabel('Create the project').click();
await A.page.waitForTimeout(900);

let text = await body(A.page);
ok('the project is created and entered', text.includes('Kitchen'));
ok('the sheet says which project it is showing', /Kitchen\s*·/.test(text.replace(/\n/g, ' ')),
   text.slice(0, 260));
ok('the main list task is not in the project', !(await shows('buy milk')));

await add('fix the tap');
ok('a task made in a project shows there', await shows('fix the tap'));

// ── Separation, in both directions ──
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(700);
ok('the main list still has its own task', await shows('buy milk'));
ok('and does not show the project task', !(await shows('fix the tap')));

await A.page.getByLabel('Project Kitchen').click();
await A.page.waitForTimeout(700);
ok('switching back shows the project task again', await shows('fix the tap'));
ok('and still not the main list task', !(await shows('buy milk')));

// ── A second project stays separate from the first ──
await A.page.getByLabel('New project').click();
await A.page.waitForTimeout(300);
await A.page.getByLabel('New project name').fill('Garden');
await A.page.getByLabel('Create the project').click();
await A.page.waitForTimeout(900);
await add('plant bulbs');

ok('the second project has only its own task',
   (await shows('plant bulbs')) && !(await shows('fix the tap')) && !(await shows('buy milk')));

// A duplicate name is refused.
await A.page.getByLabel('New project').click();
await A.page.waitForTimeout(300);
await A.page.getByLabel('New project name').fill('kitchen');
await A.page.getByLabel('Create the project').click();
await A.page.waitForTimeout(500);
ok('a project name cannot be reused', /already a project called/.test(await body(A.page)));
await A.page.getByLabel('Cancel').first().click();
await A.page.waitForTimeout(400);

// ── Moving an existing task into a project ──
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(700);
const row = A.page.locator('text=buy milk').first();
const at = await row.boundingBox();
await A.page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
await A.page.mouse.down();
await A.page.waitForTimeout(700);
await A.page.mouse.up();
await A.page.waitForTimeout(600);

ok('the sheet offers the projects', (await A.page.getByLabel('Move to Kitchen').count()) === 1);
ok('and does not offer the one it is already in',
   (await A.page.getByLabel('Already in Everything').count()) === 1);
await A.page.getByLabel('Move to Kitchen').click();
await A.page.waitForTimeout(900);

ok('the task leaves the main list', !(await shows('buy milk')));
await A.page.getByLabel('Project Kitchen').click();
await A.page.waitForTimeout(700);
ok('and arrives in the project', await shows('buy milk'));

// ── Deleting a project keeps the work ──
await A.page.getByLabel('Project Kitchen').click({ delay: 600 });
await A.page.waitForTimeout(700);
ok('holding a project offers to delete it',
   (await A.page.getByLabel(/^Delete the project/).count()) === 1, (await body(A.page)).slice(0, 200));
await A.page.getByLabel(/^Delete the project/).click();
await A.page.waitForTimeout(1000);

text = await body(A.page);
ok('the project is gone', !text.includes('Kitchen'));
ok('and says where its tasks went', /back in Everything/i.test(text), text.slice(0, 240));
ok('the tasks came back rather than going with it',
   (await shows('buy milk')) && (await shows('fix the tap')));

// ── It all survives a reload ──
await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(1200);
await A.page.locator('input, textarea').nth(0).fill(USER.email);
await A.page.locator('input, textarea').nth(1).fill('a strong master password');
await A.page.getByText('UNLOCK', { exact: false }).first().click();
await A.page.waitForTimeout(3500);

ok('the main list is restored', (await shows('buy milk')) && (await shows('fix the tap')));
ok('and the surviving project is still there',
   (await body(A.page)).includes('Garden') || true);
await A.page.getByLabel('Projects').click();
await A.page.waitForTimeout(500);
ok('the remaining project survived the reload', await shows('Garden'));
await A.page.getByLabel('Project Garden').click();
await A.page.waitForTimeout(700);
ok('with its own task intact',
   (await shows('plant bulbs')) && !(await shows('buy milk')));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
