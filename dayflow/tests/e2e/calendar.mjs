// The hours that are already spoken for.
//
// Every page in this app used to treat a day as an empty container to put tasks
// into. This is the test for the day knowing better: a calendar is imported,
// and the list underneath is read against a diary rather than against nothing.
//
// The clock is pinned, because a diary is nothing but dates and a suite that
// ran on a different Tuesday would be testing a different day.
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
await new Promise(r => server.listen(4843, r));

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

// Friday 2 October 2026, half past eight in the morning: early enough that most
// of the day is still ahead, which is the only time this page is worth reading.
await page.clock.setFixedTime(new Date('2026-10-02T08:30:00'));

await page.goto('http://localhost:4843/Claude/', { waitUntil: 'networkidle' });
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
// The day's page draws the diary and carries the sentence as the drawing's
// label; a week or a month has no shape to draw and shows the sentence itself.
// Both are the same words, so both are read the same way here.
const diaryLine = async () => {
  const line = page.locator('[data-diaryline]');
  if (!(await line.count())) return null;
  const first = line.first();
  return (await first.getAttribute('aria-label')) || (await first.innerText());
};
async function toDo(title) {
  const box = page.getByPlaceholder('Write a line…');
  await box.waitFor({ state: 'visible', timeout: 60000 });
  await box.fill(title); await box.press('Enter'); await page.waitForTimeout(800);
}

// A working Friday: a standup, a long board call, one double booking that must
// not be counted twice, an all-day note that is not six hours of meetings, and
// a weekly one-to-one that started a month ago and has to be worked out rather
// than read off the page.
const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Work',
  'BEGIN:VEVENT', 'UID:standup@x', 'SUMMARY:Standup',
  'DTSTART;TZID=Europe/London:20261002T090000', 'DURATION:PT30M', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:board@x', 'SUMMARY:Board call',
  'DTSTART;TZID=Europe/London:20261002T110000', 'DTEND;TZID=Europe/London:20261002T123000',
  'END:VEVENT',
  'BEGIN:VEVENT', 'UID:double@x', 'SUMMARY:Double booked',
  'DTSTART;TZID=Europe/London:20261002T120000', 'DTEND;TZID=Europe/London:20261002T130000',
  'END:VEVENT',
  'BEGIN:VEVENT', 'UID:leave@x', 'SUMMARY:Team offsite week',
  'DTSTART;VALUE=DATE:20261002', 'DTEND;VALUE=DATE:20261003', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:oneone@x', 'SUMMARY:One to one',
  'DTSTART;TZID=Europe/London:20260904T160000', 'DURATION:PT30M', 'RRULE:FREQ=WEEKLY',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

await toDo('Approve the budget');

ok('with no calendar, the page says nothing about one', (await diaryLine()) === null,
   String(await diaryLine()));

// ── Importing one ───────────────────────────────────────────────────────────
await page.getByLabel('Account settings').click();
await page.waitForTimeout(900);
ok('the account offers to read one',
   (await page.getByText('Read a calendar', { exact: true }).count()) === 1,
   (await body()).slice(0, 500));

// Anything can be chosen now, so what keeps a wrong file out is reading it
// rather than filtering the picker. An accept list is a hint on a desktop and a
// rule on iOS, where a type it does not recognise greys the file out — and a
// calendar exported from Proton could not be selected at all.
{
  const [wrong] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Read a calendar', { exact: true }).click(),
  ]);
  await wrong.setFiles({
    name: 'notes.txt', mimeType: 'text/plain',
    buffer: Buffer.from('shopping list\nmilk\nbread'),
  });
  await page.waitForTimeout(1200);
  ok('something that is not a calendar is named as such',
     /not a calendar/i.test(await body()), (await body()).slice(0, 700));
  ok('and nothing is remembered from it',
     (await page.getByText('Forget the calendar', { exact: true }).count()) === 0);
}

const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByText('Read a calendar', { exact: true }).click(),
]);
await chooser.setFiles({ name: 'work.ics', mimeType: 'text/calendar', buffer: Buffer.from(ICS) });
await page.waitForTimeout(1500);

ok('and says what it found', /Read 5 events from Work/i.test(await body()), (await body()).slice(0, 700));
// And how much of it is any use. A file can parse perfectly and still show
// nothing, and the two numbers are the difference between those cases.
ok('and how much of it is ahead of you',
   /in the next three weeks/i.test(await body()), (await body()).slice(0, 700));
ok('and offers to forget it again',
   (await page.getByText('Forget the calendar', { exact: true }).count()) === 1);

