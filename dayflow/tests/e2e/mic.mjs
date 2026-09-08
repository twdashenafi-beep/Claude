// The microphone stops when you stop dictating, and when you walk away.
//
// Two things are under test. That a two-second pause ends the sentence on its
// own, rather than needing the mic tapped a second time — including a pause
// from the very start, which used to arm no timer at all because no speech
// result had arrived to arm one. And that leaving the input turns the microphone off: the
// quick-add box is unmounted whenever Search or the Archive is opened, and a
// recogniser nobody stops keeps the microphone running for a field that is no
// longer on the page.
//
// SpeechRecognition is replaced with a stand-in. A real one needs a
// microphone, a network round trip and someone to speak; what matters here is
// the lifecycle, which is ours.
//
// Needs a build and a browser:
//   npm i -D playwright && npx playwright install chromium
//   npm run build:pages
//   npm run test:e2e
//
// Realtime is not stubbed. The WebSocket simply fails, which is deliberate:
// it exercises the polling fallback, the path a project without Realtime
// enabled will actually take.
// Imported dynamically so a missing browser driver is a sentence rather than a
// stack trace — this is the one test with a dependency outside the repo.
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
await new Promise(r => server.listen(4719, r));

// ── the fake project ──
const PROJECT = 'https://stubproject.supabase.co';
const KEY = 'sb_publishable_stubkeyabcdefghijkl';
const USER = { id: 'user-1', email: 't@example.com', aud: 'authenticated', role: 'authenticated' };
const SESSION = {
  access_token: 'stub-access', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user: USER,
};
let vault = null;
const rows = new Map();
let pushes = 0;
const hits = [];

async function route(r) {
  const req = r.request();
  const url = new URL(req.url());
  const p = url.pathname;
  hits.push(`${req.method()} ${p}`);
  const json = (body, status = 200) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (p.startsWith('/auth/v1/signup') || p.startsWith('/auth/v1/token')) return json(SESSION);
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
    pushes += 1;
    for (const row of JSON.parse(req.postData() || '[]')) rows.set(row.id, row);
    return json([], 201);
  }
  return json({});
}

// PLAYWRIGHT_CHROMIUM lets a sandbox point at a browser it already has.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };

