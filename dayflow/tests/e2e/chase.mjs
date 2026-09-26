// Asking for the thing back.
//
// Owe Me has always known who owes you what and how long it has been, and has
// never once helped you ask. Chasing is also not done a task at a time: if the
// agent owes you the inventory and the meter reading, that is one message, not
// two.
//
// So the button is written for the person, not the task, and hands the draft to
// whatever the device sends things with. The share sheet cannot be driven from
// a test, so navigator.share is replaced by something that records what it was
// given — which is the part worth checking anyway: that the words handed over
// are the right ones, gathered from the right tasks.
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
await new Promise(r => server.listen(4837, r));

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
await page.goto('http://localhost:4837/Claude/', { waitUntil: 'networkidle' });
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

// Stand in for the share sheet, and record what it is handed.
await page.addInitScript(() => {
  window.__shared = [];
  navigator.share = async payload => { window.__shared.push(payload); };
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
await page.waitForTimeout(3500);

const shared = async () => page.evaluate(() => window.__shared.map(p => p.text));
async function oweMe(title, person) {
  await page.getByLabel('Add something you are waiting on to Owe Me').click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('What are you waiting on?').fill(title);
  await page.getByPlaceholder('Who owes you this?').fill(person);
  await page.getByLabel('Add to Owe Me').click();
  await page.waitForTimeout(900);
}
async function toDo(title) {
  const box = page.locator('input, textarea').first();
  await box.fill(title); await box.press('Enter'); await page.waitForTimeout(800);
}
const openTask = async t => { await page.locator(`text=${t}`).first().click(); await page.waitForTimeout(900); };
const closeSheet = async w => {
  await page.getByText(w, { exact: true }).last().click();
  // Waited out rather than slept through: the sheet slides, and clicking a task
  // underneath one that is still on its way out lands on the sheet instead.
  await page.getByText('Edit Task', { exact: true }).first()
    .waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
};
const tapChase = async () => {
  const btn = page.getByLabel(/^Write a chase to /);
  await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await btn.click();
  await page.waitForTimeout(700);
};

// ── One person, two things ──
await oweMe('The signed inventory', 'Marchetti');
await oweMe('The meter reading', 'Marchetti');
await oweMe('The deposit back', 'Okafor');
await toDo('Cancel the gym membership');

await openTask('The signed inventory');
ok('a chase is offered', (await page.getByLabel(/^Write a chase to /).count()) === 1,
   (await body()).slice(-400));
ok('and it says how many things it will cover', await shows('2 things'), (await body()).slice(-300));

await tapChase();
const first = (await shared())[0] || '';
ok('the share sheet was handed something', !!first, JSON.stringify(await shared()));
ok('addressed to the person', first.startsWith('Hi Marchetti'), first);
ok('covering both of their things',
   first.includes('The signed inventory') && first.includes('The meter reading'), first);
ok('with how long each has waited', /asked/.test(first), first);
ok('and nothing belonging to anyone else', !first.includes('deposit'), first);
ok('nor anything from the other column', !first.includes('gym'), first);

// ── The other person gets their own ──
await closeSheet('Cancel');
await openTask('The deposit back');
ok('a single thing is offered without a count', !(await shows('things')), (await body()).slice(-300));
await tapChase();
const second = (await shared())[1] || '';
ok('their chase is their own', second.startsWith('Hi Okafor'), second);
ok('and mentions only what they owe',
   second.includes('the deposit back') && !second.includes('inventory'), second);

// ── Finishing one takes it out of the next chase ──
await closeSheet('Cancel');
await page.getByLabel('Mark The meter reading as done').click();
await page.waitForTimeout(900);
await openTask('The signed inventory');
ok('the count drops when one arrives', !(await shows('2 things')), (await body()).slice(-300));
await tapChase();
const third = (await shared())[2] || '';
ok('and the finished one is not asked for again',
   !third.includes('The meter reading'), third);
ok('while the outstanding one still is', third.includes('the signed inventory'), third);

// ── A To Do has nobody to chase ──
await closeSheet('Cancel');
await openTask('Cancel the gym membership');
ok('a To Do offers no chase', (await page.getByLabel(/^Write a chase to /).count()) === 0);
await closeSheet('Cancel');

// ── An Owe Me with no name yet offers nothing either ──
await oweMe('Something from somebody', '');
await openTask('Something from somebody');
ok('nor does an Owe Me with no name on it',
   (await page.getByLabel(/^Write a chase to /).count()) === 0, (await body()).slice(-300));

// Typing a name in makes it available without saving first.
await page.getByPlaceholder('Who owes you?').fill('Priya');
await page.waitForTimeout(400);
ok('typing a name offers the chase straight away',
   (await page.getByLabel(/^Write a chase to /).count()) === 1, (await body()).slice(-300));

if (process.env.SHOT) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const btn = page.getByLabel(/^Write a chase to /);
  if (await btn.count()) await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: process.env.SHOT });
}