// ── And the row itself says both numbers, afterwards ──
//
// The confirmation above is a sentence about the last two seconds. The row is
// what somebody reads a week later wondering why their day looks empty, and it
// used to say "TA · 1 ahead · read today" — which cannot be acted on, because a
// calendar of four hundred meetings with one coming up and a calendar holding
// one meeting read exactly the same and need opposite fixes.
{
  // Back out to the list the row lives on: reading a file leaves the sheet on
  // the calendar page, and the row is on the page behind it.
  await page.getByLabel('Close account settings').click();
  await page.waitForTimeout(900);
  await page.getByLabel('Account settings').click();
  await page.waitForTimeout(1100);

  const row = await body();
  ok('the calendar row says how much is written down',
     /\d+ entr(y|ies)/.test(row), row.slice(0, 900));
  ok('and how much of it is coming up, as a separate number',
     /\d+ coming up|none coming up/.test(row), row.slice(0, 900));
  ok('and when it last read it', /read (today|yesterday|\d)/i.test(row), row.slice(0, 900));
}

await page.getByLabel('Close account settings').click();
await page.waitForTimeout(1500);

// ── What the day now says ───────────────────────────────────────────────────
{
  const line = await diaryLine();
  ok('the day now knows what is booked', !!line, String(line));

  // 09:00–09:30, 11:00–13:00 (the double booking merged into the board call),
  // and 16:00–16:30 worked out from a rule. Three hours, not four.
  ok('and counts overlapping meetings once', /3h booked/.test(line || ''), String(line));
  // It is half past eight, so the free stretch already running is said as
  // "until" — the hour it started is behind you.
  ok('and leads with where the free time is',
     /^Free until 09:00, then 09:30–11:00/.test(line || ''), String(line));
  ok('the rest of them counted rather than listed', /and 2 more/.test(line || ''), String(line));
  ok('an all-day note books no hours', !/(1[0-9]|2[0-9])h booked/.test(line || ''), String(line));
  // "6h 30m free" was the third of three facts separated by identical dots,
  // and it was the one the drawing makes redundant: the empty track is what is
  // left. One sentence, two clauses, in that order.
  ok('and does not also count the free hours', !/free/.test(line || ''), String(line));
}

// ── The day is drawn, not only described ────────────────────────────────────
//
// A hairline from the hour the day opens to the hour it closes, the booked
// stretches inked in, and one figure under it. Where the free time is becomes
// something you see instead of something you parse.
{
  const bar = page.locator('[data-daybar]');
  ok('the day has a shape on the page', (await bar.count()) === 1,
     String(await bar.count()));

  const seen = await bar.first().innerText();
  ok('the two ends of the day are the ruler', /08:00/.test(seen) && /18:00/.test(seen), seen);
  ok('and the one figure under it is what is booked', /3h booked/.test(seen), seen);
  ok('with no dotted list of facts left on it', !seen.includes('·'), seen);

  const blocks = await page.$$eval('[data-daybar] [data-booked]', nodes =>
    nodes.map(n => ({ left: n.offsetLeft, width: n.offsetWidth })));
  // The standup, the board call with the double booking inside it, and the
  // one-to-one. Three blocks, because overlapping meetings are one block.
  ok('one block per stretch of booked time, overlaps merged',
     blocks.length === 3, JSON.stringify(blocks));
  ok('in the order the day happens',
     blocks.every((b, i) => i === 0 || b.left > blocks[i - 1].left), JSON.stringify(blocks));
  ok('each one wide enough to see',
     blocks.every(b => b.width >= 2), JSON.stringify(blocks));
  ok('and surface between them, so the morning does not read as one block',
     blocks.every((b, i) => i === 0 || b.left - (blocks[i - 1].left + blocks[i - 1].width) >= 2),
     JSON.stringify(blocks));
  // Half past eight of a ten-hour day: a twentieth of the way along.
  const tick = await page.$$eval('[data-daybar] [data-nowtick]', nodes =>
    nodes.map(n => ({ left: n.offsetLeft, width: n.parentElement.offsetWidth })));
  ok('and a tick for where you are standing', tick.length === 1, JSON.stringify(tick));
  ok('at the right hour of it',
     tick.length === 1 && Math.abs(tick[0].left / tick[0].width - 0.05) < 0.02,
     JSON.stringify(tick));
}