async function device(name) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${name}] page error: ${e}`));
  page.on('console', m => { if (/sync|Sync|fail/i.test(m.text())) console.log(`  [${name}] ${m.text()}`); });
  await page.route(u => u.hostname === 'stubproject.supabase.co', route);
  await page.goto('http://localhost:4719/Claude/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const inputs = page.locator('input, textarea');
  await inputs.nth(0).fill(PROJECT);
  await inputs.nth(1).fill(KEY);
  await page.getByText('Connect', { exact: true }).click();
  await page.waitForTimeout(1200);
  return { ctx, page };
}


const A = await device('A');

// The account first: the stand-in is installed by a reload, and a reload with
// no account to unlock lands on the sign-up screen instead.
await A.page.getByText('Create an account').click();
await A.page.waitForTimeout(300);
let inputs = A.page.locator('input, textarea');
await inputs.nth(0).fill(USER.email);
await inputs.nth(1).fill('a strong master password');
await inputs.nth(2).fill('a strong master password');
await A.page.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await A.page.waitForTimeout(2500);
const ack = A.page.locator('text=/written|saved|wrote|understand|acknowledge/i').first();
if (await ack.count()) await ack.click();
const cont = A.page.locator('text=/continue|done|open/i').first();
if (await cont.count()) await cont.click();
await A.page.waitForTimeout(1500);

// A stand-in for the browser's recogniser, installed before the app runs.
// A real one needs a microphone, a network round trip and someone to speak;
// what is under test is the lifecycle around it, which is ours. It records
// what happened to it so the test can ask.
await A.page.addInitScript(() => {
  window.__mic = { started: 0, stopped: 0, aborted: 0, live: false };
  class FakeRecognition {
    start() {
      window.__mic.started += 1;
      window.__mic.live = true;
      window.__mic.instance = this;
      setTimeout(() => this.onstart && this.onstart(), 0);
    }
    stop() {
      window.__mic.stopped += 1;
      if (!window.__mic.live) return;
      window.__mic.live = false;
      setTimeout(() => this.onend && this.onend(), 0);
    }
    abort() {
      window.__mic.aborted += 1;
      window.__mic.live = false;
    }
    // The shape the app reads: a list of results, each a list of alternatives,
    // each carrying a transcript, with isFinal on the result itself.
    say(text) {
      const alternatives = [{ transcript: text }];
      alternatives.isFinal = true;
      this.onresult && this.onresult({ resultIndex: 0, results: [alternatives] });
    }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
});
await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(1200);
await A.page.locator('input, textarea').nth(0).fill(USER.email);
await A.page.locator('input, textarea').nth(1).fill('a strong master password');
await A.page.getByText('UNLOCK', { exact: false }).first().click();
await A.page.waitForTimeout(3500);

const mic = () => A.page.evaluate(() => ({ ...window.__mic, instance: undefined }));
const body = () => A.page.evaluate(() => document.body.innerText);

ok('the dictate button is offered when there is a recogniser',
   (await A.page.getByLabel('Dictate a task').count()) === 1);

// ── A pause with nothing said at all still ends it ──
//
// This is the case that used to hang: no speech means no result event, and the
// timer was armed only by a result.
await A.page.getByLabel('Dictate a task').click();
await A.page.waitForTimeout(400);
ok('tapping it starts the microphone', (await mic()).started === 1, JSON.stringify(await mic()));
ok('and it is listening', (await mic()).live === true);

// Comfortably inside the two-second pause. The margins are wide on purpose:
// a loaded machine takes longer in real time than it was asked to wait, and a
// timing test that fails on a busy afternoon teaches nobody anything.
await A.page.waitForTimeout(800);
ok('it is still listening before the pause is up', (await mic()).live === true,
   JSON.stringify(await mic()));

await A.page.waitForTimeout(1800);
ok('silence from the start stops it by itself', (await mic()).live === false,
   JSON.stringify(await mic()));
ok('and it stopped rather than being abandoned', (await mic()).stopped >= 1);

// ── A pause after speaking ends it, and the task is written ──
await A.page.getByLabel('Dictate a task').click();
await A.page.waitForTimeout(300);
await A.page.evaluate(() => window.__mic.instance.say('to do collect the parcel'));
await A.page.waitForTimeout(900);
ok('speaking keeps it listening', (await mic()).live === true, JSON.stringify(await mic()));

await A.page.waitForTimeout(2200);
ok('a pause after speaking stops it', (await mic()).live === false, JSON.stringify(await mic()));
await A.page.waitForTimeout(900);
let text = await body();
ok('and the task is written', text.includes('Collect the parcel'), text.slice(0, 300));
ok('with the routing words taken out', !text.includes('to do collect'), text.slice(0, 300));

// ── Leaving the input turns the microphone off ──
//
// Search unmounts the quick-add box. Before this, the recogniser was left
// running and the browser went on showing the recording indicator.
const beforeAbort = (await mic()).aborted;
await A.page.getByLabel('Dictate a task').click();
await A.page.waitForTimeout(300);
ok('listening again', (await mic()).live === true);

await A.page.getByLabel('Search', { exact: true }).click();
await A.page.waitForTimeout(600);
ok('opening Search stops the microphone', (await mic()).live === false,
   JSON.stringify(await mic()));
ok('and it was aborted rather than left to time out',
   (await mic()).aborted > beforeAbort, JSON.stringify(await mic()));

// Nothing half-said should be filed by a component that has gone.
await A.page.waitForTimeout(1000);
await A.page.getByLabel('Close search').click();
await A.page.waitForTimeout(700);
text = await body();
ok('and no empty task was left behind by the unmount',
   !/\n\s*\n\s*×/.test(text), text.slice(0, 300));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
