// Adding a voice note to a task that already has one.
//
// The quick-add microphone keeps the audio of what you dictated and attaches it
// to the task it made. There was room for exactly one recording, so that task
// arrived with its only slot already spent: the sheet showed a play button, a
// Remove, and no way at all to leave the note you actually wanted. The feature
// closed the door behind itself.
//
// So this walks the path the complaint describes — say "To Do call Dereb", open
// the task it made, and try to add something.
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
await new Promise(r => server.listen(4835, r));

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
await page.goto('http://localhost:4835/Claude/', { waitUntil: 'networkidle' });
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


// A stand-in for the browser's recogniser, installed before the app runs.
await page.addInitScript(() => {
  window.__mic = { started: 0, live: false };
  class FakeRecognition {
    start() {
      window.__mic.started += 1;
      window.__mic.live = true;
      window.__mic.instance = this;
      setTimeout(() => this.onstart && this.onstart(), 0);
    }
    stop() {
      if (!window.__mic.live) return;
      window.__mic.live = false;
      setTimeout(() => this.onend && this.onend(), 0);
    }
    abort() { window.__mic.live = false; }
    say(text) {
      const alternatives = [{ transcript: text }];
      alternatives.isFinal = true;
      this.onresult && this.onresult({ resultIndex: 0, results: [alternatives] });
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1300);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
await page.waitForTimeout(3500);

const body = async () => page.evaluate(() => document.body.innerText);
const shows = async t => (await body()).includes(t);
const playButtons = async () => page.getByLabel('Play voice note').count();
// Counted by walking the leaves: a Playwright text= regex matches containers
// too, and a container holding two notes counts once.
const noteRows = async () => page.evaluate(() => [...document.querySelectorAll('*')]
  .filter(e => e.children.length === 0 && /^Voice note( \d+)?$/.test((e.innerText || '').trim()))
  .length);

async function dictate(words, { holdMs = 900 } = {}) {
  const mic = page.locator('text=🎙').first();
  const box = await mic.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.evaluate(w => window.__mic.instance && window.__mic.instance.say(w), words);
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(2600);
}
const openTask = async t => { await page.locator(`text=${t}`).first().click(); await page.waitForTimeout(900); };
const closeSheet = async w => { await page.getByText(w, { exact: true }).last().click(); await page.waitForTimeout(1000); };

// Hold the mic inside the task sheet, which is a scrolling sheet, so it has to
// be brought into view first.
async function recordInSheet(ms = 1400) {
  const mic = page.getByLabel('Record a voice note');
  await mic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await mic.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(2000);
}

// ── A task made by voice ──
//
// Dictation used to keep the audio of what you said and attach it, which cost a
// hundred and ten kilobytes against six hundred and eighty-four bytes for the
// same task typed — about forty-five spoken tasks before the vault was full —
// in exchange for a safety net that stopped being useful the moment you had
// glanced at the title. It does not any more, and the first thing to prove is
// that a spoken task now arrives clean.
await dictate('To Do call Dereb');
ok('the spoken task is made', await shows('Call Dereb'), (await body()).slice(0, 300));
ok('and carries no recording with it', (await playButtons()) === 0);

await openTask('Call Dereb');
ok('the sheet offers the microphone', (await page.getByLabel('Record a voice note').count()) === 1,
   (await body()).slice(-300));

// One recorded by hand, so the rest of this has something to add to.
await recordInSheet();
ok('a note recorded by hand is kept', await shows('Voice note'));

// ── Adding a second ──
await recordInSheet();
ok('a second note can be recorded', (await noteRows()) === 2, String(await noteRows()));
ok('and they are numbered once there is more than one', await shows('Voice note 2'));
ok('the first one is still there', await shows('Voice note 1'));

await closeSheet('Save');
ok('the row still offers to play', (await playButtons()) === 1);

await openTask('Call Dereb');
ok('both survive the save', (await noteRows()) === 2, String(await noteRows()));
await closeSheet('Cancel');

// ── And a reload ──
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
await page.waitForTimeout(3500);
await openTask('Call Dereb');
ok('both are still there after a reload', (await noteRows()) === 2, String(await noteRows()));

// ── Removing one leaves the other ──
await page.getByLabel('Remove voice note 1').click();
await page.waitForTimeout(500);
ok('removing one leaves the other', (await noteRows()) === 1, String(await noteRows()));
ok('and the microphone is still offered',
   (await page.getByLabel('Record a voice note').count()) === 1);
await closeSheet('Save');
ok('the row plays the one that is left', (await playButtons()) === 1);

await openTask('Call Dereb');
ok('and the removal stuck', (await noteRows()) === 1, String(await noteRows()));

// ── There is a limit, and it says so ──
for (let i = 0; i < 5; i += 1) {
  if ((await page.getByLabel('Record a voice note').count()) === 0) break;
  await recordInSheet(900);
}
ok('a task fills up at a handful', (await noteRows()) === 5, String(await noteRows()));
ok('and says so rather than going quiet',
   await shows('as many as one task can hold'), (await body()).slice(-300));
ok('with no microphone left to press',
   (await page.getByLabel('Record a voice note').count()) === 0);

await page.getByLabel('Remove voice note 1').click();
await page.waitForTimeout(500);
ok('removing one gives the microphone back',
   (await page.getByLabel('Record a voice note').count()) === 1);

// ── Where the button is ──
//
// It used to sit at the left margin: the one control in the app you have to
// hold down for up to a minute, placed under the hand that has to reach across
// the phone to get to it. Measured rather than eyeballed, because a style that
// quietly stops applying is exactly the kind of thing that survives a review.
const placed = await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="Record a voice note"]');
  if (!btn) return null;
  const b = btn.getBoundingClientRect();
  const row = btn.parentElement.getBoundingClientRect();
  return {
    fromLeft: Math.round(b.left - row.left),
    fromRight: Math.round(row.right - b.right),
    width: Math.round(b.width),
    height: Math.round(b.height),
  };
});
ok('the record button is at the right-hand end',
   placed && placed.fromRight < placed.fromLeft, JSON.stringify(placed));