// ── Putting something in the free time ──────────────────────────────────────
//
// The one move the diary could describe and never make. The strip knows the
// afternoon is free and the list knows what is open, and until now joining
// those two facts happened in somebody's head.
{
  const bar = page.locator('[data-daybar]').first();
  const box = await bar.boundingBox();
  ok('the strip is there to be tapped', !!box, String(box));

  // Three quarters along the day, which is the late afternoon.
  await page.mouse.click(box.x + box.width * 0.75, box.y + 6);
  await page.waitForTimeout(900);

  const sheet = await body();
  ok('tapping the strip offers the free time', /Free time/i.test(sheet), sheet.slice(0, 300));
  ok('and says how much of it there is, and from when',
     /free from \d\d:\d\d/i.test(sheet), sheet.slice(0, 400));

  const offered = page.locator('[data-plantask]');
  ok('with something to put in it', (await offered.count()) > 0,
     String(await offered.count()));

  // A task that already has a time is placed; offering it again would be
  // offering to move it, which is a different question.
  const names = await offered.allInnerTexts();
  ok('and not the task that already has an hour',
     !names.some(n => /Approve the budget at/i.test(n)), names.join(' | '));

  // ── Tapping the title opens the task ──
  //
  // It used to place the task in the gap, so a list of titles was a list where
  // tapping a title did something other than open it, and the only sign of what
  // had happened was a banner at the far end of the screen with Undo in it.
  // Everywhere else in this app, and on the Due sheet this one is modelled on, a
  // title opens.
  await offered.first().click();
  await page.waitForTimeout(1300);
  const opened = await body();
  ok('tapping a title opens that task in full', /Edit Task/i.test(opened),
     opened.slice(0, 300));
  ok('and nothing was quietly given an hour instead',
     !/Undo/i.test(opened), opened.slice(0, 400));
  await page.getByText('Cancel', { exact: true }).last().click();
  await page.waitForTimeout(900);

  // One more to place, because an afternoon that holds three hours proves
  // nothing with a single task in the list.
  await toDo('Second thing to place');

  // Back to the strip, and this time the control that places it — which says
  // the hour it would use, because that is the sheet's whole purpose.
  {
    const where = await page.locator('[data-daybar]').first().boundingBox();
    await page.mouse.click(where.x + where.width * 0.5, where.y + 6);
    await page.waitForTimeout(1100);
  }
  // The long stretch rather than whichever the tap landed on: 16:30-18:00 holds
  // exactly one hour, and a gap with room for one cannot show that the second
  // task is offered a different hour from the first.
  await page.getByLabel('Free 13:00 to 16:00').click();
  await page.waitForTimeout(800);

  const at = page.locator('[data-planat]');
  ok('every row offers an hour to put the task at', (await at.count()) > 0,
     String(await at.count()));
  ok('and the hour is named on it, not hidden in a label',
     /^\d\d:\d\d$/.test((await at.first().innerText()).trim()),
     await at.first().innerText());
  ok('and the sheet says to tap it',
     /Tap the time beside something/i.test(await body()), (await body()).slice(0, 400));

  // ── An afternoon holds more than one hour ──
  //
  // Every row used to offer the hour the gap starts at, and placing a task took
  // nothing out of the gap — so four payments placed in a row all landed at
  // 14:19: four tasks claiming the same minute, all reminding at once. Reported
  // from a real phone with fourteen payments and one free afternoon, which is
  // the first thing anybody does with this sheet.
  const firstHour = (await at.first().innerText()).trim();
  await at.first().click();
  await page.waitForTimeout(1200);

  const after = await body();
  ok('the sheet stays open so the next one can go in too',
     /free .*from \d\d:\d\d/i.test(after), after.slice(0, 400));
  ok('and the row says which hour it got, with a way back',
     /\u2192\s*\d\d:\d\d/.test(after) && /Undo/i.test(after), after.slice(0, 400));

  // The assertion this whole change exists for.
  const nextChip = page.locator('[data-planat]').filter({ hasText: /^\d\d:\d\d$/ }).first();
  const secondHour = (await nextChip.innerText()).trim();
  ok('the next row is offered the hour after it, not the same one again',
     secondHour !== firstHour, `${firstHour} then ${secondHour}`);
  ok('and it is exactly one hour later',
     (Number(secondHour.slice(0, 2)) * 60 + Number(secondHour.slice(3)))
       - (Number(firstHour.slice(0, 2)) * 60 + Number(firstHour.slice(3))) === 60,
     `${firstHour} then ${secondHour}`);

  await nextChip.click();
  await page.waitForTimeout(1100);
  const twice = await body();
  ok('so two placed in a row hold two different hours',
     twice.includes(`\u2192 ${firstHour}`) && twice.includes(`\u2192 ${secondHour}`),
     twice.slice(0, 500));
  ok('and the line says how much of the gap is left, not what there was',
     !twice.includes(`from ${firstHour}`), twice.slice(0, 400));

  // Put the second one back, because the strip assertions below were written
  // against a single plan drawn on it.
  await page.getByLabel(new RegExp(`out of ${secondHour}`)).first().click();
  await page.waitForTimeout(900);
  await page.getByText('Done', { exact: true }).first().click();
  await page.waitForTimeout(1000);

  const marks = page.locator('[data-planned]');
  ok('the plan is drawn on the strip', (await marks.count()) === 1,
     String(await marks.count()));

  // Lighter than a meeting on purpose: one is where you have to be, the other
  // is where you told yourself you would be.
  const shades = await page.evaluate(() => {
    const ink = document.querySelector('[data-booked]');
    const plan = document.querySelector('[data-planned]');
    const of = el => (el ? getComputedStyle(el).backgroundColor : '');
    return { ink: of(ink), plan: of(plan) };
  });
  ok('and in a different ink from the meetings', shades.ink !== shades.plan,
     JSON.stringify(shades));

  // The whole point: it is an ordinary task now, with an hour on it, which the
  // strip draws and the row said back when it was given one.
  ok('and the task it came from now has a time',
     new RegExp(`\u2192\\s*${firstHour}`).test(after), after.slice(0, 500));
}

