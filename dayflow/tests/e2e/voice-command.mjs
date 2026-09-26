// Naming the column out loud, and then thinking.
//
// Saying "Owe me" and then pausing to work out what the task actually is, is
// the most ordinary thing in the world — naming where something goes is exactly
// the moment you have not yet decided what it is. The pause that ends dictation
// ended it there: the words stayed in the box, the microphone went off, and
// nothing was added. Then you say the task to a microphone that stopped
// listening two seconds ago, which is indistinguishable from the routing not
// working at all.
//
// A routing command with nothing after it is an unfinished sentence, so it buys
// more time. Not unlimited — a phone that hears "owe me" from a pocket must not
// listen for ever — which is the other half of what is checked here.
//
// The recogniser is a stand-in, as in the mic tests. What matters is the
// lifecycle around it, which is ours; the existing routing suite drives the
// same box by typing into it and so never exercised any of this.
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
await new Promise(r => server.listen(4831, r));

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
await page.goto('http://localhost:4831/Claude/', { waitUntil: 'networkidle' });
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
const boxText = async () => page.locator('input, textarea').first().inputValue();
const micLive = async () => page.evaluate(() => !!(window.__mic && window.__mic.live));

async function columnOf(title) {
  return page.evaluate(t => {
    const leafRect = label => {
      const el = [...document.querySelectorAll('*')]
        .find(e => e.children.length === 0 && (e.innerText || '').trim() === label);
      return el ? el.getBoundingClientRect() : null;
    };
    const todo = leafRect('TO DO'); const owe = leafRect('OWE ME'); const item = leafRect(t);
    if (!item) return 'missing';
    if (!todo || !owe) return 'no headings';
    return item.left < (todo.left + owe.left) / 2 ? 'todo' : 'owe';
  }, title);
}
// A tap rather than a hold: under HOLD_MS, so dictation latches on and ends on
// a pause. That is the path the pause rule belongs to.
async function tapMic() {
  const mic = page.locator('text=🎙').first();
  const b = await mic.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(400);
}
const speak = async w => {
  await page.evaluate(x => window.__mic.instance && window.__mic.instance.say(x), w);
  await page.waitForTimeout(250);
};
const PAUSE = 2600;   // longer than the silence that ends an ordinary sentence

// ── Owe Me, then a think, then the task ──
await tapMic();
ok('tapping the mic starts listening', await micLive());
await speak('Owe me');
ok('the command alone adds nothing yet', !(await body()).includes('Owe me\n'));
await page.waitForTimeout(PAUSE);
ok('and a pause after it does not end dictation', await micLive(),
   `box: ${await boxText()}`);
ok('the words are still waiting in the box', (await boxText()).toLowerCase().includes('owe me'));

await speak('the signed inventory');
await page.waitForTimeout(PAUSE + 800);
ok('naming the task afterwards finishes the sentence',
   (await columnOf('The signed inventory')) === 'owe', await columnOf('The signed inventory'));
ok('and the command is not in the title', !(await body()).includes('Owe me the signed'));
ok('and the box is emptied', (await boxText()) === '', await boxText());

// ── To Do, the same way ──
await tapMic();
await speak('To do');
await page.waitForTimeout(PAUSE);
ok('a spoken To Do also waits for its task', await micLive(), `box: ${await boxText()}`);
await speak('collect the spare keys');
await page.waitForTimeout(PAUSE + 800);
ok('and lands in To Do when it arrives',
   (await columnOf('Collect the spare keys')) === 'todo', await columnOf('Collect the spare keys'));
ok('with a clean title', !(await body()).includes('To do collect'));

// ── A finished sentence still ends on a pause ──
//
// The grace is for a sentence that is half said, not a longer silence for
// everybody. An ordinary task must not sit there with the microphone open.
await tapMic();
await speak('call the letting agent');
await page.waitForTimeout(PAUSE + 800);
ok('an ordinary sentence still ends when you stop talking', !(await micLive()));
ok('and is added', (await columnOf('Call the letting agent')) === 'todo',
   await columnOf('Call the letting agent'));

// ── But not for ever ──
//
// A command said to a pocket, and then nothing. The extra time is bounded, or
// the microphone stays open until the page is closed.
await tapMic();
await speak('Owe me');
let stillOn = true;
for (let i = 0; i < 30 && stillOn; i += 1) {
  await page.waitForTimeout(1000);
  stillOn = await micLive();
}
ok('a command followed by silence eventually gives up', !stillOn);
ok('leaving the words to be finished by hand',
   (await boxText()).toLowerCase().includes('owe me'), await boxText());