ok('hard against that end rather than merely past the middle',
   placed && placed.fromRight <= 2, JSON.stringify(placed));
ok('and is a thumb across, which is what Apple asks for',
   placed && placed.width >= 44 && placed.height >= 44, JSON.stringify(placed));

// ── A slip is not a note ──
//
// The microphone opens after a fifth of a second of holding, so what this
// catches is the press that lasts just long enough to record a moment of room
// tone — indistinguishable from a real note in the list until you play it.
const before = await noteRows();
{
  const mic = page.getByLabel('Record a voice note');
  await mic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await mic.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(320);
  await page.mouse.up();
  await page.waitForTimeout(1800);
}
ok('a hold too short to have meant anything leaves no note',
   (await noteRows()) === before, `${await noteRows()} vs ${before}`);
ok('and says so rather than going quiet', await shows('Too short'),
   (await body()).slice(-300));

// ── What a slow phone does to a hold ──
//
// Two failures were reported from an iPhone and an iPad, and both come from the
// same place: opening the microphone is awaited, and on a phone it takes long
// enough to matter. On a desktop it is tens of milliseconds, which is why
// nothing here caught either one until the wait was made real.
//
// Everything in this section runs with the microphone taking a second to open,
// which is all a slow phone is from the app's point of view.
await page.evaluate(() => {
  const media = navigator.mediaDevices;
  window.__realGUM = media.getUserMedia.bind(media);
  media.getUserMedia = async (...args) => {
    // Long enough to outlast the two-hundred-millisecond hold and land the
    // thumb-roll inside the wait, short enough that a deliberate hold still
    // reaches the microphone. expo-audio asks for the stream twice — once for
    // permission, once to prepare — so the real wait is double this.
    await new Promise(r => setTimeout(r, 350));
    return window.__realGUM(...args);
  };
});