// ── A day with nothing free still answers ───────────────────────────────────
//
// Past the end of a working day there is no free time left to tap, and the
// first version of this did nothing at all — no sheet, no word. A control that
// is silently dead looks exactly like one that is broken, which is the fault
// this app has spent two days taking out of everything else, shipped straight
// back in by the feature that took it out of the diary.
{
  const back = async () => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // Something to put in it. The only untimed task went into a gap further up,
  // so without this the sheet would correctly offer nothing and the assertion
  // below would be proving that rather than what it claims.
  await toDo('Write the quarterly note');

  // Seven in the evening: the day closed at six and nothing is left of it.
  await page.clock.setFixedTime(new Date('2026-10-02T19:00:00'));
  await back();
  await page.waitForTimeout(1200);

  const evening = page.locator('[data-daybar]').first();
  if (await evening.count()) {
    const where = await evening.boundingBox();
    await page.mouse.click(where.x + where.width * 0.5, where.y + 6);
    await page.waitForTimeout(900);
    const said = await body();
    ok('a tap with nothing free still opens, rather than doing nothing',
       /Tomorrow|Free time/i.test(said), said.slice(0, 300));
    // Honest and useless would be "nothing free is left today". The page is
    // already saying what tomorrow opens with two lines above the strip, so
    // tomorrow is what somebody reaching for it at seven actually wants.
    ok('and offers tomorrow, rather than shrugging about today',
       /free tomorrow from \d\d:\d\d/i.test(said), said.slice(0, 400));
    ok('naming it as tomorrow so no hour is mistaken for tonight',
       /Tomorrow/.test(said), said.slice(0, 300));

    const forTomorrow = page.locator('[data-plantask]');
    ok('with something to put in it', (await forTomorrow.count()) > 0,
       String(await forTomorrow.count()));

    // ── When, then ──
    //
    // One control with four named answers, and the result shown on the row it
    // belongs to. It used to be two buttons meaning different things — one
    // moved a date, the other moved a page — with the confirmation appearing
    // at the top of the sheet while your finger was on row nine.
    const later = page.locator('[data-laterbutton]');
    ok('every row offers to put the task off', (await later.count()) > 0,
       String(await later.count()));
    ok('and the page-move button is gone from the row',
       (await page.locator('[data-tomonth]').count()) === 0);

    // The one added for this block, not whatever sorts first: putting off a
    // task the briefing assertions are written against breaks them for a
    // reason that has nothing to do with what they check. That happened.
    const titles = await page.locator('[data-plantask]').allInnerTexts();
    const mine = titles.findIndex(x => /quarterly note/i.test(x));
    ok('the task this block added is in the list', mine >= 0, titles.join(' | ').slice(0, 300));


    await later.nth(Math.max(0, mine)).click();
    await page.waitForTimeout(500);

    const choices = await page.locator('[data-lateroption]').allInnerTexts();
    ok('it opens into named times rather than arithmetic',
       ['Tomorrow', 'Weekend', 'Next week', 'Next month'].every(x => choices.includes(x)),
       choices.join(' | '));

    await page.locator('[data-lateroption]').nth(3).click();
    await page.waitForTimeout(900);

    const done = await body();
    ok('choosing one says what it did', /Undo/i.test(done), done.slice(0, 400));
    // On the row, not at the top of the sheet: feedback belongs where the
    // action was.
    ok('and says it on the row it belongs to',
       (await page.locator('[data-laterdone]').count()) === 1,
       String(await page.locator('[data-laterdone]').count()));
    ok('and it is a month out, not today',
       !/\u2014 Fri 2 Oct/.test(done), done.slice(0, 400));

    // Put back, because the rest of this suite was written against these tasks.
    await page.getByLabel('Undo that').first().click();
    await page.waitForTimeout(900);

    // ── And the fifth answer, for the date four names cannot reach ──
    //
    // "Not this week" is one tap and should stay one tap. "The twenty-third" is
    // not reachable by any name, and a payroll run is owed on a date — so there
    // is a calendar behind the names, not instead of them.
    {
      await later.nth(Math.max(0, mine)).click();
      await page.waitForTimeout(500);

      const names = await page.locator('[data-lateroption]').allInnerTexts();
      ok('the four named times are still the first thing offered',
         names.length === 4 && names.includes('Next week'), names.join(' | '));
      ok('and a way to an exact date sits beside them, not in place of them',
         (await page.locator('[data-laterexact]').count()) === 1,
         String(await page.locator('[data-laterexact]').count()));

      await page.locator('[data-laterexact]').first().click();
      await page.waitForTimeout(900);

      const until = await body();
      ok('which opens a calendar', /Until/.test(until), until.slice(0, 300));
      ok('naming the task it is about', /quarterly note/i.test(until), until.slice(0, 400));

      // The calendar is the app's own, not a second one grown for this sheet.
      // Its days are labelled in full, which is how this picks one without
      // knowing what today is.
      const days = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')]
        .map(el => el.getAttribute('aria-label'))
        .filter(l => /^[A-Z][a-z]+ \d{1,2} [A-Z][a-z]+ \d{4}$/.test(l)));
      ok('with a month of days to choose from', days.length >= 28, String(days.length));

      const last = days[days.length - 1];
      const dayNum = Number(last.split(' ')[1]);
      await page.getByLabel(last, { exact: true }).click();
      await page.waitForTimeout(600);

      // What Set will do, in words, before you tap it — the sheet closes on
      // Set, so this is the only chance to check the day is the day you meant.
      const said1 = await page.locator('[data-whensaid]').first().innerText();
      ok('the day you tap is said back to you in words',
         new RegExp(`\\b${dayNum}\\b`).test(said1), `${said1} / wanted ${last}`);
      ok('and said the way this app says dates, not as 23/10',
         !/\d{1,2}\/\d{1,2}/.test(said1), said1);

      // A date alone means "that day". An hour is what you add when something
      // has to happen at one, and it is the app's own clock that adds it.
      ok('a date on its own carries no hour', !/\d\d:\d\d/.test(said1), said1);
      await page.locator('[data-whentime]').first().click();
      await page.waitForTimeout(700);
      await page.getByLabel('Hour 3', { exact: true }).click();
      await page.getByLabel('Minute 30', { exact: true }).click();
      await page.getByLabel('Afternoon', { exact: true }).click();
      await page.waitForTimeout(300);
      await page.getByLabel('Use this time', { exact: true }).click();
      await page.waitForTimeout(700);

      const said2 = await page.locator('[data-whensaid]').first().innerText();
      ok('and an hour added shows up in the same line', /15:30/.test(said2), said2);
      ok('on the day that was already chosen',
         new RegExp(`\\b${dayNum}\\b`).test(said2), said2);

      await page.locator('[data-whenset]').first().click();
      await page.waitForTimeout(1100);

      ok('the calendar closes once it is set', !/Until/.test(await body()),
         (await body()).slice(0, 200));
      // Reported on the row, exactly as the four named times report — a date
      // chosen in a calendar should not vanish into the task.
      // Counted before it is read. A row that was never told what happened has
      // no [data-laterdone] at all, and reading text off nothing times out after
      // thirty seconds and dies without a tally — which is a failure nobody can
      // see the shape of. Ask whether it is there first, then what it says.
      const toldCount = await page.locator('[data-laterdone]').count();
      ok('the row is told what happened at all', toldCount > 0, String(toldCount));
      const after = toldCount > 0
        ? await page.locator('[data-laterdone]').first().innerText()
        : '';
      ok('and the row says what it did, the same as the named times',
         /Undo/.test(await body()) && new RegExp(`\\b${dayNum}\\b`).test(after),
         `${after} / wanted ${last}`);
      ok('with the hour it was given', /15:30/.test(after), after);

      // Put back: the rest of this suite was written against these tasks. Only
      // if there is something to put back — otherwise a failure above becomes a
      // thirty-second timeout here and the suite dies before saying what else
      // is wrong.
      if (toldCount > 0) {
        await page.getByLabel('Undo that').first().click();
        await page.waitForTimeout(900);
      }
    }


    // ── And a box to tick ──
    //
    // A good share of what a triage pass turns up is already done or takes a
    // moment, and saying so should not mean opening the task, finishing it and
    // finding your way back to row nine.
    //
    // On a task of its own, added here and left finished. The first version of
    // this ticked the quarterly note and tried to put it back through the
    // list's own checkbox, which is not there to find once the task is done —
    // and an assertion that needs a fixture restored is an assertion waiting to
    // break the block after it.
    {
      const open = async () => {
        const where = await page.locator('[data-daybar]').first().boundingBox();
        await page.mouse.click(where.x + where.width * 0.5, where.y + 6);
        await page.waitForTimeout(1100);
      };
      const shut = async () => {
        await page.getByText('Done', { exact: true }).first().click();
        await page.waitForTimeout(800);
      };
      const listed = async () => (await page.locator('[data-plantask]').allInnerTexts());
      const rowOf = async () => (await listed()).findIndex(x => /tick me and see/i.test(x));

      await shut();
      await toDo('Tick me and see');
      await open();

      const at = await rowOf();
      ok('a task added for this is in the list', at >= 0,
         (await listed()).join(' | ').slice(0, 300));

      const boxes = page.locator('[data-plandone]');
      ok('and every row has a box to tick',
         (await boxes.count()) === (await page.locator('[data-plantask]').count()),
         `${await boxes.count()} boxes, ${await page.locator('[data-plantask]').count()} rows`);

      const box = boxes.nth(Math.max(0, at));
      ok('which starts empty', (await box.getAttribute('aria-checked')) === 'false',
         String(await box.getAttribute('aria-checked')));
      await box.click();
      await page.waitForTimeout(700);

      // Drawn, not merely announced. This control shipped once with no done
      // state at all: it completed the task and changed nothing on screen.
      const inked = await page.evaluate(() => {
        const all = document.querySelectorAll('[data-plandone]');
        const one = [...all].find(el => el.getAttribute('aria-checked') === 'true') || all[0];
        const paint = el => getComputedStyle(el).backgroundColor;
        const clear = c => /rgba\(0, 0, 0, 0\)|transparent/.test(c);
        return {
          filled: [...one.querySelectorAll('*')].map(paint).concat(paint(one))
            .some(c => !clear(c)),
          mark: one.innerText.trim(),
        };
      });
      ok('ticking it fills the box in', inked.filled, JSON.stringify(inked));
      ok('and puts a tick in it', inked.mark.length > 0, JSON.stringify(inked));
      ok('and strikes the task through',
         await page.evaluate(() => [...document.querySelectorAll('[data-plantask] *')]
           .some(el => /line-through/.test(getComputedStyle(el).textDecorationLine))));

      await box.click();
      await page.waitForTimeout(700);
      ok('and tapping again takes it back',
         (await box.getAttribute('aria-checked')) === 'false',
         String(await box.getAttribute('aria-checked')));

      // ── And the tick is a real one ──
      //
      // Everything above reads the drawing, and the drawing comes from state the
      // row keeps itself. All of it would pass just as well if the box lit up and
      // the task was never touched — the same lie the box told when it had no
      // done state, told the other way round. So: tick it, close the sheet, open
      // it again. placeable does not offer finished work, so if it is still
      // listed the tick was decoration.
      await box.click();
      await page.waitForTimeout(700);
      await shut();
      await open();
      ok('a task ticked here is actually finished, not just drawn as finished',
         (await rowOf()) < 0, (await listed()).join(' | ').slice(0, 300));
    }

    await page.getByText('Done', { exact: true }).first().click();
    await page.waitForTimeout(600);
  }

  // Put the morning back, because everything after this was written against it.
  await page.clock.setFixedTime(new Date('2026-10-02T08:30:00'));
  await back();
  await page.waitForTimeout(1200);
}

