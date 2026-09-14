// Moving a task from one column to the other.
//
// The two columns are the whole app, and this was the one thing about a task
// that could not be changed. Write "send the meter reading" in To Do, realise
// you have asked the agent to do it, and the only way across was to delete it
// and type it again on the other side — losing its date, its notes and its
// recording on the way. That is not a move, it is a retype with casualties.
//
// So what is proved here is mostly that nothing is lost in the crossing, and
// that the task arrives somewhere sensible rather than in the middle of a list
// it has never been in.
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
await new Promise(r => server.listen(4825, r));

// ── the fake project ──
const PROJECT = 'https://stubproject.supabase.co';
const KEY = 'sb_publishable_stubkeyabcdefghijkl';
const USER = { id: 'user-1', email: 't@example.com', aud: 'authenticated', role: 'authenticated' };
// Long-lived, and minted fresh on every request. This test looks at the app
// months into the future, and a session that expired on the way there would put
// the sign-in screen up instead of the list.
const YEAR = 365 * 24 * 3600;
const session = () => ({
  access_token: 'stub-access', token_type: 'bearer', expires_in: YEAR,
  expires_at: Math.floor(Date.now() / 1000) + YEAR, refresh_token: 'stub-refresh', user: USER,
});
let vault = null;
const rows = new Map();

async function route(r) {
  const req = r.request();
  const p = new URL(req.url()).pathname;
  const json = (body, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (p.startsWith('/auth/v1/signup') || p.startsWith('/auth/v1/token')) return json(session());
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
    for (const row of JSON.parse(req.postData() || '[]')) rows.set(row.id, row);
    return json([], 201);
  }
  return json({});
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };

