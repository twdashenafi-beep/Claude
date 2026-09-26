// The week, reckoned.
//
// Four figures the app already knew and had never put on one page. The whole
// feature turns on the calendar, so the calendar is the thing this test takes
// away from it: the browser's clock is pinned, first to a Wednesday in the week
// before and then to the Friday, and the page is asked what it makes of each.
//
// Without that, a suite run on a Tuesday would see no reckoning at all and pass
// by never looking.
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

const PROJECT = 'https://stubproject.supabase.co';
const KEY = 'sb_publishable_stubkeyabcdefghijkl';
const USER = { id: 'user-1', email: 't@example.com', aud: 'authenticated', role: 'authenticated' };
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
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}) });
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };

const ctx = await browser.newContext({ serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('pageerror', e => console.log(`  page error: ${e}`));
await page.route(u => u.hostname === 'stubproject.supabase.co', route);

// ── Last week, on a Wednesday ───────────────────────────────────────────────
const LAST_WEEK = new Date('2026-09-23T10:00:00');
const THE_FRIDAY = new Date('2026-10-02T15:00:00');
await page.clock.setFixedTime(LAST_WEEK);

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
const week = () => page.getByLabel(/^Open the week's reckoning$/);

// By its own label rather than "the first input on the page". There is exactly
// one text box on the list screen, but which element that locator lands on
// depends on what else happens to be mounted, and it has landed on something
// invisible often enough to be worth naming the thing outright.
async function toDo(title) {
  const box = page.getByPlaceholder('Write a line…');
  await box.waitFor({ state: 'visible', timeout: 60000 });
  await box.fill(title); await box.press('Enter'); await page.waitForTimeout(800);
}
async function oweMe(title, person) {
  await page.getByLabel('Add something you are waiting on to Owe Me').click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('What are you waiting on?').fill(title);
  await page.getByPlaceholder('Who owes you this?').fill(person);
  await page.getByLabel('Add to Owe Me').click();
  await page.waitForTimeout(900);
}
const tick = async title => {
  await page.getByLabel(`Mark ${title} as done`).click();
  await page.waitForTimeout(900);
};

ok('on a Wednesday there is no reckoning to open', (await week().count()) === 0,
   (await body()).slice(0, 300));

// Finished last week, which is the case a weekly summary is most likely to get
// wrong: a completed task sitting in the list looks exactly like this week's.
// Added last week and never given a date. Its dueDate is the stamp the app puts
// on everything, so by the Friday it is nine days "past" a date nobody chose —
// which is exactly the task that would flood the Slipped list if the rule about
// default stamps were not doing its work. Added here rather than on the Friday
// deliberately: the browser's clock is pinned, so a task made on the Friday
// carries a stamp equal to the very instant the page is reckoning from, and
// would pass the test whether the rule existed or not.
await toDo('Cancel the gym membership');

await toDo("Last week's board pack");
await tick("Last week's board pack");
ok('last week left two tasks behind it',
   (await body()).includes('Cancel the gym membership'), (await body()).slice(0, 400));
await page.waitForTimeout(1200);

// ── The Friday ──────────────────────────────────────────────────────────────
await page.clock.setFixedTime(THE_FRIDAY);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
// Waited for rather than slept through. Unlocking runs the key derivation
// twice, and on a loaded machine that has taken long enough to leave the page
// with no inputs on it at all — at which point a fixed sleep hands the next
// step an empty document and the suite dies somewhere unrelated.
await page.getByLabel('Search').first()
  .waitFor({ state: 'visible', timeout: 120000 }).catch(() => {});
await page.waitForTimeout(1500);

ok('on the Friday it is there to open', (await week().count()) === 1, (await body()).slice(0, 400));

await toDo('Approve the budget');
await tick('Approve the budget');
await toDo('Pay the invoice at 9am');
await toDo('Quarterly review Monday 10am');
await oweMe('The signed inventory', 'Marchetti');

await week().click();
await page.waitForTimeout(1200);

// The sheet's own words. A modal on the web does not remove the page behind it
// from the document, so reading document.innerText here would let the row
// underneath answer for the reckoning — and "Cancel the gym membership" is
// sitting right there on the list, which is the assertion that would quietly
// stop meaning anything.
const sheet = await page.locator('[data-weeksheet]').first().innerText();

// ── What it says ────────────────────────────────────────────────────────────
ok('the week opens on one honest line',
   /1 done\s+·\s+1 slipped\s+·\s+1 waiting on 1 person/.test(sheet), sheet.slice(0, 300));

ok('what was finished is named', sheet.includes('Approve the budget'), sheet.slice(0, 600));
ok('and last week\'s work is not this week\'s', !sheet.includes('board pack'), sheet.slice(0, 600));

ok('what slipped is named', sheet.includes('Pay the invoice'), sheet.slice(0, 900));
ok('with the date it went past', /was due/i.test(sheet), sheet.slice(0, 900));

ok('who is holding something of yours', sheet.includes('Marchetti'), sheet.slice(0, 900));
ok('and what they are holding', sheet.includes('The signed inventory'), sheet.slice(0, 900));
ok('with how long it has been', /asked/i.test(sheet), sheet.slice(0, 900));

ok('what next week already holds', sheet.includes('Quarterly review'), sheet.slice(0, 900));

// The one that would ruin the page if it were wrong: every task carries a date
// whether or not anybody chose one, and counting those would put most of the
// app under Slipped.
ok('a task nobody dated has not slipped', !sheet.includes('Cancel the gym membership'),
   sheet.slice(0, 900));

ok('all four questions are asked',
   /FINISHED/i.test(sheet) && /SLIPPED/i.test(sheet)
   && /WAITING ON/i.test(sheet) && /NEXT WEEK/i.test(sheet), sheet.slice(0, 400));

// ── Read aloud ──────────────────────────────────────────────────────────────
//
// A heading and the number under it are one fact. Announced separately, the
// reader hears "Slipped", moves on, and the count is a stop of its own.
for (const [name, said] of [['Finished', 'Finished: 1'], ['Slipped', 'Slipped: 1'],
                            ['Waiting on', 'Waiting on: 1'], ['Next week', 'Next week: 1']]) {
  ok(`${name.toLowerCase()} is announced with its count`,
     (await page.getByLabel(said, { exact: true }).count()) === 1, said);
}
ok('and the number is not read out a second time',
   (await page.locator('[data-weeksheet] [aria-hidden="true"]').count()) >= 4,
   String(await page.locator('[data-weeksheet] [aria-hidden="true"]').count()));
ok('the way out is named',
   (await page.getByLabel('Close the week').count()) === 1);
// The accessibility sweep opens the briefing and not this page, so its twin
// went unchecked — and the shared header is exactly where the target shrank.
{
  const box = await page.getByLabel('Close the week').boundingBox();
  ok('and big enough to hit', box && box.height >= 24 && box.width >= 24,
     box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no box');
}

if (process.env.SHOT) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: process.env.SHOT, fullPage: true });
}

// ── And closes ──────────────────────────────────────────────────────────────
// (the briefing block below reopens nothing, so this stays where it is)
await page.getByLabel('Close the week').click();
await page.waitForTimeout(900);
const after = await body();
ok('it closes and leaves the page as it was', !/FINISHED/i.test(after), after.slice(0, 300));
ok('with the list still there', after.includes('Pay the invoice'), after.slice(0, 400));

// ── The day, briefed ────────────────────────────────────────────────────────
//
// The morning's version of the same page. It used to be a different app — an
// iOS-blue card, a percentage bar and a line of encouragement — and the thing
// worth testing about the rewrite is that it now asks the day's questions and
// says nothing else.
{
  await page.getByLabel('Open the daily briefing').click();
  await page.waitForTimeout(1200);
  const brief = await page.locator('[data-briefsheet]').first().innerText();

  // Two: the gym membership sitting on today's page, and the invoice dated for
  // today. The quarterly review is next week's and the board pack is finished.
  ok('the day opens on one honest line',
     /2 today/.test(brief) && /1 waiting on 1 person/.test(brief), brief.slice(0, 300));
  ok('and says what has been finished', /1 thing finished today/.test(brief),
     brief.slice(0, 300));

  ok('the morning asks its own four questions',
     /LATE/i.test(brief) && /TODAY/i.test(brief)
     && /WAITING ON/i.test(brief) && /TOMORROW/i.test(brief), brief.slice(0, 400));
  // In date order, and what somebody else owes you last: it is rarely today's
  // deadline, and reading it between tomorrow and the rest broke the spine of
  // the page.
  ok('and reads them in the order the days come',
     brief.indexOf('LATE') < brief.indexOf('TODAY')
     && brief.indexOf('TODAY') < brief.indexOf('TOMORROW')
     && brief.indexOf('TOMORROW') < brief.indexOf('WAITING ON'),
     brief.slice(0, 400));

  // Due at nine this morning, read at three this afternoon. Late in the day's
  // terms is not late in the week's: the weekly page calls it slipped from the
  // moment the hour passes, and the morning only counts what was dated before
  // today, or the section would fill up with things you are simply partway
  // through.
  ok('what is dated today is today\'s, not yesterday\'s failure',
     brief.includes('Pay the invoice'), brief.slice(0, 600));
  ok('nothing is carried over', /Nothing carried over/i.test(brief), brief.slice(0, 600));

  ok('who is holding something of yours', brief.includes('Marchetti'), brief.slice(0, 900));
  ok('and how long', /asked/i.test(brief), brief.slice(0, 900));

  ok('nothing is dated tomorrow', /Nothing dated tomorrow/i.test(brief), brief.slice(0, 900));

  // The whole point of the rewrite.
  ok('and it does not tell you that you have got this',
     !/you.?ve got this|small progress|future self|one task at a time/i.test(brief),
     brief.slice(0, 900));
  ok('nor score the day out of a hundred', !/%/.test(brief), brief.slice(0, 900));

  await page.getByLabel('Close the briefing').click();
  await page.waitForTimeout(900);
  ok('and it closes', !/LATE/i.test(await body()), (await body()).slice(0, 300));
}

// ── A task comes to meet the day ────────────────────────────────────────────
//
// The three pages are a horizon, not three folders. A thing put on the week
// because it was due Friday is, on Friday, a thing for today — and walking it
// across by hand is a chore that fails in the worst possible way when you
// forget it, because the one thing due today is then the one thing not on
// today's page.
{
  await page.getByLabel('Show week tasks').click();
  await page.waitForTimeout(700);
  await toDo('Call the auditors at 4pm');

  // Filed on the week, dated for today.
  ok('it is not left sitting on the week',
     !(await body()).includes('Call the auditors'), (await body()).slice(0, 600));

  await page.getByLabel('Show day tasks').click();
  await page.waitForTimeout(700);
  const dayPage = await body();
  ok('it has come to today\'s page on its own',
     dayPage.includes('Call the auditors'), dayPage.slice(0, 700));
  ok('and says where it came from, so the page does not look wrong',
     /from the week/i.test(dayPage), dayPage.slice(0, 700));

  // The negative half, and the one that matters: a week task whose date is
  // still ahead stays where it was put. Without this the whole of the week
  // would arrive on the day, because every task carries a date whether or not
  // anybody chose one.
  ok('while one still ahead of itself stays on the week',
     !dayPage.includes('Quarterly review'), dayPage.slice(0, 700));

  await page.getByLabel('Show week tasks').click();
  await page.waitForTimeout(700);
  ok('which is where it still is', (await body()).includes('Quarterly review'),
     (await body()).slice(0, 600));
  await page.getByLabel('Show day tasks').click();
  await page.waitForTimeout(700);
}

// ── Tomorrow, the night before ──────────────────────────────────────────────
//
// The moment anybody wants to know what tomorrow holds is the evening before,
// not at seven the next morning when it is too late to have thought about it.
// So the day turns over at nine while there is still an evening left in it.
//
// Dated Monday rather than tomorrow on purpose: typing "tomorrow" files a task
// on the day's page at the moment it is written, so it would never have to
// travel and would prove nothing about whether it can.
{
  await page.getByLabel('Show week tasks').click();
  await page.waitForTimeout(700);
  await toDo('Call Bob Monday at 11am');
  ok('a thing for Monday sits on the week on Friday',
     (await body()).includes('Call Bob'), (await body()).slice(0, 700));

  await page.getByLabel('Show day tasks').click();
  await page.waitForTimeout(700);
  ok('and is not on today\'s page', !(await body()).includes('Call Bob'),
     (await body()).slice(0, 700));

  // Sunday evening, eight o'clock. Still the week's.
  await page.clock.setFixedTime(new Date('2026-10-04T20:00:00'));
  await page.waitForTimeout(22000);
  ok('nor at eight the evening before', !(await body()).includes('Call Bob'),
     (await body()).slice(0, 700));

  // Half past nine. The page works the horizon out on a twenty-second timer —
  // the same one that raises reminders — so it catches up within a tick rather
  // than at the instant the clock passes nine, and the test waits that out
  // rather than pretending otherwise.
  await page.clock.setFixedTime(new Date('2026-10-04T21:30:00'));
  await page.waitForTimeout(22000);
  const evening = await body();
  ok('by half past nine it has come to today\'s page', evening.includes('Call Bob'),
     evening.slice(0, 800));
  ok('saying when it is due', /Tomorrow 11:00/.test(evening), evening.slice(0, 800));
  ok('and where it came from, so the page does not look wrong',
     /from the week/i.test(evening), evening.slice(0, 800));

  // The other Monday task comes with it, which is right — it is the same
  // evening and the same tomorrow.
  ok('and everything else for tomorrow comes with it',
     evening.includes('Quarterly review'), evening.slice(0, 800));
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