// ── And in the briefing ─────────────────────────────────────────────────────
{
  await page.getByLabel('Open the daily briefing').click();
  await page.waitForTimeout(1300);
  const brief = await page.locator('[data-briefsheet]').first().innerText();

  ok('the morning reads the diary too', /DIARY/i.test(brief), brief.slice(0, 400));
  ok('with everything in it', /Diary\s*\n?\s*5/i.test(brief) || /DIARY[\s\S]{0,8}5/.test(brief),
     brief.slice(0, 400));
  ok('the meetings are named', brief.includes('Board call') && brief.includes('Standup'),
     brief.slice(0, 700));
  ok('with their hours', brief.includes('11:00–12:30'), brief.slice(0, 700));
  ok('the all-day one says so rather than claiming an hour',
     /Team offsite week[\s\S]{0,20}all day/.test(brief), brief.slice(0, 700));
  ok('the repeating one was worked out, not read off the page',
     brief.includes('One to one') && brief.includes('16:00–16:30'), brief.slice(0, 900));
  ok('and the next thing to be somewhere for is named',
     /next at 09:00/.test(brief), brief.slice(0, 900));

  await page.getByLabel('Close the briefing').click();
  await page.waitForTimeout(900);
}

// ── The page decides how much diary you see ─────────────────────────────────
//
// The diary is read three weeks deep so that a time given to a task next
// Thursday can be checked against Thursday. Shown whole on the day's page it
// put next week's meetings in front of somebody looking at today.
{
  const line = async () => (await diaryLine()) || '';

  const howMany = text => Number((/^(\d+) meeting/.exec(text) || [])[1] || -1);

  ok('the day page measures the day', /^Free /.test(await line()), await line());

  await page.getByLabel('Show week tasks').click();
  await page.waitForTimeout(900);
  const weekLine = await line();
  ok('the week page counts the week instead', /meetings/.test(weekLine), weekLine);
  ok('and does not offer an afternoon spread over five days',
     !/free/.test(weekLine), weekLine);
  // The count, not merely the shape of the sentence. Everything in this diary
  // but the weekly one-to-one falls on the Friday, so the week holds four
  // meetings — and a window that ran three weeks on from here would sweep up
  // the one-to-ones after it and say six.
  ok('and counts this week, not as far as the diary happens to be loaded',
     howMany(weekLine) === 4, weekLine);

  await page.getByLabel('Show month tasks').click();
  await page.waitForTimeout(900);
  const monthLine = await line();
  ok('and the month counts the month', /meetings/.test(monthLine), monthLine);
  ok('which is more than the week', howMany(monthLine) > howMany(weekLine),
     `${weekLine} → ${monthLine}`);

  await page.getByLabel('Show day tasks').click();
  await page.waitForTimeout(900);
  ok('back on the day, it is a day again', /^Free /.test(await line()), await line());
}

