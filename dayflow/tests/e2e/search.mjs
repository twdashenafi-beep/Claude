// Search: finding a task without remembering where you filed it.
//
// The claim search makes is a strong one — that it looks everywhere, across
// scopes, projects and the archive alike — and a search that quietly only reads
// the page you are on would look identical on the page you are on. So most of
// what follows is proving the reach: a task the current page cannot show, found
// anyway, and the result saying where it actually lives.
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
await new Promise(r => server.listen(4607, r));

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
  await page.goto('http://localhost:4607/Claude/', { waitUntil: 'networkidle' });
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

const body = page => page.evaluate(() => document.body.innerText);

// The page without its notices. The undo bar names the task it is talking
// about, so reading the whole document finds titles that are not in any list —
// which is exactly how a search test can pass without search working.
const page = async () => A.page.evaluate(() => {
  const notices = [...document.querySelectorAll('[data-notice]')].map(el => el.innerText);
  return notices.reduce((text, n) => text.split(n).join(''), document.body.innerText);
});
const shows = async title => (await page()).includes(title);

async function add(title) {
  const box = A.page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await A.page.waitForTimeout(800);
}

// Adding through the sheet, which is the only way to attach a note or a person.
async function addDetailed(column, title, { notes, person } = {}) {
  const owe = column === 'Owe Me';
  await A.page.getByLabel(
    owe ? 'Add something you are waiting on to Owe Me' : 'Add a task to To Do'
  ).click();
  await A.page.waitForTimeout(400);
  await A.page
    .getByPlaceholder(owe ? 'What are you waiting on?' : 'What needs to be done?')
    .fill(title);
  if (notes) await A.page.getByPlaceholder('Notes').fill(notes);
  if (person) await A.page.getByPlaceholder('Who owes you this?').fill(person);
  await A.page.getByLabel(`Add to ${column}`).click();
  await A.page.waitForTimeout(900);
}

// The sheet the task opened in has no labelled dismissal; its Cancel is the
// last one on the page because the modal renders after everything else.
const closeDetail = async () => {
  const cancel = A.page.getByText('Cancel', { exact: true }).last();
  if (await cancel.count()) { await cancel.click(); await A.page.waitForTimeout(800); }
};

const openSearch = async () => {
  await A.page.getByLabel('Search', { exact: true }).click();
  await A.page.waitForTimeout(500);
};
const type = async q => {
  await A.page.getByLabel('Search tasks and notes').fill(q);
  await A.page.waitForTimeout(600);
};
const scope = async name => {
  await A.page.getByLabel(`Show ${name.toLowerCase()} tasks`).click();
  await A.page.waitForTimeout(600);
};

// ── The material to search ──
//
// Deliberately scattered: one on the current page, one in another scope, one in
// a project, one in the archive. Anything that finds all four has genuinely
// looked past the page it was opened from.
const NOTE = 'the stopcock is behind the panel, not under the stairs';

await addDetailed('To Do', 'mend the sink', { notes: NOTE });
await addDetailed('Owe Me', 'the deposit back', { person: 'Marchetti Lettings' });
await add('buy milk');

await scope('Week');
await add('sink survey for the week');
ok('a task typed on the Week page lands on the Week page', await shows('sink survey for the week'),
   (await page()).slice(0, 300));
await scope('Day');

// One in a project.
await A.page.getByLabel('Projects').click();
await A.page.waitForTimeout(500);
await A.page.getByLabel('New project').click();
await A.page.waitForTimeout(400);
await A.page.getByLabel('New project name').fill('Flat');
await A.page.getByLabel('Create the project').click();
await A.page.waitForTimeout(900);
await add('sink taps for the flat');

// And one in the archive.
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(700);
await add('the old sink quote');
await A.page.getByLabel('Mark the old sink quote as done').click();
await A.page.waitForTimeout(500);
const reveal = A.page.getByLabel(/^Show \d+ completed/).first();
if (await reveal.count()) { await reveal.click(); await A.page.waitForTimeout(400); }
await A.page.getByLabel('Delete the old sink quote').click();
await A.page.waitForTimeout(900);

// ── It exists, and it says what it is for before you type ──
await openSearch();
ok('the search field is on the page',
   (await A.page.getByLabel('Search tasks and notes').count()) === 1);
ok('it says what it will look at before anything is typed',
   /at least two letters/i.test(await page()), (await page()).slice(0, 240));
