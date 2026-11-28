// Suggestions on a second device: the Mac collects a proposal from the folder,
// a phone with sync on is shown it, and a decision on either is the decision
// on both. Nothing reaches the page without a tap, and the server holds only
// ciphertext.
//
// Two browser contexts stand for the two devices. One is given the Mac app's
// bridge, backed by the real folder code; the other is given nothing, as a
// phone is. Both talk to the same stand-in sync project.
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
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { createAgentFolder } = createRequire(import.meta.url)('../../../desktop/agentFolder.js');

const PORT = 4872;
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
await new Promise(r => server.listen(PORT, r));

const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'dayflow-drive-'));
const folder = createAgentFolder(drive);
folder.ensure();
const drop = (name, value) => fs.writeFileSync(path.join(folder.dirs.inbox, name), JSON.stringify(value));

// ── the stand-in sync project ──
const USER = { id: 'user-1', email: 't@example.com', aud: 'authenticated', role: 'authenticated' };
const SESSION = {
  access_token: 'stub-access', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user: USER,
};
let vault = null;
const rows = new Map();
const suggestionRows = new Map();
// Off at first: an account whose owner has not yet added the table.
let hasTable = false;

async function route(r) {
  const req = r.request();
  const p = new URL(req.url()).pathname;
  const json = (value, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
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
  if (p.startsWith('/rest/v1/agent_suggestions')) {
    // What PostgREST says of a table it has never heard of.
    if (!hasTable) return json({ code: 'PGRST205', message: "Could not find the table 'public.agent_suggestions' in the schema cache" }, 404);
    if (req.method() === 'GET') return json([...suggestionRows.values()]);
    for (const row of JSON.parse(req.postData() || '[]')) suggestionRows.set(row.id, row);
    return json([], 201);
  }
  return json({});
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };
const pageErrors = [];

async function device(name, { mac }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: mac ? { width: 1100, height: 900 } : { width: 430, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(`[${name}] ${e}`));
  if (mac) {
    await page.exposeFunction('__inboxStatus', () => ({ ok: true, available: true, folder: drive }));
    await page.exposeFunction('__inboxList', () => ({ ok: true, files: folder.list() }));
    await page.exposeFunction('__inboxSettle', (n, o, r) => folder.settle(n, o, r));
    await page.exposeFunction('__inboxExport', t => folder.writeExport(t));
    await page.addInitScript(() => {
      window.dayflowDesktop = { agentInbox: {
        status: () => window.__inboxStatus(), list: () => window.__inboxList(),
        settle: (n, o, r) => window.__inboxSettle(n, o, r), writeExport: t => window.__inboxExport(t),
      } };
    });
  }
  await page.route(u => u.hostname === 'stubproject.supabase.co', route);
  await page.goto(`http://localhost:${PORT}/Claude/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const inputs = page.locator('input, textarea');
  await inputs.nth(0).fill('https://stubproject.supabase.co');
  await inputs.nth(1).fill('sb_publishable_stubkeyabcdefghijkl');
  await page.getByText('Connect', { exact: true }).click();
  await page.waitForTimeout(1200);
  return page;
}
const body = page => page.evaluate(() => document.body.innerText);
const openSuggested = async page => {
  if (!(await page.getByText(/^Suggested( \d+)?$/).count())) {
    await page.getByLabel('Projects').click();
    await page.waitForTimeout(300);
  }
  await page.getByText(/^Suggested( \d+)?$/).first().click();
  await page.waitForTimeout(400);
};
const checkNow = async page => {
  await page.getByLabel('Check the inbox now').click();
  await page.waitForTimeout(2500);
};

const TASK = {
  type: 'new_task', id: 'deal-42-call', title: 'call the refinery about Q1 volumes',
  // No due date, so an accepted one lands on today's page, where this looks.
  notes: 'ask about the Djibouti slot',
  owner: 'me', deal: 'Djibouti diesel', agent: 'deal-bot', source_url: 'https://example.com/thread/42',
};
drop('first.json', [TASK,
  { ...TASK, id: 'owed-1', title: 'send the signed term sheet', owner: 'Abebe', notes: '' },
  { ...TASK, id: 'skip-1', title: 'buy a boat', notes: '' }]);

// ── The Mac: create the account; the folder is read on launch ──
const mac = await device('mac', { mac: true });
await mac.getByText('Create an account').click();
await mac.waitForTimeout(300);
let inputs = mac.locator('input, textarea');
await inputs.nth(0).fill(USER.email);
await inputs.nth(1).fill('a strong master password');
await inputs.nth(2).fill('a strong master password');
await mac.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await mac.waitForTimeout(2500);
const ack = mac.locator('text=/written|saved|wrote|understand|acknowledge/i').first();
if (await ack.count()) await ack.click();
const cont = mac.locator('text=/continue|done|open/i').first();
if (await cont.count()) await cont.click();
await mac.waitForTimeout(3500);

let text = await body(mac);
ok('the Mac collected three proposals', /Suggested 3/.test(text), text.slice(0, 300));

// ── Before the table exists ──
await openSuggested(mac);
text = await body(mac);
ok('without the table, the Mac says exactly what is missing', /no agent_suggestions table yet/.test(text), text.slice(0, 500));
ok('and nothing was sent anywhere', suggestionRows.size === 0);

const signIn = async name => {
  const page = await device(name, { mac: false });
  await page.locator('input, textarea').nth(0).fill(USER.email);
  await page.locator('input, textarea').nth(1).fill('a strong master password');
  await page.getByText('UNLOCK', { exact: false }).first().click();
  await page.waitForTimeout(4000);
  return page;
};

const early = await signIn('phone-before');
await early.getByLabel('Projects').click();
await early.waitForTimeout(400);
text = await body(early);
ok('a phone whose sync database has no table has no Suggested tab', !/Suggested/.test(text), text.slice(0, 300));
await early.context().close();

// ── The table is added ──
hasTable = true;
await checkNow(mac);
text = await body(mac);
ok('once it exists, the Mac shares what it holds', suggestionRows.size === 3 && /Shared with your other devices, encrypted/.test(text), `${suggestionRows.size} rows`);
const stored = JSON.stringify([...suggestionRows.values()]);
ok('the server holds ciphertext only: no title, agent, deal or owner',
  !/refinery|term sheet|boat|deal-bot|Djibouti|Abebe/i.test(stored), stored.slice(0, 200));
ok('and rows named by nothing readable', [...suggestionRows.keys()].every(id => /^s_[0-9a-f]{64}$/.test(id)));

// ── The phone ──
const phone = await signIn('phone');
text = await body(phone);
ok('the phone is shown three waiting', /Suggested 3/.test(text), text.slice(0, 300));
ok('none of them is on its page before a tap', !/refinery/i.test(text) && !/term sheet/i.test(text) && !/boat/i.test(text));

await openSuggested(phone);
text = await body(phone);
ok('each is shown with its agent and deal', /from deal-bot/.test(text) && /Djibouti diesel/.test(text));
ok('the phone says the Mac is the collector', /The DayFlow Mac app collects them/.test(text));
ok('and offers no switch to write tasks to Google Drive', !/Write my tasks to Google Drive/.test(text));

await phone.getByLabel('Accept: call the refinery about Q1 volumes').click();
await phone.waitForTimeout(600);
await phone.getByLabel('Dismiss: buy a boat').click();
await phone.waitForTimeout(2500);
text = await body(phone);
ok('deciding on the phone leaves one waiting there', /Suggested 1/.test(text), text.slice(0, 200));

await phone.getByText('Everything', { exact: true }).click();
await phone.waitForTimeout(600);
text = await body(phone);
ok('the accepted one is a task on the phone', /Call the refinery about Q1 volumes/.test(text), text.slice(0, 400));
ok('the dismissed one never reached the page', !/boat/i.test(text));

// ── Back on the Mac ──
await checkNow(mac);
text = await body(mac);
ok('the Mac learns of both decisions', /Suggested 1/.test(text) && /2 decided/.test(text), text.slice(0, 300));
ok('what was decided elsewhere is no longer offered', !/Accept\b[\s\S]*refinery/.test(text) && (await mac.getByLabel('Accept: call the refinery about Q1 volumes').count()) === 0);

await mac.getByText('Everything', { exact: true }).click();
// The task itself travels by the ordinary task sync, which without Realtime
// (there is none here) polls every twenty seconds.
await mac.getByText('Call the refinery about Q1 volumes').first().waitFor({ timeout: 30000 }).catch(() => {});
text = await body(mac);
ok('the task made on the phone is on the Mac, once', (text.match(/Call the refinery about Q1 volumes/g) || []).length === 1, text.slice(0, 400));

// ── And the other way ──
await openSuggested(mac);
await mac.getByLabel('Accept: send the signed term sheet').click();
await mac.waitForTimeout(2500);
await openSuggested(phone);
await checkNow(phone);
text = await body(phone);
ok('a decision on the Mac clears it on the phone', /Nothing waiting/.test(text) && /3 decided/.test(text), text.slice(0, 300));

await phone.getByText('Everything', { exact: true }).click();
await phone.getByText('Send the signed term sheet').first().waitFor({ timeout: 30000 }).catch(() => {});
text = await body(phone);
ok('and its task arrives, owed by the person named', /Send the signed term sheet/.test(text) && /Abebe/.test(text), text.slice(0, 500));

// ── After a restart nothing decided comes back ──
await phone.reload({ waitUntil: 'networkidle' });
await phone.waitForTimeout(800);
const unlock = phone.locator('input, textarea');
if (await unlock.count()) {
  await unlock.nth(0).fill(USER.email).catch(() => {});
  if (await unlock.count() > 1) await unlock.nth(1).fill('a strong master password');
  const go = phone.getByText('UNLOCK', { exact: false }).first();
  if (await go.count()) await go.click();
}
await phone.waitForTimeout(4000);
text = await body(phone);
ok('after a restart nothing decided is waiting again', !/Suggested \d/.test(text), text.slice(0, 200));

ok('no page errors on either device', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
fs.rmSync(drive, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