// ── Running into something ──────────────────────────────────────────────────
//
// The cheapest moment to find out that eleven o'clock is the board call is
// before the task exists, and the second cheapest is while the time is still
// being chosen. Not a warning and not a block: you are allowed to put a task in
// the middle of a meeting, and sometimes the meeting is where you do it.
{
  const box = page.getByPlaceholder('Write a line…');
  await box.waitFor({ state: 'visible', timeout: 60000 });
  // Eleven runs into the board call and nothing else — the double booking
  // starts at half past twelve, exactly as the hour would end.
  await box.fill('Draft the resolution at 11am');
  await page.waitForTimeout(900);

  const warned = page.locator('[data-clash]');
  ok('the line says what eleven runs into', (await warned.count()) >= 1,
     (await body()).slice(0, 700));
  // The preview row is set in capitals, so the words are checked and not the
  // typography.
  const said = await warned.first().innerText();
  ok('naming the meeting', /board call/i.test(said), said);
  ok('and its hours, because half the time that settles it',
     /11:00–12:30/.test(said), said);

  // Half past eleven runs into two, and two are not listed out.
  await box.fill('Draft the resolution at 11:30am');
  await page.waitForTimeout(900);
  ok('while two are summed rather than listed',
     / and 1 other$/i.test((await page.locator('[data-clash]').first().innerText()).trim()),
     await page.locator('[data-clash]').first().innerText());

  // Three in the afternoon is clear.
  await box.fill('Draft the resolution at 3pm');
  await page.waitForTimeout(900);
  ok('and says nothing about an hour that is free',
     (await page.locator('[data-clash]').count()) === 0, (await body()).slice(0, 700));

  await box.fill('');
  await page.waitForTimeout(400);
}