ok('and names the archive as somewhere it looks',
   /archive/i.test(await page()));

// One letter is not a search — it is the first letter of one.
await type('s');
ok('one letter returns nothing rather than everything',
   /at least two letters/i.test(await page()) && !(await shows('mend the sink')),
   (await page()).slice(0, 240));

// ── The reach: everywhere at once ──
await type('sink');
const found = await page();
console.log('RESULTS:', JSON.stringify(found.replace(/\n+/g, ' | ').slice(0, 500)));

ok('a task on the current page is found', found.includes('mend the sink'));
ok('a task in another scope is found', found.includes('sink survey for the week'));
ok('a task in a project is found', found.includes('sink taps for the flat'));
ok('a task in the archive is found', found.includes('the old sink quote'));
ok('an unrelated task is not', !found.includes('buy milk'));
ok('it counts what it found', /\d+ results/.test(found), found.slice(0, 200));

// ── And says where each one lives ──
ok('a result in another scope says which', /Week/.test(found), found.slice(0, 400));
ok('a result in a project names it', /Flat/.test(found), found.slice(0, 400));
ok('a result in the archive says so', /Archive/.test(found), found.slice(0, 400));

// ── Notes and people, not just titles ──
await type('stopcock');
ok('a word only in a note finds the task', await shows('mend the sink'),
   (await page()).slice(0, 300));
ok('and shows the part of the note that matched',
   /stopcock is behind the panel/.test(await page()), (await page()).slice(0, 300));

await type('marchetti');
ok('the person on an Owe Me is searched', await shows('the deposit back'),
   (await page()).slice(0, 300));
ok('and the result says it is an Owe Me', /Owe Me/.test(await page()));

// ── Case, and nothing found ──
await type('SINK');
ok('capitals find the same things', await shows('mend the sink'));

await type('aardvark');
ok('nothing found says so plainly', /Nothing matches/.test(await page()),
   (await page()).slice(0, 200));
ok('and does not leave old results on the page', !(await shows('mend the sink')));

// ── Getting back out ──
await type('sink');
await A.page.getByLabel('Clear the search').click();
await A.page.waitForTimeout(500);
ok('clearing empties the field',
   (await A.page.getByLabel('Search tasks and notes').inputValue()) === '');

await A.page.getByLabel('Close search').click();
await A.page.waitForTimeout(700);
ok('closing returns to the page',
   (await shows('buy milk')) && (await A.page.getByLabel('Search tasks and notes').count()) === 0,
   (await page()).slice(0, 200));

// ── Opening a result goes to where the task is ──
//
// The point of saying where something lives is being taken there. A result that
// opened the task but left you on the page you searched from would make the
// location a label rather than an answer.
await openSearch();
await type('sink survey');
await A.page.getByLabel('Open sink survey for the week').click();
await A.page.waitForTimeout(1000);
let text = await body(A.page);
ok('opening a result opens the task', /sink survey for the week/.test(text));

// Close the sheet and look at the page behind it.
await closeDetail();
ok('and leaves you in the scope the task was in',
   (await shows('sink survey for the week')) && !(await shows('buy milk')),
   (await page()).slice(0, 300));

// A result in a project takes you into that project.
await scope('Day');
await openSearch();
await type('sink taps');
await A.page.getByLabel('Open sink taps for the flat').click();
await A.page.waitForTimeout(1000);
await closeDetail();
ok('a result in a project takes you into that project',
   (await shows('sink taps for the flat')) && !(await shows('buy milk')),
   (await page()).slice(0, 300));

// ── Nothing typed is not a state you get stuck in ──
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(700);
await openSearch();
await type('sink');
await A.page.getByLabel('Close search').click();
await A.page.waitForTimeout(500);
await openSearch();
ok('reopening search starts empty rather than on the last search',
   (await A.page.getByLabel('Search tasks and notes').inputValue()) === '',
   (await page()).slice(0, 200));

// ── It survives a reload, because the tasks do ──
await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(1200);
await A.page.locator('input, textarea').nth(0).fill(USER.email);
await A.page.locator('input, textarea').nth(1).fill('a strong master password');
await A.page.getByText('UNLOCK', { exact: false }).first().click();
await A.page.waitForTimeout(3500);
await openSearch();
await type('sink');
ok('search still reaches the archive after a reload', await shows('the old sink quote'),
   (await page()).slice(0, 300));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