// Room to work: each of these keeps a note, and a full task has no microphone.
const roomFor = async n => {
  while ((await noteRows()) > n) {
    await page.getByLabel('Remove voice note 1').click();
    await page.waitForTimeout(500);
  }
};
await roomFor(2);

async function holdMic({ ms, roll = false }) {
  const mic = page.getByLabel('Record a voice note');
  await mic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await mic.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  if (roll) {
    // A thumb settling, not a swipe: fifteen pixels, and downwards so it cannot
    // be mistaken for the slide that locks recording on. Late enough that the
    // hold has already completed and the microphone is still opening, which is
    // exactly where the damage was done.
    await page.waitForTimeout(400);
    await page.mouse.move(cx + 9, cy + 12, { steps: 3 });
    await page.waitForTimeout(ms - 400);
  } else {
    await page.waitForTimeout(ms);
  }
  await page.mouse.up();
  await page.waitForTimeout(2600);
}

// ── A thumb that moves, which is every thumb ──
//
// Reported from an iPhone: hold the button and it says "Ready — hold to record"
// and records nothing, however long you hold. A finger landing on a
// forty-four pixel button rolls as it settles, and that roll was read as the
// finger having gone — so the microphone finished opening, found nobody
// holding, and stood down. Whether the finger is down is the release's to say.
{
  const before = await noteRows();
  await holdMic({ ms: 1600, roll: true });
  ok('a hold survives the finger settling on the button',
     (await noteRows()) === before + 1, `${await noteRows()} vs ${before}`);
  ok('and is not told it is ready for the hold it just did',
     !(await shows('Ready — hold to record')), (await body()).slice(-300));
}

// ── A hold the app spent on itself ──
//
// The other half. A slip was judged by how much audio came back, so when the
// microphone took most of a short hold to open, a deliberate press came back
// as "Too short — hold while you talk". That is the app's latency being
// charged to the person holding the button. What decides whether a press was
// meant is how long it lasted.
await roomFor(2);
{
  const before = await noteRows();
  await holdMic({ ms: 1050 });
  ok('a deliberate hold is kept even when the microphone was slow to open',
     (await noteRows()) === before + 1, `${await noteRows()} vs ${before}`);
  ok('and is not called too short', !(await shows('Too short')),
     (await body()).slice(-300));
}

// A brush is still a brush, however slow the microphone is: this one never
// reaches the point of recording at all.
await roomFor(2);
{
  const before = await noteRows();
  await holdMic({ ms: 120 });
  ok('but a brush still leaves nothing behind', (await noteRows()) === before,
     `${await noteRows()} vs ${before}`);
}

await page.evaluate(() => {
  if (window.__realGUM) navigator.mediaDevices.getUserMedia = window.__realGUM;
});
await roomFor(2);

// ── The very first hold anybody ever makes ──
//
// Asking for the microphone puts a system dialog on the screen, and you cannot
// answer it without lifting your finger off the button. So the first attempt
// always ends with permission newly granted and nothing recorded — and it used
// to end with "Too short — hold while you talk" in the red this app keeps for
// lateness and lost work, after a hold of three full seconds. Wrong, and rude
// with it.
//
// Reproduced by making the permission call slow, which is all a dialog is from
// the app's point of view.
const beforeAsking = await noteRows();
await page.evaluate(() => {
  const media = navigator.mediaDevices;
  window.__realGUM = media.getUserMedia.bind(media);
  media.getUserMedia = async (...args) => {
    await new Promise(r => setTimeout(r, 1600));
    return window.__realGUM(...args);
  };
});
{
  const mic = page.getByLabel('Record a voice note');
  await mic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await mic.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Long enough that this is unmistakably a real hold, not a brush.
  await page.waitForTimeout(700);
  await page.mouse.up();
}
// Long enough for the permission call, and the prepare behind it, to finish.
await page.waitForTimeout(5000);
await page.evaluate(() => {
  if (window.__realGUM) navigator.mediaDevices.getUserMedia = window.__realGUM;
});