// ── And in the sheet, where the time is chosen ──────────────────────────────
{
  await page.locator('text=Approve the budget').first().click();
  await page.waitForTimeout(1100);

  // The time is chosen on a drum rather than typed, so it is chosen the way a
  // person chooses it.
  const pickTime = async (period, hour, minute) => {
    await page.getByLabel(/^(Set a time|Due at .*\. Change or clear the time\.)$/).first().click();
    await page.waitForTimeout(700);
    await page.getByLabel(period).click();
    await page.getByLabel(`Hour ${hour}`, { exact: true }).click();
    await page.waitForTimeout(250);
    await page.getByLabel(`Minute ${minute}`, { exact: true }).click();
    await page.waitForTimeout(250);
    await page.getByLabel('Use this time').click();
    await page.waitForTimeout(900);
  };

  // A quarter past nine: the standup.
  await pickTime('Morning', '9', '15');
  const inSheet = page.locator('[data-clash]');
  ok('the sheet says it too', (await inSheet.count()) >= 1, (await body()).slice(-700));
  ok('naming what is there', /standup/i.test(await inSheet.first().innerText()),
     await inSheet.first().innerText());

  // Three in the afternoon is clear.
  await pickTime('Afternoon', '3', '00');
  ok('and goes quiet when the hour is moved to a free one',
     (await page.locator('[data-clash]').count()) === 0, (await body()).slice(-700));

  await page.getByText('Cancel', { exact: true }).last().click();
  await page.waitForTimeout(1100);
}

