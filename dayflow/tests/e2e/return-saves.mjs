// Return commits the sheet.
//
// The task sheet had one way to commit: reach back to the top right and press
// Save. Every other form anybody uses commits on Return, so pressing it and
// watching nothing happen is a small wrong-footing every single time — and the
// reach is the reason a title never quite gets fixed.
//
// So Return saves, in every single-line field on both sheets. The notes box is
// the exception and the only one, because there Return is a new line and a note
// is the one field on the sheet somebody writes more than a line in. That
// exception is the half of this worth testing hardest: a notes box that
// committed the sheet on Return would make multi-line notes impossible to type,
// which is a worse bug than the one being fixed.
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
await new Promise(r => server.listen(4847, r));

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
await page.goto('http://localhost:4847/Claude/', { waitUntil: 'networkidle' });
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

// innerText, not textContent: a sheet that has closed but is still mounted is
// hidden, and hidden text is exactly what must not count as an open sheet.
const body = () => page.evaluate(() => document.body.innerText);
const shows = async t => (await body()).includes(t);
// The visible one. Both sheets label their notes box the same, and the one that
// is closed is still in the document.
const seen = label => page.locator(`[aria-label="${label}"]:visible`).first();

const TASK = 'Ring the dentist';
const openTask = async what => {
  await page.locator(`text=${what}`).first().click();
  await page.waitForTimeout(900);
};

const box = page.locator('input, textarea').first();
await box.fill(TASK);
await box.press('Enter');
await page.waitForTimeout(900);
ok('a task to work on', await shows(TASK), (await body()).slice(0, 300));

// ── Return in the title ──
//
// Nothing here touches the Save button, which is the whole point: if Return does
// not commit, the edit is still sitting in the sheet and the row still says what
// it always said.
await openTask(TASK);
ok('the sheet is open', await shows('Edit Task'), (await body()).slice(0, 300));

await seen('Task title').fill(`${TASK} back`);
await seen('Task title').press('Enter');
await page.waitForTimeout(1200);

ok('Return in the title closes the sheet', !(await shows('Edit Task')), (await body()).slice(0, 400));
ok('and the row carries the new title', await shows(`${TASK} back`), (await body()).slice(0, 400));
ok('and there is only one of it',
   (await page.getByLabel(`Mark ${TASK} back as done`).count()) === 1);

// ── Return in the notes is a new line, and nothing else ──
await openTask(`${TASK} back`);
await seen('Notes').fill('Ask about the crown');
await seen('Notes').press('Enter');
await page.waitForTimeout(900);

ok('Return in the notes leaves the sheet open', await shows('Edit Task'), (await body()).slice(0, 400));
await seen('Notes').pressSequentially('And the hygienist');
const written = await seen('Notes').inputValue();
ok('and it put a line break in', written === 'Ask about the crown\nAnd the hygienist',
   JSON.stringify(written));

// Saved the ordinary way, and the second line is still a second line — so the
// break above is a real one rather than the field swallowing the key.
await page.getByText('Save', { exact: true }).last().click();
await page.waitForTimeout(1200);
await openTask(`${TASK} back`);
const kept = await seen('Notes').inputValue();
ok('a two-line note survives the save', kept === 'Ask about the crown\nAnd the hygienist',
   JSON.stringify(kept));

// ── Return in the person's name ──
//
// The other single-line field on the sheet, and the one somebody types into
// most often after the title: it only appears once the task is somebody else's
// to deliver.
await page.getByLabel('Move to Owe Me').click();
await page.waitForTimeout(500);
const person = page.getByPlaceholder('Who owes you?');
await person.fill('Rosemary');
await person.press('Enter');
await page.waitForTimeout(1200);

ok('Return in the name closes the sheet', !(await shows('Edit Task')), (await body()).slice(0, 400));
// Read off the row itself. The sheet says the name too, in the line offering to
// chase them, so the page as a whole would say Rosemary whether it saved or not.
const spoken = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[aria-label]')]
    .find(e => (e.getAttribute('aria-label') || '').startsWith('Ring the dentist back'));
  return el ? el.getAttribute('aria-label') : null;
});
ok('and the row is waiting on her', /waiting on Rosemary/.test(spoken || ''), String(spoken));

// ── The add sheet, which had this for its title and nowhere else ──
await page.getByLabel('Add something you are waiting on to Owe Me').click();
await page.waitForTimeout(700);
await seen('What are you waiting on?').fill('The signed lease');

// The notes box first, because it is the half that must not commit. A sheet
// that closed here would take an unfinished note with it.
await seen('Notes').fill('Chase the solicitor');
await seen('Notes').press('Enter');
await page.waitForTimeout(700);
ok('Return in the add sheet notes leaves it open', await shows('New Owe Me'), (await body()).slice(0, 400));

const whoOwes = page.getByPlaceholder('Who owes you this?');
await whoOwes.fill('Priya');
await whoOwes.press('Enter');
await page.waitForTimeout(1400);

ok('Return in the add sheet name adds the task', !(await shows('New Owe Me')), (await body()).slice(0, 400));
ok('and the task is there', await shows('The signed lease'), (await body()).slice(0, 400));
// Off the row again, for the same reason: the sheet that was open a moment ago
// had her name in it too.
const oweRow = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[aria-label]')]
    .find(e => (e.getAttribute('aria-label') || '').startsWith('The signed lease'));
  return el ? el.getAttribute('aria-label') : null;
});
ok('with the person on it', /waiting on Priya/.test(oweRow || ''), String(oweRow));

// And the note it was carrying arrived with it, rather than being lost to the
// key that nearly committed the sheet.
await openTask('The signed lease');
const carried = await seen('Notes').inputValue();
ok('and the note it was carrying arrived too', carried === 'Chase the solicitor', JSON.stringify(carried));
await page.getByText('Cancel', { exact: true }).last().click();
await page.waitForTimeout(800);

// ── Save still works ──
//
// The button is not going anywhere: Return is a second way in, not a
// replacement, and a phone with a hardware keyboard is not the common case.
await openTask(`${TASK} back`);
await seen('Task title').fill('Ring the dentist tomorrow');
await page.getByText('Save', { exact: true }).last().click();
await page.waitForTimeout(1200);
ok('the Save button still commits', await shows('Ring the dentist tomorrow'), (await body()).slice(0, 400));

// ── And Cancel still throws the edit away ──
await openTask('Ring the dentist tomorrow');
await seen('Task title').fill('Something nobody asked for');
await page.getByText('Cancel', { exact: true }).last().click();
await page.waitForTimeout(1000);
ok('Cancel still discards', !(await shows('Something nobody asked for')), (await body()).slice(0, 400));
ok('and the title is as it was', await shows('Ring the dentist tomorrow'));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