ok('a hold spent answering the permission dialog records nothing',
   (await noteRows()) === beforeAsking, `${await noteRows()} vs ${beforeAsking}`);
ok('and is not called too short, because it was not',
   !(await shows('Too short')), (await body()).slice(-300));
ok('it says what to do next instead', await shows('Ready — hold to record'),
   (await body()).slice(-300));

// ── Hands-free ──
//
// Holding a phone still for a minute to leave a minute-long note is a demand no
// other recorder makes. Slide up and it keeps going without you; tap it to
// stop.
{
  const mic = page.getByLabel('Record a voice note');
  await mic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await mic.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.move(cx, cy - 70, { steps: 8 });
  await page.waitForTimeout(350);
  await page.mouse.up();
  await page.waitForTimeout(700);
}
ok('sliding up keeps it recording after the finger has gone',
   await shows('Tap to stop'), (await body()).slice(-300));
ok('and the button is now a stop',
   (await page.getByLabel('Stop recording').count()) === 1);

const locked = await noteRows();
await page.waitForTimeout(900);
await page.getByLabel('Stop recording').click();
await page.waitForTimeout(2200);
ok('tapping it stops, and keeps what was said',
   (await noteRows()) === locked + 1, `${await noteRows()} vs ${locked}`);
ok('and it is a microphone again, or the task is full',
   !(await shows('Tap to stop')));

// ── One voice at a time ──
//
// Each note owns its own player, which is what lets a row play without knowing
// about the rest of the list — and which meant that tapping a second note while
// the first was talking played both at once, over each other, with no way back
// but to find the first one again.
const playingRows = () => page.evaluate(() => [...document.querySelectorAll('[aria-label="Stop voice note"]')]
  .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()));

// Named rather than counted: the row behind the sheet carries a play button of
// its own, so an index here would be one off in a way nothing would notice.
// Polled for the named one specifically, not merely for something playing. A
// row that has just been stopped goes on saying it is playing for a frame or
// two — the status arrives from the player rather than from the tap — so
// "anything is playing" would have been satisfied by the note this one was
// sent to interrupt, and the test would have proved nothing.
const playOne = async name => {
  const row = page.locator('[aria-label="Play voice note"]').filter({ hasText: name }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  for (let i = 0; i < 25; i += 1) {
    if ((await playingRows()).some(t => t.includes(name))) break;
    await page.waitForTimeout(100);
  }
  // And then a moment to let the other one catch up with having been stopped.
  // If it has not been, it is a second or two long and will still be there.
  await page.waitForTimeout(400);
};

// The last one recorded is the longest — the hands-free take above — so it is
// the one still talking when the second tap arrives. Counted rather than named:
// how many notes this task has depends on what the sections above kept, and a
// hard-coded number goes stale the moment one of them changes.
const noteCount = await noteRows();
ok('there are notes to play with', noteCount >= 2, String(noteCount));
await playOne(`Voice note ${noteCount}`);
const first = await playingRows();
ok('a note plays when its row is tapped', first.length === 1, JSON.stringify(first));
if (first.length) {
  await playOne('Voice note 1');
  const second = await playingRows();
  ok('and starting another does not leave two of them talking',
     second.length === 1, JSON.stringify(second));
  ok('the one playing is the one just tapped',
     second.length === 1 && second[0].includes('Voice note 1'), JSON.stringify([first, second]));
  if (await page.getByLabel('Stop voice note').count()) {
    await page.getByLabel('Stop voice note').first().click();
    await page.waitForTimeout(400);
  }
}

if (process.env.SHOT) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  // The task is full at this point, and a full task shows no microphone — which
  // is the one thing a picture of this sheet is taken to look at.
  if ((await page.getByLabel('Record a voice note').count()) === 0) {
    await page.getByLabel('Remove voice note 1').click();
    await page.waitForTimeout(600);
  }
  const mic = page.getByLabel('Record a voice note');
  if (await mic.count()) await mic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: process.env.SHOT });
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