// ── What to walk in with ────────────────────────────────────────────────────
//
// The app has known there is a board call at eleven since the diary arrived,
// and had no idea that anything on the list was for it. "What am I meant to
// walk in with" was answered by memory, which is the one place it should not
// live.
{
  const box = page.getByPlaceholder('Write a line…');
  await box.waitFor({ state: 'visible', timeout: 60000 });
  await box.fill('Read the auditors letter');
  await box.press('Enter');
  await page.waitForTimeout(900);
  await box.fill('Sign the minutes');
  await box.press('Enter');
  await page.waitForTimeout(900);

  const attach = async (title, when, meeting) => {
    await page.locator(`text=${title}`).first().click();
    await page.waitForTimeout(1100);
    await page.getByLabel(`For ${meeting} at ${when}`).click();
    await page.waitForTimeout(500);
    await page.getByText('Save', { exact: true }).last().click();
    await page.waitForTimeout(1200);
  };

  await attach('Read the auditors letter', '11:00', 'Board call');
  ok('the row says what it is for', /for Board call/i.test(await body()),
     (await body()).slice(0, 800));

  await attach('Sign the minutes', '11:00', 'Board call');
  await attach('Approve the budget', '09:00', 'Standup');

  // ── And the briefing answers the question ──
  await page.getByLabel('Open the daily briefing').click();
  await page.waitForTimeout(1300);
  const brief = await page.locator('[data-briefsheet]').first().innerText();

  // Read the Diary section alone. The task titles appear further down the page
  // under Today as well, and a check that cannot tell the two apart passes
  // whether or not anything is attached to anything — which is exactly what
  // happened the first time this was written.
  const diaryPart = t => t.slice(t.indexOf('DIARY'), t.indexOf('LATE'));
  const diary = diaryPart(brief);

  ok('the meeting says how much is riding on it',
     /Board call[\s\S]{0,60}2 things, 2 still to do/.test(diary), diary);
  ok('and names them, under the meeting',
     /Board call[\s\S]{0,200}Read the auditors letter/.test(diary), diary);
  ok('all of them', /Board call[\s\S]{0,240}Sign the minutes/.test(diary), diary);
  ok('the other meeting keeps its own', /Standup[\s\S]{0,60}1 thing, 1 still to do/.test(diary),
     diary);
  ok('and a meeting nobody prepared for says nothing about it',
     !/One to one[\s\S]{0,40}thing/.test(diary), diary);

  await page.getByLabel('Close the briefing').click();
  await page.waitForTimeout(900);

  // ── Finishing one shows in the count ──
  await page.getByLabel('Mark Sign the minutes as done').click();
  await page.waitForTimeout(1000);
  await page.getByLabel('Open the daily briefing').click();
  await page.waitForTimeout(1300);
  const after = await page.locator('[data-briefsheet]').first().innerText();
  const afterDiary = diaryPart(after);
  ok('finishing one is counted, not hidden',
     /Board call[\s\S]{0,60}2 things, 1 still to do/.test(afterDiary), afterDiary);
  ok('and the finished one is still listed, ticked',
     /✓\s+Sign the minutes/.test(afterDiary), afterDiary);

  await page.getByLabel('Close the briefing').click();
  await page.waitForTimeout(900);
}

// ── Forgetting it ───────────────────────────────────────────────────────────
await page.getByLabel('Account settings').click();
await page.waitForTimeout(900);
await page.getByText('Forget the calendar', { exact: true }).click();
await page.waitForTimeout(900);
await page.getByLabel('Close account settings').click();
await page.waitForTimeout(1300);
ok('forgetting it puts the page back as it was', (await diaryLine()) === null,
   String(await diaryLine()));

// ── Coming back to the app re-reads the diary ──
//
// A calendar subscribed through the phone — a Proton share link, say — is
// refreshed by iOS on its own schedule, so an event added elsewhere lands in
// the phone's calendar while DayFlow is in the background. Read only at unlock,
// the day then says the wrong thing until the next launch, and nothing about
// that is visible from the outside.
//
// The feed is removed from storage directly rather than through the app, which
// is the whole point: the app must not know it has changed. Deleting a key
// needs no encryption key, so this can be done from outside the vault exactly
// as another device would.
{
  // The section above forgot the calendar, so put one back.
  await page.getByLabel('Account settings').click();
  await page.waitForTimeout(900);
  const [again] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Read a calendar', { exact: true }).click(),
  ]);
  await again.setFiles({ name: 'work.ics', mimeType: 'text/calendar', buffer: Buffer.from(ICS) });
  await page.waitForTimeout(1500);
  await page.getByLabel('Close account settings').click();
  await page.waitForTimeout(1200);

  ok('the diary is on the page to begin with', (await diaryLine()) !== null, String(await diaryLine()));

  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dayflow', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete('@dayflow_calendar_v1');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  });

  // Still on screen: nothing has told the app to look again.
  await page.waitForTimeout(400);
  ok('taking the calendar away behind its back changes nothing on its own',
     (await diaryLine()) !== null, String(await diaryLine()));

  // Long enough that the return is treated as one. Below this it is the flurry
  // a phone reports around a control centre pull rather than somebody coming
  // back, and is deliberately ignored.
  //
  // The clock has to be moved rather than waited out: this suite pins the time
  // so that a Friday's meetings mean the same thing on every day it runs, and a
  // pinned clock makes every elapsed-time check read zero however long the test
  // sleeps.
  await page.clock.setFixedTime(new Date('2026-10-02T08:31:00'));

  // react-native-web listens to the document rather than to a phone's
  // lifecycle, so this is what "the app came back" looks like in a browser.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1500);

  ok('and coming back to it reads the calendar again',
     (await diaryLine()) === null, String(await diaryLine()));
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
