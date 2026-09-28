// A voice note, recorded on one device, opened on another.
//
// Reported from a phone: record a note on a task, press Save, and it is not
// there on the iPad — and by the time you look again it has gone from the phone
// too. Nothing here could have caught it. One suite proves a note survives a
// save and a reload; another proves a typed task reaches a second device.
// Nobody had ever put the two together, which is exactly where the report sits.
//
// So this is the missing half: A records, A saves, B opens the same account and
// looks for the note. What is being checked is that the audio itself travels —
// not a path, not a blob: URL, both of which mean nothing on another machine —
// so B is asked for the play button rather than for the word "note".
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
await new Promise(r => server.listen(4849, r));

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
// The largest row the server was ever asked to take. A recording is three
// orders of magnitude bigger than a typed task, and "it never arrived" and "it
// arrived and was not shown" are different bugs with different fixes.
let biggestPush = 0;

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
    const posted = req.postData() || '[]';
    biggestPush = Math.max(biggestPush, posted.length);
    for (const row of JSON.parse(posted)) rows.set(row.id, row);
    return json([], 201);
  }
  return json({});
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  // A microphone that is always there and always says the same thing.
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };

async function device(name) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [${name}] page error: ${e}`));
  await page.route(u => u.hostname === 'stubproject.supabase.co', route);
  await page.goto('http://localhost:4849/Claude/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const inputs = page.locator('input, textarea');
  await inputs.nth(0).fill(PROJECT);
  await inputs.nth(1).fill(KEY);
  await page.getByText('Connect', { exact: true }).click();
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const body = page => page.evaluate(() => document.body.innerText);
const playButtons = page => page.getByLabel('Play voice note').count();
const TASK = 'Call the surveyor';

// Held rather than tapped, which is what the button asks for.
async function recordInSheet(page, ms = 1400) {
  const mic = page.getByLabel('Record a voice note');
  await mic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await mic.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(2200);
}

// ── Device A: make an account and a task, and talk into it ──
const A = await device('A');
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

const quick = A.page.locator('input, textarea').first();
await quick.fill(TASK);
await quick.press('Enter');
await A.page.waitForTimeout(1200);
ok('A has a task to talk about', (await body(A.page)).includes(TASK));

await A.page.locator(`text=${TASK}`).first().click();
await A.page.waitForTimeout(900);
await recordInSheet(A.page);
ok('A recorded something', (await body(A.page)).includes('Voice note'),
   (await body(A.page)).slice(-300));

// Saved the way it was reported: the button, not the gesture.
await A.page.getByText('Save', { exact: true }).last().click();
await A.page.waitForTimeout(3000);
ok('and the row offers to play it', (await playButtons(A.page)) === 1,
   String(await playButtons(A.page)));

// ── What actually left the device ──
//
// A recording is hundreds of kilobytes; a typed task is under a thousand bytes.
// If the push that carried the note never happened, or carried a path instead
// of the audio, the row on the server is small — and that is a different bug
// from one where it arrives and is not shown.
ok('the recording itself was pushed, not a reference to it',
   biggestPush > 50 * 1024, `biggest push ${biggestPush} bytes`);
ok('and the server is holding it as ciphertext',
   [...rows.values()].every(r => !JSON.stringify(r).includes('data:audio')));

// ── Device B: the same account, somewhere else ──
const B = await device('B');
await B.page.locator('input, textarea').nth(0).fill(USER.email);
await B.page.locator('input, textarea').nth(1).fill('a strong master password');
await B.page.getByText('UNLOCK', { exact: false }).first().click();
await B.page.waitForTimeout(4500);

ok('B sees the task', (await body(B.page)).includes(TASK), (await body(B.page)).slice(0, 200));
ok('B can play the note recorded on A', (await playButtons(B.page)) === 1,
   String(await playButtons(B.page)));

await B.page.locator(`text=${TASK}`).first().click();
await B.page.waitForTimeout(900);
ok('and the sheet on B lists it too', (await body(B.page)).includes('Voice note'),
   (await body(B.page)).slice(-300));

// ── And it is still on A afterwards ──
//
// The half of the report that is hardest to explain: it went from the phone as
// well. A reload is where that would show, since what is in front of you until
// then is only what is in memory.
await A.page.reload({ waitUntil: 'networkidle' });
await A.page.waitForTimeout(1500);
await A.page.locator('input, textarea').nth(0).fill(USER.email);
await A.page.locator('input, textarea').nth(1).fill('a strong master password');
await A.page.getByText('UNLOCK', { exact: false }).first().click();
await A.page.waitForTimeout(4500);
ok('and A still has it after a reload', (await playButtons(A.page)) === 1,
   String(await playButtons(A.page)));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
