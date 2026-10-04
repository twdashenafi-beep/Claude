// What the phone's engine does that a browser's does not.
//
// Two defects, both invisible in a browser and both reported from a phone
// within a day of each other.
//
// The microphone worked once after opening the app and never again. The cause
// was the recogniser from the previous sentence: it was kept in a reference
// that was only ever cleared at unmount, so every start began by tearing down
// a recogniser that had already finished.
//
// In a browser that is harmless — abort() belongs to the instance, and
// aborting a finished one does nothing. On a phone it is not. The engine there
// is one shared native module and abort() is its global stop, reached through
// a handle the instance merely holds:
//
//     abort = ExpoSpeechRecognitionModule.abort;
//
// So the corpse of one sentence stops the next. The first dictation after
// opening worked because there was nothing stale to tear down, and every one
// after it was aborted before it could start.
//
// The stand-in here is modelled on that module rather than on a browser: one
// live session for the whole page, a global abort, and a teardown that
// completes a tick later, which is what a bridged call does. The exact
// interleaving on a device cannot be known from here — but the rule this
// enforces, that a recogniser which has ended is never aborted, removes the
// race whichever way it would have gone.
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
await new Promise(r => server.listen(4879, r));

const PROJECT = 'https://stubproject.supabase.co';
const KEY = 'sb_publishable_stubkeyabcdefghijkl';
const PASSWORD = 'a strong master password';
const USER = { id: 'user-1', email: 't@example.com', aud: 'authenticated', role: 'authenticated' };
const SESSION = {
  access_token: 'stub-access', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user: USER,
};
let vault = null;
const rows = new Map();

async function route(r) {
  const req = r.request();
  const p = new URL(req.url()).pathname;
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
await page.route(u => u.hostname === 'stubproject.supabase.co', route);

// Wednesday 23 September 2026, mid-morning.
//
// One of these dictates "call bob at 8 pm" and then counts how many times the
// phrase appears on the page. Run against the wall clock, an evening run makes
// that task due the moment it is created, the reminder bar says "Due now — Call
// bob", and the count is two. It passed all morning and failed at ten past
// eight, for a reason that has nothing to do with how a phone sends a
// transcript — which is what this suite is for.
//
// Ninth of these. They are all the same shape: a test that reads the clock and
// was written at an hour when the answer happened to suit it.
await page.clock.setFixedTime(new Date('2026-09-23T10:00:00'));

// ── The engine, shaped like the phone's rather than the browser's ──
await page.addInitScript(() => {
  window.__mic = { started: 0, aborted: 0, abortedAfterEnd: 0, live: null, instance: null };

  class SharedRecognition {
    constructor() { this.ended = false; }

    start() {
      window.__mic.started += 1;
      window.__mic.live = this;
      window.__mic.instance = this;
      setTimeout(() => { if (!this.ended) this.onstart && this.onstart(); }, 0);
    }

    settle() {
      if (this.ended) return;
      this.ended = true;
      if (window.__mic.live === this) window.__mic.live = null;
      setTimeout(() => this.onend && this.onend(), 0);
    }

    stop() { this.settle(); }

    // The module's global stop. It does not belong to this instance, and its
    // teardown finishes a moment after it is asked for.
    abort() {
      window.__mic.aborted += 1;
      if (this.ended) window.__mic.abortedAfterEnd += 1;
      this.settle();
      setTimeout(() => {
        const live = window.__mic.live;
        if (live) live.settle();
      }, 0);
    }

    // What iOS sends, which is not what a browser sends.
    //
    // One result, always at index zero, holding the whole transcript so far
    // rather than the part that is new — and on iOS 18 flagged final far more
    // often than a browser would flag it. Straight from the polyfill:
    //
    //     resultIndex: 0,
    //     results: [ new Result(isFinal, alternatives) ]
    // The iOS module emits "end" from four separate places, none of them
    // guarded against the others, so one session can report ending twice.
    endAgain() { this.onend && this.onend(); }

    say(text, isFinal = true) {
      const alternatives = [{ transcript: text }];
      alternatives.isFinal = isFinal;
      this.onresult && this.onresult({ resultIndex: 0, results: [alternatives] });
    }
  }

  window.SpeechRecognition = SharedRecognition;
  window.webkitSpeechRecognition = SharedRecognition;
});

const body = () => page.evaluate(() => document.body.innerText);
const mic = () => page.evaluate(() => ({
  started: window.__mic.started,
  aborted: window.__mic.aborted,
  abortedAfterEnd: window.__mic.abortedAfterEnd,
}));

// ── An account with the microphone available ──
await page.goto('http://localhost:4879/Claude/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.evaluate(([url, anonKey]) => {
  localStorage.setItem('@dayflow_sync_config', JSON.stringify({ url, anonKey }));
}, [PROJECT, KEY]);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

await page.getByText('Create an account').click();
await page.waitForTimeout(300);
const inputs = page.locator('input, textarea');
await inputs.nth(0).fill(USER.email);
await inputs.nth(1).fill(PASSWORD);
await inputs.nth(2).fill(PASSWORD);
await page.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await page.waitForTimeout(2500);
const ack = page.locator('text=/written|saved|wrote|understand|acknowledge/i').first();
if (await ack.count()) await ack.click();
const cont = page.locator('text=/continue|done|open/i').first();
if (await cont.count()) await cont.click();
await page.waitForTimeout(1500);

ok('the dictate button is there', (await page.getByLabel('Dictate a task').count()) === 1);

// Speaking, then pausing until the sentence is judged finished.
const dictate = async words => {
  await page.getByLabel('Dictate a task').click();
  await page.waitForTimeout(400);
  await page.evaluate(said => window.__mic.instance.say(said), words);
  await page.waitForTimeout(3200);
};