// And picking it up again works: what is in the box is what dictation adds to.
await tapMic();
await speak('the deposit back');
await page.waitForTimeout(PAUSE + 800);
ok('carrying on from the box still routes',
   (await columnOf('The deposit back')) === 'owe', await columnOf('The deposit back'));

// ── The shapes dictation actually produces ──────────────────────────────────
//
// Reported from a real phone: "Call Achim at 10pm" did nothing useful. The
// phrase itself was fine; what dictation writes is not always what you said.
// Apple spells out "p.m." with its periods, and ends every sentence with a full
// stop, and both of those went in as part of the task's name.
{
  const box = page.locator('input, textarea').first();

  await box.fill('Call Achim at 10 p.m.');
  await box.press('Enter');
  await page.waitForTimeout(1500);
  let shown = await page.evaluate(() => document.body.textContent || '');
  ok('a dictated evening makes a task', shown.includes('Call Achim'), shown.slice(0, 400));
  ok('and the preposition is not part of its name',
     !/Call Achim at\b/.test(shown), shown.slice(0, 400));
  ok('with the hour on it', /22:00/.test(shown), shown.slice(0, 400));

  // Asked of the preview rather than of the row. A row prints "Overdue" once
  // the hour has gone by, so checking it for "14:30" is a test that passes
  // before lunch and fails after it.
  await box.fill('Email the auditors at 14:30.');
  await page.waitForTimeout(700);
  const tag = await page.evaluate(() => {
    const leaf = [...document.querySelectorAll('*')]
      .filter(e => e.children.length === 0)
      .map(e => (e.textContent || '').trim())
      .find(t => /^(Today|Tomorrow) \d{1,2}:\d{2}$/.test(t));
    return leaf || '';
  });
  ok('a twenty-four hour clock is read as one', /14:30/.test(tag), tag);

  await box.press('Enter');
  await page.waitForTimeout(1500);
  shown = await page.evaluate(() => document.body.textContent || '');
  ok('and is not left in the title', shown.includes('Email the auditors'),
     shown.slice(0, 400));
  ok('nor is the full stop dictation leaves behind',
     !/Email the auditors \./.test(shown), shown.slice(0, 400));
}

// ── A date said out loud, shown back before it is committed ─────────────────
//
// The preview used to say "week", which names a page rather than a day. A date
// is the easiest thing in a sentence to mishear, and "week" looks identical
// whether the right Monday was heard or the wrong one — so the mistake was
// invisible until Monday. It names the day now.
{
  const box = page.locator('input, textarea').first();
  await box.fill('Update Eddy, Monday 28 at 11am');
  await page.waitForTimeout(700);

  const preview = await page.evaluate(() => document.body.textContent || '');
  ok('the preview names the task without the date in it',
     /Update Eddy(?!,)/.test(preview), preview.slice(0, 300));
  // Asked of the tag itself rather than of the page.
  //
  // textContent runs one element's text straight into the next — the preview
  // reads "Update EddyMon 28 Sep 11:00" with nothing between them — so a word
  // boundary before "Mon" never matches, and the assertion fails while the
  // thing it is checking is on screen and correct.
  const dateTag = await page.evaluate(() => {
    const shape = /^(Today|Tomorrow|Yesterday|[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2})( \d{1,2}:\d{2})?$/;
    const leaf = [...document.querySelectorAll('*')]
      .filter(e => e.children.length === 0)
      .map(e => (e.textContent || '').trim())
      .find(t => shape.test(t));
    return leaf || '';
  });
  ok('and says which day it understood', dateTag !== '', dateTag);
  ok('with the date itself, so the wrong Monday can be spotted',
     /\b28\b/.test(dateTag) || /^(Today|Tomorrow)/.test(dateTag), dateTag);
  ok('and the time it understood', /11:00/.test(dateTag), dateTag);

  await box.press('Enter');
  await page.waitForTimeout(1500);
  // A date a few days out puts the task on the Week page, which is where the
  // preview said it was going. Looking for it on Day and not finding it is the
  // test being in the wrong room, not the task being lost.
  await page.getByText('Week', { exact: true }).first().click();
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.body.textContent || '');
  ok('the task that lands is titled by the task alone',
     after.includes('Update Eddy'), after.slice(0, 400));
  ok('and does not keep the date in its name',
     !/Update Eddy, Monday/.test(after), after.slice(0, 400));
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
