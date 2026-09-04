// The archive: what happens to work you have finished with.
//
// One button now means two things — remove something unfinished, keep
// something finished — so what has to be proved is that it picks the right one
// every time, and says which it picked. Archiving something you meant to delete
// is untidy; deleting something you meant to keep is the whole problem this
// exists to solve.
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
// The page without its notices. The bar at the bottom names what just
// happened, so reading the whole document finds a task that is no longer
// listed anywhere — which is how a passing test can mean nothing.
const page = async () => A.page.evaluate(() => {
  const notices = [...document.querySelectorAll('[data-notice]')]
    .map(el => el.innerText);
  return notices.reduce((text, n) => text.split(n).join(''), document.body.innerText);
});
const shows = async title => (await page()).includes(title);
const openArchive = async () => {
  if (!(await body(A.page)).includes('Everything')) {
    await A.page.getByLabel('Projects').click();
    await A.page.waitForTimeout(500);
  }
  await A.page.getByLabel(/^Archive,/).click();
  await A.page.waitForTimeout(800);
};

await add('write the report');
await add('cancel the gym');

// ── Unfinished: delete still means delete ──
await A.page.getByLabel('Delete cancel the gym').click();
await A.page.waitForTimeout(700);
let text = await body(A.page);
ok('an unfinished task is deleted, not kept', /Deleted/.test(text) && !/Archived/.test(text),
   text.slice(0, 200));

await openArchive();
ok('and it is not in the archive', !(await shows('cancel the gym')),
   (await body(A.page)).slice(0, 200));
ok('an empty archive says what it is for',
   /Nothing archived yet/.test(await body(A.page)));

// ── Finished: delete keeps it ──
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(700);
await A.page.getByLabel('Mark write the report as done').click();
await A.page.waitForTimeout(700);
await A.page.getByLabel(/^Show \d+ completed/).first().click();
await A.page.waitForTimeout(500);
await A.page.getByLabel('Delete write the report').click();
await A.page.waitForTimeout(700);

text = await body(A.page);
ok('a finished task is archived rather than deleted', /Archived/.test(text), text.slice(0, 200));
ok('the word deleted is not used for it', !/Deleted “write the report”/.test(text));
ok('it leaves the page', !(await shows('write the report')));

await openArchive();
ok('and is kept in the archive', await shows('write the report'));
console.log('ARCHIVE PAGE:', JSON.stringify((await body(A.page)).replace(/\n+/g, ' | ').slice(0, 400)));
ok('the archive counts what it holds', /1 task kept/i.test(await body(A.page)));
ok('and says which list it came from', /To Do/.test(await body(A.page)));

// ── Undo puts it back rather than losing it ──
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(600);
await add('second thing');
await A.page.getByLabel('Mark second thing as done').click();
await A.page.waitForTimeout(600);
const expand = A.page.getByLabel(/^Show \d+ completed/).first();
if (await expand.count()) { await expand.click(); await A.page.waitForTimeout(400); }
await A.page.getByLabel('Delete second thing').click();
await A.page.waitForTimeout(600);
await A.page.getByLabel(/^Put second thing back/).click();
await A.page.waitForTimeout(800);
ok('undo brings an archived task back to the page', await shows('second thing'));

await openArchive();
ok('and it is no longer in the archive', !(await shows('second thing')));
ok('the count follows', /1 task kept/i.test(await body(A.page)));

// ── Restoring from inside the archive ──
await A.page.getByLabel(/^Put write the report back/).click();
await A.page.waitForTimeout(800);
ok('the archive empties when its last task is restored',
   /Nothing archived yet/.test(await body(A.page)));
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(700);
ok('and the task is on the page again', await shows('write the report'));

// ── Deleting for good, from the archive ──
await A.page.getByLabel('Delete write the report').click();
await A.page.waitForTimeout(700);
await openArchive();
ok('it is archived again', await shows('write the report'));
await A.page.getByLabel('Delete write the report permanently').click();
await A.page.waitForTimeout(800);
text = await body(A.page);
ok('deleting from the archive says it is for good', /for good/.test(text), text.slice(0, 200));
ok('and it is gone from the archive', !/write the report/.test(text.split('Deleted')[0]));

// ── It survives a reload ──
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(600);
await add('keep me');
await A.page.getByLabel('Mark keep me as done').click();
await A.page.waitForTimeout(600);
const reveal = A.page.getByLabel(/^Show \d+ completed/).first();
if (await reveal.count()) { await reveal.click(); await A.page.waitForTimeout(400); }
await A.page.getByLabel('Delete keep me').click();
await A.page.waitForTimeout(900);

await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(1200);
await A.page.locator('input, textarea').nth(0).fill(USER.email);
await A.page.locator('input, textarea').nth(1).fill('a strong master password');
await A.page.getByText('UNLOCK', { exact: false }).first().click();
await A.page.waitForTimeout(3500);

ok('an archived task stays off the page after a reload', !(await shows('keep me')));
await openArchive();
ok('and is still kept', await shows('keep me'));

// ── Clearing a column files its work, which is the ordinary way this happens ──
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(600);
await add('first job');
await add('second job');
await A.page.getByLabel('Mark first job as done').click();
await A.page.waitForTimeout(400);
await A.page.getByLabel('Mark second job as done').click();
await A.page.waitForTimeout(600);

await A.page.getByLabel(/^Show \d+ completed/).first().click();
await A.page.waitForTimeout(400);
await A.page.getByLabel('Permanently delete all completed').first().click();
await A.page.waitForTimeout(900);

text = await body(A.page);
console.log('AFTER CLEAR:', JSON.stringify(text.replace(/\n+/g, ' | ').slice(0, 400)));
ok('clearing a column says the work was kept, not destroyed',
   /Archived \d+ finished tasks/.test(text), text.slice(0, 220));
ok('and the tasks leave the page',
   !(await shows('first job')) && !(await shows('second job')));

await openArchive();
ok('both are in the archive', (await shows('first job')) && (await shows('second job')));
ok('the count includes them', /\d+ tasks kept/i.test(await body(A.page)),
   (await body(A.page)).slice(0, 200));

// ── Emptying, and taking it back ──
await openArchive();
const heldBefore = (await page()).match(/(\d+) tasks? kept/i);
ok('the archive holds something to empty', !!heldBefore, (await page()).slice(0, 160));

await A.page.getByLabel('Empty the archive permanently').click();
await A.page.waitForTimeout(1200);

text = await body(A.page);
ok('emptying says how many went', /Emptied the archive — \d+ deleted/.test(text), text.slice(0, 200));
ok('and the archive is empty', /Nothing archived yet/.test(await page()));

await A.page.getByLabel('Put the archive back').click();
await A.page.waitForTimeout(1200);
ok('undo brings the whole archive back',
   !/Nothing archived yet/.test(await page()), (await page()).slice(0, 200));
ok('with the same count as before',
   (await page()).includes(heldBefore[0]), (await page()).slice(0, 200));
ok('and the tasks themselves', (await shows('first job')) && (await shows('second job')));

// It has to stick, not just look right until the next sync.
await A.page.waitForTimeout(3000);
ok('the restored archive survives a sync', (await shows('first job')));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
