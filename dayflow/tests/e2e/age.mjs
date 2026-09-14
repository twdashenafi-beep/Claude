// How long a task has been sitting there, on the row.
//
// Neither column said anything at all about time, so one raised this morning
// and one raised in July read exactly alike. What has to be proved is both
// halves of it — that a long wait says so and turns red, that a long-carried
// task says so and does not, and that neither speaks while it is new, because a
// line remarking on every row is noise you learn to skip past.
//
// The waiting is made by moving the browser's clock forward rather than by
// writing a date into storage: the vault is encrypted, and more to the point a
// test that forges its own input proves nothing about the path the app takes.
// So the task is made the way you would make it, and then it is simply looked
// at later. Only Date is shifted — timers still run at real speed — so nothing
// in the app has to survive a leap it would never see in life.
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
await new Promise(r => server.listen(4812, r));

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

const ctx = await browser.newContext({ serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('pageerror', e => console.log(`  page error: ${e}`));
// Only `new Date()` and `Date.now()` move, and only by what the page has been
// told to shift by. Timers are left alone, so the app is looked at on a later
// day rather than made to live through one.
await page.addInitScript(() => {
  let ms = 0;
  try { ms = Number(localStorage.getItem('__clock_shift') || 0) || 0; } catch { /* first load */ }
  if (!ms) return;
  const Real = Date;
  function Shifted(...args) {
    // Called without `new` it is meant to return a string, as Date() does.
    if (!(this instanceof Shifted)) return Real();
    return args.length === 0 ? new Real(Real.now() + ms) : new Real(...args);
  }
  // Instances are real Dates, so every method and `instanceof` still holds.
  Shifted.prototype = Real.prototype;
  Shifted.now = () => Real.now() + ms;
  Shifted.parse = Real.parse;
  Shifted.UTC = Real.UTC;
  window.Date = Shifted;
});
await page.route(u => u.hostname === 'stubproject.supabase.co', route);
await page.goto('http://localhost:4812/Claude/', { waitUntil: 'networkidle' });
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

const body = async () => page.evaluate(() => {
  const notices = [...document.querySelectorAll('[data-notice]')].map(el => el.innerText);
  return notices.reduce((t, n) => t.split(n).join(''), document.body.innerText);
});

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
  await box.fill(title);
  await box.press('Enter');
  await page.waitForTimeout(800);
}

// Moves the page's clock, which the init script above reads on every load.
// A fresh init script per jump would stack instead: the second would wrap the
// first's already-shifted Date, and the days would compound quietly.
const DAY = 86400000;
async function moveTo(days) {
  await page.evaluate(ms => localStorage.setItem('__clock_shift', String(ms)), days * DAY);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  // The key only ever lives in memory, so a reload always asks for the password
  // again — by design.
  await page.locator('input, textarea').nth(0).fill(USER.email);
  await page.locator('input, textarea').nth(1).fill('a strong master password');
  await page.getByText('UNLOCK', { exact: false }).first().click();
  await page.waitForTimeout(3500);
}

// ── Today says nothing ──
await oweMe('The signed inventory', 'Marchetti');
await oweMe('The deposit back', 'Okafor');
await toDo('Cancel the gym membership');
let text = await body();
ok('the chase is listed', text.includes('The signed inventory'), text.slice(0, 300));
ok('and the person with it', text.includes('Marchetti'));
ok('asked for today, the row says nothing about waiting',
   !/waiting \d/.test(text), text.slice(0, 400));

// ── Two days in, it speaks ──
await moveTo(3);
text = await body();
ok('three days later it says how long', /waiting 3 days/.test(text), text.slice(0, 500));
ok('both chases say it', (text.match(/waiting \d+ days/g) || []).length === 2,
   JSON.stringify(text.match(/waiting \d+ days/g)));
// Asked of the row itself. The page's text is one flat run, so a plain scan
// for the title followed by "waiting" finds the next column's row instead and
// passes or fails for the wrong reason.
const rowSays = async (title) => page.evaluate((t) => {
  const el = [...document.querySelectorAll('[aria-label]')]
    .find(e => (e.getAttribute('aria-label') || '').startsWith(t));
  return el ? el.getAttribute('aria-label') : null;
}, title);
ok('and the To Do says nothing — three days is not avoidance',
   !/waiting|carried/.test(await rowSays('Cancel the gym membership') || ''),
   String(await rowSays('Cancel the gym membership')));

// Found here rather than in the due tests, because it only shows once the clock
// has moved: `dueDate` falls back to the moment a task was made, so from the
// morning after, every undated task on the page read "Overdue". Three rows,
// nobody having chosen a single date between them.
ok('and nothing undated has quietly become overdue', !/Overdue/.test(text), text.slice(0, 500));

// It is not late yet, so it must be in the same quiet grey as the rest of the
// line. Red that starts on day three would mean nothing by day thirty.
const GREY = 'rgb(87, 83, 75)';
const penFor = async (needle) => page.evaluate((n) => {
  const el = [...document.querySelectorAll('*')]
    .find(e => e.children.length === 0 && (e.innerText || '').trim() === n);
  if (!el) return null;
  const c = getComputedStyle(el);
  return { colour: c.color, weight: c.fontWeight };
}, needle);

let pen = await penFor('waiting 3 days');
ok('a short wait is its own element', pen !== null);
ok('and is drawn in the ordinary grey', pen && pen.colour === GREY, JSON.stringify(pen));

// ── Past a fortnight it is late, and looks it ──
await moveTo(20);
text = await body();
ok('three weeks later it counts in weeks', /waiting 3 weeks/.test(text), text.slice(0, 500));
ok('and no longer in days', !/waiting \d+ days/.test(text), text.slice(0, 500));

pen = await penFor('waiting 3 weeks');
ok('a stale chase is drawn in the red pen', pen && pen.colour !== GREY, JSON.stringify(pen));
ok('and in bold, like an overdue task', pen && Number(pen.weight) >= 700, JSON.stringify(pen));

// ── And the other column admits what it has been carrying ──
//
// Same length of time, opposite meaning: nobody else is late, you are. So it
// says so and then says it quietly, because a sheet that turns your own backlog
// red is a red sheet for whoever needs the signal most.
ok('a task carried three weeks says so',
   /carried 3 weeks/.test(await rowSays('Cancel the gym membership') || ''),
   String(await rowSays('Cancel the gym membership')));
ok('and it is not called waiting — nobody owes you your own task',
   !/waiting/.test(await rowSays('Cancel the gym membership') || ''),
   String(await rowSays('Cancel the gym membership')));

pen = await penFor('carried 3 weeks');
ok('what you are carrying is its own element', pen !== null);
ok('and stays in the ordinary grey', pen && pen.colour === GREY, JSON.stringify(pen));
ok('and is not bolded either', pen && Number(pen.weight) < 700, JSON.stringify(pen));

// The two columns must say a length of time the same way, or the page has two
// voices.
ok('both columns word three weeks identically',
   /waiting 3 weeks/.test(text) && /carried 3 weeks/.test(text), text.slice(0, 600));

// A picture of the thing, on a phone, when SHOT names a file. The label has to
// survive a narrow column beside the person's name, which is a matter of
// looking rather than asserting.
if (process.env.SHOT) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: process.env.SHOT, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
}

// ── A screen reader hears it too ──
const spoken = await rowSays('The signed inventory');
ok('the row announces the wait', /waiting 3 weeks/.test(spoken || ''), String(spoken));
ok('along with who it is with', /Marchetti/.test(spoken || ''), String(spoken));

// ── Getting it stops the counting ──
ok('both chases are counted before one arrives',
   (text.match(/waiting 3 weeks/g) || []).length === 2,
   JSON.stringify(text.match(/waiting 3 weeks/g)));
await page.getByLabel('Mark The signed inventory as done').click();
await page.waitForTimeout(900);
text = await body();
ok('a chase that arrived is no longer counted',
   (text.match(/waiting 3 weeks/g) || []).length === 1, text.slice(0, 600));

// ── And it is a reading of the clock, not a stored string ──
//
// The label is computed each time the row is drawn, so it has to have moved on
// its own by the following month — with nothing written and nothing synced.
await moveTo(75);
text = await body();
ok('months later it has counted itself on', /waiting (2|3) months/.test(text), text.slice(0, 500));
ok('and did not freeze at the old wording', !/waiting 3 weeks/.test(text), text.slice(0, 500));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
