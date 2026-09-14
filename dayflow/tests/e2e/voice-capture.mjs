// Keeping the audio of what you dictated.
//
// The quick-add microphone already turned speech into a task and threw the
// recording away. Keeping it does two things: it lets a thought be captured
// without naming it first — naming being exactly the work you are deferring
// when something occurs to you on the way somewhere — and it gives a mishearing
// somewhere to be recovered from, which matters because recognition is not very
// good.
//
// The recogniser here is a stand-in, as in the mic tests: a real one needs a
// network round trip and somebody to speak. The microphone is real, though —
// the browser's fake device — so the recording path is the true one.
//
// Half of what follows is about failure. Recognition and recording both want
// the microphone, and whether a given browser will hand it to both is not
// knowable from here — iOS Safari least of all. So the tests that matter most
// are the ones where recording cannot happen at all: the task must still be
// created, exactly as it was before any of this existed.
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
await new Promise(r => server.listen(4823, r));

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
await page.goto('http://localhost:4823/Claude/', { waitUntil: 'networkidle' });
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
const shows = async (t) => (await body()).includes(t);
const playButtons = async () => page.getByLabel('Play voice note').count();

// Hold the quick-add mic, say something, let go — the gesture a person makes.
async function dictate(words, { holdMs = 900 } = {}) {
  const mic = page.getByLabel(/dictate|voice|speak|microphone/i).first();
  const target = (await mic.count()) ? mic : page.locator('text=🎙').first();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.evaluate(w => window.__mic.instance && window.__mic.instance.say(w), words);
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(2500);
}

// ── It hears, and it keeps what it heard ──
await dictate('collect the spare keys');
ok('dictation still makes a task', await shows('Collect the spare keys'), (await body()).slice(0, 300));
ok('and the recording is kept with it', (await playButtons()) === 1, String(await playButtons()));

// The audio has to be the audio, not a pointer to one that dies with the tab.
const biggest = Math.max(...[...rows.values()].map(r => (r.ciphertext || '').length));
ok('the recording went inside the encrypted task', biggest > 5000, `largest row: ${biggest}`);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
await page.locator('input, textarea').nth(0).fill(USER.email);
await page.locator('input, textarea').nth(1).fill('a strong master password');
await page.getByText('UNLOCK', { exact: false }).first().click();
await page.waitForTimeout(3500);

ok('and is still there after a reload', (await playButtons()) === 1);
await page.getByLabel('Play voice note').first().click();
let played = false;
for (let i = 0; i < 20 && !played; i += 1) {
  played = (await page.getByLabel('Stop voice note').count()) > 0;
  if (!played) await page.waitForTimeout(100);
}
ok('and plays what you actually said', played);
if (await page.getByLabel('Stop voice note').count()) {
  await page.getByLabel('Stop voice note').first().click();
  await page.waitForTimeout(400);
}

// ── The half that matters: when recording cannot happen ──
//
// Recognition and recording both want the microphone, and iOS Safari may well
// give it to only one of them. Every one of these must still produce the task —
// that is the whole bargain. Nothing here is allowed to cost you what already
// worked.
const before = await playButtons();

await page.evaluate(() => { window.__savedMR = window.MediaRecorder; delete window.MediaRecorder; });
await dictate('post the deposit form');
ok('with no MediaRecorder the task is still made', await shows('Post the deposit form'));
ok('and simply has no recording', (await playButtons()) === before, String(await playButtons()));

await page.evaluate(() => {
  window.MediaRecorder = window.__savedMR;
  window.__realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('denied'));
});
await dictate('book the boiler service');
ok('a refused microphone still makes the task', await shows('Book the boiler service'));
ok('and still leaves no recording', (await playButtons()) === before);

await page.evaluate(() => {
  navigator.mediaDevices.getUserMedia = window.__realGUM;
  window.__badMR = function () { throw new Error('unsupported'); };
  window.__savedMR = window.MediaRecorder;
  window.MediaRecorder = window.__badMR;
});
await dictate('chase the inventory');
ok('a recorder that will not start still makes the task', await shows('Chase the inventory'));
ok('and leaves no recording either', (await playButtons()) === before);

await page.evaluate(() => { window.MediaRecorder = window.__savedMR; });

// ── And it works again once the device does ──
await dictate('ring the surveyor');
ok('recording resumes when it can', await shows('Ring the surveyor'));
ok('and that one has its audio', (await playButtons()) === before + 1, String(await playButtons()));

// ── A sentence nobody finished ──
//
// Reaching for the microphone and saying nothing must not leave it open, and
// must not invent an empty task.
const tasksBefore = (await body()).split('\n').length;
const mic = page.locator('text=🎙').first();
const mb = await mic.boundingBox();
await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
await page.mouse.down();
await page.waitForTimeout(900);
await page.mouse.up();
await page.waitForTimeout(2500);
ok('saying nothing adds nothing', Math.abs((await body()).split('\n').length - tasksBefore) <= 1);
ok('and the recording count is unchanged', (await playButtons()) === before + 1);

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
