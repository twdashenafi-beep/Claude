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

// ── A task made by voice, exactly as reported ──
await dictate('To Do call Dereb');
ok('the spoken task is made', await shows('Call Dereb'), (await body()).slice(0, 300));
ok('and carries the recording of what was said', (await playButtons()) === 1);

await openTask('Call Dereb');
ok('the sheet shows the recording it came with', await shows('Voice note'));

// This is the bug: the mic was gone entirely once a note existed.
ok('and still offers the microphone',
   (await page.getByLabel('Record a voice note').count()) === 1,
   (await body()).slice(-300));

// ── Adding one ──
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

if (process.env.SHOT) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const mic = page.getByLabel('Record a voice note');
  if (await mic.count()) await mic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: process.env.SHOT });
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
