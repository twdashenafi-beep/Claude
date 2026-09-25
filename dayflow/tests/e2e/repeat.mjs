// Tasks that come back.
//
// The model is deliberately small — tick one off and the next appears, carrying
// the repeat with it — and small models are the ones where a missing field goes
// unnoticed, because nothing crashes: the next task simply arrives without the
// thing you set, and never comes back again after that.
//
// So this does the whole loop through the app rather than testing the date
// arithmetic, which the unit tests already cover: set a repeat in the sheet,
// tick the task off, and look at what is standing there afterwards.
//
// Needs a build and a browser:
//   npm i -D playwright && npx playwright install chromium
//   npm run build:pages
//   npm run test:e2e
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
await new Promise(r => server.listen(4841, r));

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
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };
const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log(`  page error: ${e}`));
await page.route(u => u.hostname === 'stubproject.supabase.co', route);
await page.goto('http://localhost:4841/Claude/', { waitUntil: 'networkidle' });
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
const TASK = 'Water the plants';
const waiting = () => page.getByLabel(`Mark ${TASK} as done`).count();
const finished = () => page.getByLabel(`Mark ${TASK} as not done`).count();
const openTask = async () => {
  await page.locator(`text=${TASK}`).first().click();
  await page.waitForTimeout(900);
};
const closeSheet = async word => {
  await page.getByText(word, { exact: true }).last().click();
  await page.waitForTimeout(1100);
};
const showCompleted = async () => {
  const toggle = page.getByLabel(/^Show \d+ completed/).first();
  if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(500); }
};

// ── Setting one ──
const box = page.locator('input, textarea').first();
await box.fill(TASK);
await box.press('Enter');
await page.waitForTimeout(900);
ok('a task starts out not repeating', !(await shows('every day')), (await body()).slice(0, 300));

await openTask();
ok('the sheet offers a repeat', await shows('REPEAT'), (await body()).slice(0, 400));
// Dated today first, or there is nothing for "every day" to count from but the
// stamp the app writes when you never chose a date.
await page.getByText('Today', { exact: true }).first().click();
await page.waitForTimeout(300);
await page.getByLabel('Repeats Daily').click();
await page.waitForTimeout(300);
await closeSheet('Save');

ok('the row says it will come back', await shows('every day'), (await body()).slice(0, 400));
ok('and there is one of it', (await waiting()) === 1, String(await waiting()));

// ── Ticking it off ──
await page.getByLabel(`Mark ${TASK} as done`).click();
await page.waitForTimeout(1400);

ok('ticking it off brings the next one back', (await waiting()) === 1, String(await waiting()));
ok('and the next one is due tomorrow', await shows('Tomorrow'), (await body()).slice(0, 400));
ok('it still says it repeats', await shows('every day'));

await showCompleted();
ok('the one just done is still there, finished', (await finished()) === 1, String(await finished()));

// ── The finished one has handed the repeat over ──
//
// Otherwise unticking it by mistake would make a second copy, and the one in
// the archive would go on claiming it will come back.
{
  const rows = page.getByLabel(`Mark ${TASK} as not done`);
  await rows.first().click();
  await page.waitForTimeout(1400);
  ok('unticking the finished one does not make a third',
     (await waiting()) === 2, String(await waiting()));
  // Put it back as it was.
  await page.getByLabel(`Mark ${TASK} as done`).last().click();
  await page.waitForTimeout(1400);
}

// ── Two taps on the checkbox ──
//
// Not an exotic thing to do: it is what happens when the screen is slow and you
// press again. Whether a task is being finished is read from a list React may
// not have committed yet, so a second tap arriving inside that window could
// find it still waiting, decide it was being finished all over again, and make
// a second copy of the follow-on.
//
// Said plainly: this does not reproduce that. The window is the gap between a
// state update and the effect that mirrors it, and on a desktop browser with
// nothing else to do that gap closes faster than two clicks can be delivered —
// the assertion below passes with the guard removed. It is here as a guard on
// the outcome rather than a demonstration of the cause. The fix it protects is
// reasoned rather than reproduced, which is worth knowing when reading it.
{
  const box = page.getByLabel(`Mark ${TASK} as done`).first();
  await box.dblclick({ delay: 20 });
  await page.waitForTimeout(1600);
  ok('a double tap does not leave a spare copy behind',
     (await waiting()) <= 2, String(await waiting()));
  // Back to one waiting, whichever way the double tap landed.
  await showCompleted();
  while ((await waiting()) > 1) {
    await page.getByLabel(`Mark ${TASK} as done`).first().click();
    await page.waitForTimeout(1200);
  }
  ok('and the list can be got back to one', (await waiting()) === 1, String(await waiting()));
}

