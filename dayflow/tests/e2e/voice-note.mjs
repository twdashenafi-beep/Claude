// Voice notes on a task that already exists.
//
// Two things were wrong, and the second is the one that mattered.
//
// A note could only ever be attached in the seconds before a task existed. The
// moment you pressed Add, the offer was withdrawn for good — so the one time
// you actually want to say something about a task, having just looked at it,
// was the one time you could not.
//
// And recording never stopped when you let go. The mic button was replaced by
// the recording row the instant recording began, so the element you were
// holding unmounted mid-gesture and the one that took its place had never been
// pressed. The row said "Release to stop" and releasing did nothing.
//
// Then the part that made all of it moot: what the recorder hands back on the
// web is a blob: URL belonging to one tab, so the note died at the next refresh
// while the play button stayed. That is what is really being proved here — the
// note is still there, and still plays, after a reload.
//
// The microphone is a fake one supplied by the browser, so this records real
// audio through the real path without needing a room to be quiet in.
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
await new Promise(r => server.listen(4821, r));

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
await page.goto('http://localhost:4821/Claude/', { waitUntil: 'networkidle' });
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
const shows = async (t) => (await body()).includes(t);

async function toDo(title) {
  const box = page.locator('input, textarea').first();
  await box.fill(title);
  await box.press('Enter');
  await page.waitForTimeout(900);
}
const openTask = async (t) => {
  await page.locator(`text=${t}`).first().click();
  await page.waitForTimeout(900);
};
const closeSheet = async (word) => {
  await page.getByText(word, { exact: true }).last().click();
  await page.waitForTimeout(900);
};
// Hold the mic, wait, let go — the gesture a person actually makes.
async function holdMic(ms) {
  const mic = page.getByLabel('Record a voice note');
  // The sheet has grown a section since this was written, so the mic can sit
  // below the fold. A bounding box off the bottom of the window is a place the
  // mouse cannot go.
  await mic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await mic.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  // What the button says while it is running. It used to read "Release to
  // stop"; the release is obvious while you are holding it, and the hint is
  // now spent on the part that is not — that sliding up keeps it going.
  const recording = await shows('Slide up to keep going');
  await page.mouse.up();
  await page.waitForTimeout(1800);
  return recording;
}
const playButtons = async () => page.getByLabel('Play voice note').count();

const TASK = 'Ring the letting agent';

// ── The offer exists at all ──
await toDo(TASK);
ok('a new task has no voice note', (await playButtons()) === 0);
await openTask(TASK);
ok('an existing task offers to record one', await shows('Hold to record'));
ok('under Notes, where a note belongs', await shows('NOTES'));

// ── Holding records, and letting go stops ──
//
// This is the half that was broken. Recording began and then never ended,
// because the button you were holding had been swapped for a different one.
const began = await holdMic(1500);
ok('holding it starts recording', began);
ok('and letting go stops', !(await shows('Slide up to keep going')));
ok('and leaves a note behind', await shows('Voice note'));
ok('which can be removed again', await shows('Remove'));

// ── It has to be saved to count ──
await closeSheet('Save');
ok('the row now offers to play it', (await playButtons()) === 1);

// Big enough to hit, and not underneath anything.
//
// The accessibility pass measured every control it could find, and missed this
// one entirely: no task on any surface it walked had a voice note, so the
// smallest button in the app was never in the sample. It was sixteen by
// fourteen. Worse, making the delete beside it hittable put the delete on top
// of it — the click went to the wrong button, which a measurement would never
// have shown and pressing it did.
{
  const geometry = await page.evaluate(() => {
    const play = document.querySelector('[aria-label="Play voice note"]');
    if (!play) return null;
    const r = play.getBoundingClientRect();
    const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      // What is actually on top at the middle of it.
      hits: mid ? (mid.closest('[aria-label]') || {}).getAttribute
        ? mid.closest('[aria-label]').getAttribute('aria-label')
        : null : null,
    };
  });
  ok('the play button is big enough to hit',
     geometry && geometry.w >= 24 && geometry.h >= 24, JSON.stringify(geometry));
  ok('and nothing else is sitting on top of it',
     geometry && geometry.hits === 'Play voice note', JSON.stringify(geometry));
}

await openTask(TASK);
ok('and the task still has it when reopened', await shows('Voice note'));
await closeSheet('Cancel');

// ── The part that makes it real ──
//
// What the recorder hands back on the web belongs to one tab and dies with it.
// If the note is still here — and still plays — after a reload, it was turned
// into the recording itself rather than a pointer to one.
const sizeBefore = Math.max(...[...rows.values()].map(r => (r.ciphertext || '').length));
ok('the audio went into the encrypted row, not beside it', sizeBefore > 5000,
   `largest row: ${sizeBefore}`);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
await page.waitForTimeout(3500);

ok('the note is still on the row after a reload', (await playButtons()) === 1);
// Polled rather than slept on. The note is a second or two long, so waiting a
// fixed moment to look can easily arrive after it has finished playing — which
// would fail for the one reason that is not a fault.
await page.getByLabel('Play voice note').first().click();
let played = false;
for (let i = 0; i < 20 && !played; i += 1) {
  played = (await page.getByLabel('Stop voice note').count()) > 0;
  if (!played) await page.waitForTimeout(100);
}
ok('and it actually plays', played);
if (await page.getByLabel('Stop voice note').count()) {
  await page.getByLabel('Stop voice note').first().click();
  await page.waitForTimeout(400);
}

// ── Removing it ──
await openTask(TASK);
ok('the sheet still shows the note', await shows('Voice note'));
await page.getByText('Remove', { exact: true }).first().click();
await page.waitForTimeout(600);
ok('removing it offers the mic again', await shows('Hold to record'));
await closeSheet('Save');
ok('and the row stops offering to play', (await playButtons()) === 0);

// ── Cancelling keeps nothing ──
//
// A recording made and then abandoned must not survive the sheet it was made in.
await openTask(TASK);
await holdMic(1200);
ok('a fresh recording is attached in the sheet', await shows('Voice note'));
await closeSheet('Cancel');
ok('but cancelling leaves the task as it was', (await playButtons()) === 0);
await openTask(TASK);
ok('and it is not there on reopening either', await shows('Hold to record'));
await closeSheet('Cancel');

// ── The add sheet has the same fix ──
//
// The swap bug was in the shared component, so it was broken there too.
await page.getByLabel('Add a task to To Do').click();
await page.waitForTimeout(500);
await page.getByPlaceholder('What needs to be done?').fill('Chase the deposit');
ok('the add sheet offers the mic', await shows('Hold to record'));
const beganAdd = await holdMic(1400);
ok('holding it records there too', beganAdd);
ok('and letting go stops there too', !(await shows('Slide up to keep going')));
await page.getByLabel('Add to To Do').click();
await page.waitForTimeout(1200);
ok('a task created with a note has one', (await playButtons()) === 1);

if (process.env.SHOT) {
  await openTask(TASK);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: process.env.SHOT, fullPage: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