// ── Whether you have already asked ──────────────────────────────────────────
//
// The column could say a thing had been waiting three weeks and could write the
// message asking for it, and knew nothing about whether you had sent one. On
// Thursday the row read exactly as it had on Monday, before you chased.
{
  // The unnamed one is still open from the block above, and a sheet on its way
  // out swallows the click meant for the row beneath it.
  await closeSheet('Cancel');

  // A pair of their own. Marchetti and Okafor have been chased various numbers
  // of times by now, and "chased once" showing somewhere on the page would
  // answer for a row this block never touched.
  await oweMe('The signed lease', 'Nakamura');
  await oweMe('The insurance certificate', 'Nakamura');

  // innerText rather than textContent: a cancelled sheet stays mounted, and its
  // own "Chased once" would be counted as though it were a row.
  const saying = async phrase => page.evaluate(
    p => ((document.body.innerText || '').match(new RegExp(p, 'gi')) || []).length, phrase);
  const before = await saying('chased once');

  await openTask('The signed lease');
  // The sheet's line, not the rows': the list behind the sheet is in innerText
  // too, and Marchetti's rows have been chased plenty by now. Only the sheet
  // says when it happened, so only the sheet has the dash.
  const detail = /Chased (once|twice|\d+ times) —/i;
  ok('nothing is said about chasing before you have',
     !detail.test(await body()), (await body()).slice(-400));
  await tapChase();
  await page.waitForTimeout(900);
  ok('the sheet says the chase happened',
     /Chased once/i.test(await body()), (await body()).slice(-400));
  await closeSheet('Cancel');

  // Cancelled, deliberately: a chase is a thing that happened, not an edit
  // waiting on Save, and the sheet is not where it gets to be undone.
  //
  // Two more rows than before, because the message asked for both of their
  // things and both of them have therefore been chased.
  const after = await saying('chased once');
  ok('it survives the sheet being cancelled, on every task the message covered',
     after - before === 2, `${before} → ${after}`);

  const twiceBefore = await saying('chased twice');
  await openTask('The signed lease');
  await tapChase();
  await page.waitForTimeout(900);
  ok('asking again counts again', /Chased twice/i.test(await body()), (await body()).slice(-400));
  await closeSheet('Cancel');
  ok('and both rows count with it',
     (await saying('chased twice')) - twiceBefore === 2,
     `${twiceBefore} → ${await saying('chased twice')}`);
  ok('leaving none of theirs still reading once',
     (await saying('chased once')) === before, String(await saying('chased once')));
}

// ── Everything one person owes, in one place ────────────────────────────────
//
// An executive does not think "which tasks are outstanding", they think "what
// is outstanding with Marchetti" — and the column is sorted by task, so the
// answer is scattered down it.
{
  await openTask('The signed inventory');
  const seeAll = page.getByLabel(/^See everything Marchetti owes you$/);
  ok('the sheet offers to show the lot', (await seeAll.count()) === 1,
     (await body()).slice(-400));
  await seeAll.click();
  await page.waitForTimeout(1200);

  const found = await body();
  ok('and shows what they owe', found.includes('The signed inventory'), found.slice(0, 400));
  ok('all of it', found.includes('The meter reading'), found.slice(0, 400));
  ok('and nobody else\'s', !found.includes('The deposit back'), found.slice(0, 400));
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