// ── What the next one actually carries ──
await page.locator(`text=${TASK}`).first().click();
await page.waitForTimeout(900);
ok('the new one carries the repeat', await shows('REPEAT'));
const stillDaily = await page.evaluate(() => {
  const el = document.querySelector('[aria-label="Repeats Daily"]');
  return el ? el.getAttribute('aria-checked') : null;
});
ok('and it is still set to daily', stillDaily === 'true', String(stillDaily));
await closeSheet('Cancel');

// ── Saving without touching the date leaves the chain alone ──
//
// A monthly task remembers which day of the month it is aiming at, because rent
// due on the 31st shows the 28th in February and the chain has to know to go
// back to the 31st in March. Opening that task to fix a typo and pressing Save
// used to record the 28th as the intention, and move the rent by three days for
// good. A save that did not touch the date must not move anything.
//
// The anchor is not on screen anywhere, so the export is used as the instrument
// — it writes every field of every task, which is exactly what is needed to see
// one that the interface never shows.
const RENT = 'Pay the rent';
async function fieldsOf(title) {
  const waitFor = page.waitForEvent('download', { timeout: 15000 });
  await page.getByLabel('Account settings').click();
  await page.waitForTimeout(700);
  await page.getByText('Export a copy', { exact: true }).click();
  const file = await waitFor;
  const saved = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
  await page.getByText('Done', { exact: true }).first().click();
  await page.waitForTimeout(600);
  return (saved.tasks || []).filter(t => t.title === title && !t.completed);
}

{
  const box3 = page.locator('input, textarea').first();
  await box3.fill(RENT);
  await box3.press('Enter');
  await page.waitForTimeout(900);
  await page.locator(`text=${RENT}`).first().click();
  await page.waitForTimeout(900);
  await page.getByText('Today', { exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel('Repeats Monthly').click();
  await page.waitForTimeout(300);
  await closeSheet('Save');

  // Ticking it off is what writes the anchor down: until then the chain has
  // only ever had one date and no memory of aiming at anything.
  await page.getByLabel(`Mark ${RENT} as done`).first().click();
  await page.waitForTimeout(1600);

  const beforeSave = await fieldsOf(RENT);
  ok('a monthly task that has come round remembers the day it aims at',
     beforeSave.length === 1 && Number.isInteger(beforeSave[0].repeatDay),
     JSON.stringify(beforeSave.map(t => t.repeatDay)));

  // Opened and saved, with nothing touched.
  await page.locator(`text=${RENT}`).first().click();
  await page.waitForTimeout(900);
  await closeSheet('Save');

  const afterSave = await fieldsOf(RENT);
  ok('and a save that touched nothing leaves it alone',
     afterSave.length === 1 && afterSave[0].repeatDay === beforeSave[0].repeatDay,
     JSON.stringify([beforeSave[0] && beforeSave[0].repeatDay, afterSave[0] && afterSave[0].repeatDay]));
  ok('with the repeat still set', afterSave[0] && afterSave[0].repeat === 'monthly',
     JSON.stringify(afterSave[0] && afterSave[0].repeat));
}

// ── And it survives the round trip to the server ──
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
await page.waitForTimeout(3500);

ok('one still waiting after a reload', (await waiting()) === 1, String(await waiting()));
ok('and it still says it comes back', await shows('every day'), (await body()).slice(0, 400));

// The audio of a note is the one thing that must not travel: a recording is
// about the one you just did, and carrying it forward would put a fresh
// hundred kilobytes into the vault every day until it filled.
ok('and it did not bring a recording with it',
   (await page.getByLabel('Play voice note').count()) === 0);

// ── Turning it off ──
await page.locator(`text=${TASK}`).first().click();
await page.waitForTimeout(900);
await page.getByLabel('Does not repeat').click();
await page.waitForTimeout(300);
await closeSheet('Save');
ok('turning it off stops the row saying it', !(await shows('every day')), (await body()).slice(0, 400));

const before = await waiting();
await page.getByLabel(`Mark ${TASK} as done`).first().click();
await page.waitForTimeout(1400);
ok('and nothing comes back', (await waiting()) === before - 1,
   `${await waiting()} vs ${before}`);

if (process.env.SHOT) {
  // Opened on a task that repeats, which is the thing a picture of this is
  // taken to show.
  const box2 = page.locator('input, textarea').first();
  await box2.fill('Pay the rent');
  await box2.press('Enter');
  await page.waitForTimeout(900);
  await page.locator('text=Pay the rent').first().click();
  await page.waitForTimeout(900);
  await page.getByText('Today', { exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByLabel('Repeats Monthly').click();
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const repeatRow = page.getByLabel('Repeats Monthly');
  if (await repeatRow.count()) await repeatRow.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: process.env.SHOT });
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
