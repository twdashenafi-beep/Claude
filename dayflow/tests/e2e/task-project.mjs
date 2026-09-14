// Moving a task into a project, from the sheet you get by opening it.
//
// This was already possible by holding a task, which is a gesture nobody finds
// by accident — the capability existed and could not be discovered. Opening a
// task is where you go to change what a task is, and every other thing about it
// was already there.
//
// What has to be proved is that the task actually moves, that it leaves the
// list it was in, that Everything brings it back, and that it survives a
// reload — a move that only held until the next sync would be worse than no
// move at all.
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
await new Promise(r => server.listen(4813, r));

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
  await page.goto('http://localhost:4813/Claude/', { waitUntil: 'networkidle' });
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
const shows = async t => (await page()).includes(t);
async function add(title) {
  const box = A.page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await A.page.waitForTimeout(800);
}
const tab = name => A.page.getByLabel(`Project ${name}`, { exact: true });
const makeProject = async name => {
  await A.page.getByLabel('New project').click();
  await A.page.waitForTimeout(350);
  await A.page.getByLabel('New project name').fill(name);
  await A.page.getByLabel('Create the project').click();
  await A.page.waitForTimeout(800);
};
const openTask = async title => {
  await A.page.locator(`text=${title}`).first().click();
  await A.page.waitForTimeout(700);
};
const saveTask = async () => {
  await A.page.getByText('Save', { exact: true }).last().click();
  await A.page.waitForTimeout(900);
};

// ── With no projects, the sheet does not offer one ──
await add('Call the letting agent');
await openTask('Call the letting agent');
ok('with no projects there is no project row to puzzle over',
   (await A.page.getByLabel(/^Put in /).count()) === 0);
await A.page.getByText('Cancel', { exact: true }).last().click();
await A.page.waitForTimeout(600);

// ── Make two, then move the task from the sheet ──
await A.page.getByLabel('Projects').click();
await A.page.waitForTimeout(500);
for (const n of ['Flat', 'Work']) await makeProject(n);
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(700);

ok('the task starts in Everything', await shows('Call the letting agent'));

await openTask('Call the letting agent');
ok('now the sheet offers the projects', (await A.page.getByLabel(/^Put in /).count()) === 3);
ok('and Everything is one of them', (await A.page.getByLabel('Put in Everything').count()) === 1);
ok('Everything is the one selected',
   (await A.page.getByLabel('Put in Everything').getAttribute('aria-checked')) === 'true');

// ── The names have to be readable, not merely present ──
//
// Everything above this point passed while the row rendered as five empty
// boxes: the buttons were there, the labels were there, and flex: 0 had
// collapsed each one to its padding. Querying by label cannot see that, so the
// rendered width is measured instead.
{
  const boxes = await A.page.evaluate(() => [...document.querySelectorAll('[aria-label^="Put in "]')]
    .map(el => ({
      label: el.getAttribute('aria-label').replace('Put in ', ''),
      width: Math.round(el.getBoundingClientRect().width),
      text: (el.innerText || '').trim(),
    })));
  // Proportional, not a flat number: "Flat" at 53 points is right for four
  // letters and 14 points of padding either side, while the collapsed version
  // was 28 to 36 whatever the name. What is wrong is a button that does not
  // grow with its text.
  const wideEnough = b => b.width > 28 + b.text.length * 4;
  ok('every project button grows to fit its name',
     boxes.every(wideEnough), JSON.stringify(boxes));
  ok('and actually shows it',
     boxes.every(b => b.text.length > 0 && b.label.startsWith(b.text.slice(0, 4))),
     JSON.stringify(boxes));
  ok('a longer name gets a wider button than a short one',
     Math.max(...boxes.map(b => b.width)) > Math.min(...boxes.map(b => b.width)),
     JSON.stringify(boxes.map(b => `${b.label}:${b.width}`)));
}

await A.page.getByLabel('Put in Flat').click();
await A.page.waitForTimeout(300);
ok('choosing one selects it',
   (await A.page.getByLabel('Put in Flat').getAttribute('aria-checked')) === 'true');
ok('and deselects the one before',
   (await A.page.getByLabel('Put in Everything').getAttribute('aria-checked')) !== 'true');
await saveTask();

ok('the task leaves Everything', !(await shows('Call the letting agent')), (await page()).slice(0, 300));
await tab('Flat').click();
await A.page.waitForTimeout(800);
ok('and arrives in the project', await shows('Call the letting agent'), (await page()).slice(0, 300));

// ── Cancelling does not move it ──
await openTask('Call the letting agent');
await A.page.getByLabel('Put in Work').click();
await A.page.waitForTimeout(250);
await A.page.getByText('Cancel', { exact: true }).last().click();
await A.page.waitForTimeout(900);
ok('cancelling leaves the task where it was', await shows('Call the letting agent'),
   (await page()).slice(0, 300));

// ── Straight from one project to another ──
await openTask('Call the letting agent');
await A.page.getByLabel('Put in Work').click();
await saveTask();
ok('it leaves the project it was in', !(await shows('Call the letting agent')));
await tab('Work').click();
await A.page.waitForTimeout(800);
ok('and lands in the other one', await shows('Call the letting agent'));

// ── And back to Everything ──
await openTask('Call the letting agent');
await A.page.getByLabel('Put in Everything').click();
await saveTask();
await A.page.getByLabel('All tasks not in a project').click();
await A.page.waitForTimeout(800);
ok('Everything takes it back', await shows('Call the letting agent'));

// ── Moving does not disturb the rest of the task ──
await openTask('Call the letting agent');
await A.page.getByLabel('high priority').click();
await A.page.waitForTimeout(200);
await A.page.getByLabel('Put in Flat').click();
await saveTask();
await tab('Flat').click();
await A.page.waitForTimeout(800);
ok('a change made in the same breath is kept too',
   /!/.test(await page()), (await page()).slice(0, 300));

// ── It has to survive a reload ──
await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(1200);
await A.page.locator('input, textarea').nth(0).fill(USER.email);
await A.page.locator('input, textarea').nth(1).fill('a strong master password');
await A.page.getByText('UNLOCK', { exact: false }).first().click();
await A.page.waitForTimeout(3500);
ok('after a reload it is not back in Everything', !(await shows('Call the letting agent')),
   (await page()).slice(0, 300));
await A.page.getByLabel('Projects').click();
await A.page.waitForTimeout(600);
await tab('Flat').click();
await A.page.waitForTimeout(800);
ok('it is still in the project it was moved to', await shows('Call the letting agent'));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
