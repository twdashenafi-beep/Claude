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
const diaryLine = async () => {
  const line = page.locator('[data-diaryline]');
  return (await line.count()) ? line.first().innerText() : null;
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

const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByText('Read a calendar', { exact: true }).click(),
]);
await chooser.setFiles({ name: 'work.ics', mimeType: 'text/calendar', buffer: Buffer.from(ICS) });
await page.waitForTimeout(1500);

ok('and says what it found', /Read 5 events from Work/i.test(await body()), (await body()).slice(0, 700));
ok('and offers to forget it again',
   (await page.getByText('Forget the calendar', { exact: true }).count()) === 1);

await page.getByLabel('Close account settings').click();
await page.waitForTimeout(1500);

// ── What the day now says ───────────────────────────────────────────────────
{
  const line = await diaryLine();
  ok('the day now knows what is booked', !!line, String(line));

  // 09:00–09:30, 11:00–13:00 (the double booking merged into the board call),
  // and 16:00–16:30 worked out from a rule. Three hours, not four.
  ok('and counts overlapping meetings once', /3h booked/.test(line || ''), String(line));
  // Half past eight to six is nine and a half hours; three of them are gone.
  ok('with what is left after them', /6h 30m free/.test(line || ''), String(line));
  ok('and says where the gaps are', /Free 08:30–09:00, 09:30–11:00/.test(line || ''), String(line));
  ok('the rest of them counted rather than listed', /and 2 more/.test(line || ''), String(line));
  ok('an all-day note books no hours', !/(1[0-9]|2[0-9])h booked/.test(line || ''), String(line));
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

// ── Forgetting it ───────────────────────────────────────────────────────────
await page.getByLabel('Account settings').click();
await page.waitForTimeout(900);
await page.getByText('Forget the calendar', { exact: true }).click();
await page.waitForTimeout(900);
await page.getByLabel('Close account settings').click();
await page.waitForTimeout(1300);
ok('forgetting it puts the page back as it was', (await diaryLine()) === null,
   String(await diaryLine()));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