// ── Once ──
await dictate('to do collect the parcel');
let text = await body();
ok('the first sentence becomes a task', text.includes('Collect the parcel'), text.slice(0, 300));
ok('and the microphone was started once', (await mic()).started === 1, JSON.stringify(await mic()));

// ── Twice ──
//
// The one that failed on the phone. Nothing about it is different except that
// a recogniser has been used before.
await dictate('to do call the bank');
text = await body();
ok('the microphone starts a second time', (await mic()).started === 2, JSON.stringify(await mic()));
ok('and the second sentence becomes a task too', text.includes('Call the bank'), text.slice(0, 400));

// ── And the rule underneath it ──
//
// The assertion that names the defect rather than its consequence. A finished
// recogniser is not a thing to tear down; on a phone, tearing it down reaches
// past it.
ok('no recogniser is aborted after it has already ended',
   (await mic()).abortedAfterEnd === 0, JSON.stringify(await mic()));

// ── A third, because "once more" is how it was reported ──
await dictate('to do water the plants');
text = await body();
ok('and a third sentence still works', text.includes('Water the plants'), text.slice(0, 500));
ok('the first task did not disappear along the way', text.includes('Collect the parcel'));
ok('still nothing aborted after ending', (await mic()).abortedAfterEnd === 0, JSON.stringify(await mic()));

// ── One sentence, said the way a phone says it ──
//
// The phone resends the whole transcript at every event, growing as it hears
// more. Appending each one gave the title in the report:
//
//     Call Bob Call Bob at 8 PM Call Bob at 8 PM
//
// and, because each of those events ended the session and the loop restarted,
// four rows of it.
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

await page.getByLabel('Dictate a task').click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  window.__mic.instance.say('call bob');
  window.__mic.instance.say('call bob at 8');
  window.__mic.instance.say('call bob at 8 pm');
});
await page.waitForTimeout(3400);

text = await body();
ok('the sentence is not repeated inside the task',
   !/bob\s+call\s+bob/i.test(text), (text.match(/[^\n]*[Bb]ob[^\n]*/) || [''])[0]);
ok('and the task is there once, not four times',
   countOf(text.toLowerCase(), 'call bob') === 1,
   (text.match(/[^\n]*[Bb]ob[^\n]*/g) || []).join(' | ').slice(0, 300));
ok('the time it was told is kept', /20:00/.test(text), text.slice(0, 400));

// ── Interim results are not committed twice either ──
//
// A phone sends the same growing transcript whether or not it has decided the
// phrase is final, so an interim that is later repeated as final must not end
// up in the box twice.
await page.getByLabel('Dictate a task').click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  window.__mic.instance.say('email dawit', false);
  window.__mic.instance.say('email dawit tomorrow', false);
  window.__mic.instance.say('email dawit tomorrow', true);
});
await page.waitForTimeout(3400);

text = await body();
ok('an interim that becomes final is said once',
   !/dawit\s+email\s+dawit/i.test(text) && countOf(text.toLowerCase(), 'email dawit') <= 1,
   (text.match(/[^\n]*[Dd]awit[^\n]*/g) || []).join(' | ').slice(0, 300));

// ── A sentence the phone breaks into several sessions ──
//
// iOS ends the recognition task after a phrase rather than waiting for the
// speaker to finish, so one spoken sentence is three sessions and the app
// restarts between them. Each session starts with an empty transcript, so what
// earlier ones heard has to be carried — and each session's end must not count
// as the end of the sentence, or one thing said becomes three tasks.
await page.getByLabel('Dictate a task').click();
await page.waitForTimeout(400);

const sayThenEnd = words => page.evaluate(said => {
  window.__mic.instance.say(said);
  window.__mic.instance.settle();
}, words);

// Deliberately without a date in it. A task due on Friday belongs to the
// week's page, so it would be absent from the day whether or not any of this
// worked — which says nothing about what is under test.
await sayThenEnd('book the flight');
await page.waitForTimeout(700);
await sayThenEnd('to paris');
await page.waitForTimeout(700);

const startsBefore = (await mic()).started;
await page.waitForTimeout(3600);

text = await body();
ok('what the earlier sessions heard is not lost',
   /[Bb]ook the flight/.test(text), (text.match(/[^\n]*flight[^\n]*/) || [''])[0]);
ok('and the whole sentence is one task, not one per session',
   countOf(text.toLowerCase(), 'book the flight') === 1,
   (text.match(/[^\n]*flight[^\n]*/g) || []).join(' | ').slice(0, 300));
ok('nothing is repeated inside it',
   !/flight\s+book the flight/i.test(text), (text.match(/[^\n]*flight[^\n]*/) || [''])[0]);

// The loop that had no end. Each session ending while something had just been
// said reset the only counter that bounded it, so it restarted for ever.
ok('the restarts are bounded rather than endless',
   (await mic()).started - startsBefore <= 8, JSON.stringify(await mic()));

// ── A session that reports ending twice ──
//
// Four places in the module's iOS code send an "end" event and none of them
// knows about the others. A dictation that ends twice is still one thing
// somebody said.
await page.getByLabel('Dictate a task').click();
await page.waitForTimeout(400);
await page.evaluate(() => window.__mic.instance.say('tidy the desk'));

// Long enough for the pause to end the sentence and the submission to be on
// its way, which is exactly when a second end would do the damage.
await page.waitForTimeout(2600);
await page.evaluate(() => {
  const spent = window.__mic.instance;
  spent.endAgain();
  spent.endAgain();
});
await page.waitForTimeout(1400);

text = await body();
ok('a sentence that ends three times is still one task',
   countOf(text.toLowerCase(), 'tidy the desk') === 1,
   (text.match(/[^\n]*[Tt]idy[^\n]*/g) || []).join(' | ').slice(0, 300));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