const ctx = await browser.newContext({ serviceWorkers: 'block', permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('pageerror', e => console.log(`  page error: ${e}`));
await page.route(u => u.hostname === 'stubproject.supabase.co', route);
await page.goto('http://localhost:4825/Claude/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
let inputs = page.locator('input, textarea');
await inputs.nth(0).fill(PROJECT);
await inputs.nth(1).fill(KEY);
await page.getByText('Connect', { exact: true }).click();
await page.waitForTimeout(1200);

await page.getByText('Create an account').click();
await page.waitForTimeout(300);
inputs = page.locator('input, textarea');
await inputs.nth(0).fill(USER.email);
await inputs.nth(1).fill('a strong master password');
await inputs.nth(2).fill('a strong master password');
await page.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await page.waitForTimeout(2500);
const ack = page.locator('text=/written|saved|wrote|understand|acknowledge/i').first();
if (await ack.count()) await ack.click();
const cont = page.locator('text=/continue|done|open/i').first();
if (await cont.count()) await cont.click();
await page.waitForTimeout(1500);


const body = async () => page.evaluate(() => document.body.innerText);
const shows = async t => (await body()).includes(t);

// Which side of the divider a row is on. The headings share one row above both
// columns, so containment says nothing and geometry is what is left.
async function columnOf(title) {
  return page.evaluate(t => {
    const leafRect = label => {
      const el = [...document.querySelectorAll('*')]
        .find(e => e.children.length === 0 && (e.innerText || '').trim() === label);
      return el ? el.getBoundingClientRect() : null;
    };
    const todo = leafRect('TO DO');
    const owe = leafRect('OWE ME');
    const item = leafRect(t);
    if (!item) return 'missing';
    if (!todo || !owe) return 'no headings found';
    return item.left < (todo.left + owe.left) / 2 ? 'todo' : 'owe';
  }, title);
}
// The order of the rows in one column, top to bottom.
async function orderIn(side) {
  return page.evaluate(s => {
    const leafRect = label => {
      const el = [...document.querySelectorAll('*')]
        .find(e => e.children.length === 0 && (e.innerText || '').trim() === label);
      return el ? el.getBoundingClientRect() : null;
    };
    const todo = leafRect('TO DO');
    const owe = leafRect('OWE ME');
    if (!todo || !owe) return [];
    const divider = (todo.left + owe.left) / 2;
    const wantLeft = s === 'todo';
    return [...document.querySelectorAll('[aria-label]')]
      .filter(e => /^Mark .* as (not )?done$/.test(e.getAttribute('aria-label') || ''))
      .map(e => ({ r: e.getBoundingClientRect(), name: e.getAttribute('aria-label') }))
      .filter(x => x.r.width && ((x.r.left < divider) === wantLeft))
      .sort((a, b) => a.r.top - b.r.top)
      .map(x => x.name.replace(/^Mark /, '').replace(/ as (not )?done$/, ''));
  }, side);
}

async function toDo(title) {
  const box = page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await page.waitForTimeout(900);
}
const openTask = async t => { await page.locator(`text=${t}`).first().click(); await page.waitForTimeout(900); };
const closeSheet = async w => { await page.getByText(w, { exact: true }).last().click(); await page.waitForTimeout(1000); };
const playButtons = async () => page.getByLabel('Play voice note').count();

const MOVER = 'Send the meter reading';

// ── Something worth not losing ──
await toDo('Cancel the gym membership');
await toDo(MOVER);
await toDo('Book the MOT');
ok('it starts in To Do', (await columnOf(MOVER)) === 'todo', await columnOf(MOVER));

await openTask(MOVER);
await page.getByPlaceholder('Add notes...').fill('Reading is on the cupboard door');
// A recording too, because losing one of those is the worst of the losses.
const mic = page.getByLabel('Record a voice note');
const mb = await mic.boundingBox();
await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
await page.mouse.down();
await page.waitForTimeout(1300);
await page.mouse.up();
await page.waitForTimeout(1800);
ok('with a recording on it', await shows('Voice note'));
await closeSheet('Save');
ok('and the row shows it', (await playButtons()) === 1);

// ── The crossing ──
await openTask(MOVER);
ok('the sheet offers the column', await shows('COLUMN'), (await body()).slice(0, 400));
ok('and says which one it is in',
   (await page.getByLabel('Already in To Do').count()) === 1);
ok('and offers the other', (await page.getByLabel('Move to Owe Me').count()) === 1);

await page.getByLabel('Move to Owe Me').click();
await page.waitForTimeout(500);
ok('choosing Owe Me asks who owes it', await shows('PERSON'), (await body()).slice(0, 500));
await page.getByPlaceholder(/who/i).first().fill('Marchetti');
await closeSheet('Save');

ok('the task is now in Owe Me', (await columnOf(MOVER)) === 'owe', await columnOf(MOVER));
ok('with the person on it', await shows('Marchetti'));

// ── Nothing was lost on the way ──
ok('the recording came with it', (await playButtons()) === 1);
await openTask(MOVER);
// Asked of the field rather than the page: a textarea's value is not part of
// innerText, so scanning the page for it finds nothing whether it is there or
// not.
const notesValue = await page.getByPlaceholder('Add notes...').inputValue();
ok('and so did the notes', notesValue === 'Reading is on the cupboard door', notesValue);
ok('and the recording is still on the task', await shows('Voice note'));
await closeSheet('Cancel');

// ── It arrives somewhere sensible ──
//
// Order is kept per column, so the value it carried was measured against the
// list it has just left. Bringing that along drops it into the middle of a
// column it has never been in, which reads as having lost it.
const owe = await orderIn('owe');
ok('it arrives at the top of its new column', owe[0] === MOVER, JSON.stringify(owe));
const todo = await orderIn('todo');
ok('and has left the old one', !todo.includes(MOVER), JSON.stringify(todo));
ok('which is otherwise undisturbed',
   todo.includes('Cancel the gym membership') && todo.includes('Book the MOT'),
   JSON.stringify(todo));

// ── And back again ──
await openTask(MOVER);
await page.getByLabel('Move to To Do').click();
await page.waitForTimeout(400);
ok('going back hides the person field', !(await shows('PERSON')));
await closeSheet('Save');
ok('the task is back in To Do', (await columnOf(MOVER)) === 'todo', await columnOf(MOVER));
ok('and no longer claims anybody owes it', !(await shows('Marchetti')));
ok('while still carrying its recording', (await playButtons()) === 1);

// ── It has to survive being put down ──
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
await page.waitForTimeout(3500);
ok('the move survives a reload', (await columnOf(MOVER)) === 'todo', await columnOf(MOVER));
ok('and the person stays cleared', !(await shows('Marchetti')));
ok('and the recording is still there', (await playButtons()) === 1);

// ── Cancelling moves nothing ──
await openTask(MOVER);
await page.getByLabel('Move to Owe Me').click();
await page.waitForTimeout(400);
await closeSheet('Cancel');
ok('a move that was cancelled did not happen', (await columnOf(MOVER)) === 'todo',
   await columnOf(MOVER));

if (process.env.SHOT) {
  await openTask(MOVER);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: process.env.SHOT, fullPage: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
