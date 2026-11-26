// The agent inbox, end to end: a file dropped in the folder becomes a
// suggestion, a tap makes it a task, and nothing an agent writes reaches the
// page without one.
//
// The Mac app gives the page a small bridge to one folder. Here the same bridge
// is handed to a browser page, backed by the Mac app's real folder code
// (desktop/agentFolder.js) on a temporary folder — so everything but Electron
// itself is the real thing.
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
await new Promise(r => server.listen(4871, r));

const drive = fs.mkdtempSync(path.join(os.tmpdir(), 'dayflow-drive-'));
const folder = createAgentFolder(drive);
folder.ensure();
const drop = (name, value) => fs.writeFileSync(path.join(folder.dirs.inbox, name), typeof value === 'string' ? value : JSON.stringify(value));

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };

const ctx = await browser.newContext({ serviceWorkers: 'block' });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => { pageErrors.push(String(e)); console.log(`  page error: ${e}`); });

// The bridge, as desktop/preload.js exposes it.
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

const TASK = {
  type: 'new_task', id: 'deal-42-call', title: 'call the refinery about Q1 volumes',
  notes: '<img src=x onerror="window.__pwned=1"> ask about the Djibouti slot', due: '2030-01-15',
  owner: 'me', deal: 'Djibouti diesel', agent: 'deal-bot', source_url: 'https://example.com/thread/42',
};
drop('first.json', [TASK, { ...TASK, id: 'owed-1', title: 'send the signed term sheet', owner: 'Abebe', notes: '' },
  { ...TASK, id: 'skip-1', title: 'buy a boat', notes: '' }]);
drop('broken.json', '{ this is not json');
drop('bad-field.json', { ...TASK, id: 'x', due: 'next week' });

// A stand-in sync project, as the other e2e tests use: signing in is the only
// way into the app, and none of this test is about sync.
const USER = { id: 'user-1', email: 't@example.com', aud: 'authenticated', role: 'authenticated' };
const SESSION = {
  access_token: 'stub-access', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub-refresh', user: USER,
};
let vault = null;
const rows = new Map();
await page.route(u => u.hostname === 'stubproject.supabase.co', r => {
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
  return json({});
});

await page.goto('http://localhost:4871/Claude/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
let inputs = page.locator('input, textarea');
await inputs.nth(0).fill('https://stubproject.supabase.co');
await inputs.nth(1).fill('sb_publishable_stubkeyabcdefghijkl');
await page.getByText('Connect', { exact: true }).click();
await page.waitForTimeout(1200);
await page.getByText('Create an account').click();
await page.waitForTimeout(300);
inputs = page.locator('input, textarea');
await inputs.nth(0).fill('t@example.com');
await inputs.nth(1).fill('a strong master password');
await inputs.nth(2).fill('a strong master password');
await page.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await page.waitForTimeout(2500);
const ack = page.locator('text=/written|saved|wrote|understand|acknowledge/i').first();
if (await ack.count()) await ack.click();
const cont = page.locator('text=/continue|done|open/i').first();
if (await cont.count()) await cont.click();
await page.waitForTimeout(2500);

const body = () => page.evaluate(() => document.body.innerText);
const inDir = d => fs.readdirSync(d).filter(n => !fs.statSync(path.join(d, n)).isDirectory()).sort();

// ── On launch ──
ok('the inbox is emptied on launch', inDir(folder.dirs.inbox).length === 0, inDir(folder.dirs.inbox).join(','));
ok('the valid file moved to processed/', inDir(folder.dirs.processed).includes('first.json'));
ok('both invalid files moved to rejected/, each with a reason',
  ['broken.json', 'broken.json.reason.txt', 'bad-field.json', 'bad-field.json.reason.txt'].every(n => inDir(folder.dirs.rejected).includes(n)),
  inDir(folder.dirs.rejected).join(','));
ok('the reason says what was wrong', fs.readFileSync(path.join(folder.dirs.rejected, 'bad-field.json.reason.txt'), 'utf8').includes('due must be'));
ok('an invalid file did not crash the app', pageErrors.length === 0, pageErrors.join(' | '));

let text = await body();
ok('nothing proposed is on the page before a tap', !/refinery/i.test(text) && !/term sheet/i.test(text));
ok('the Suggested tab shows three waiting', /Suggested 3/.test(text), text.slice(0, 300));

// The Mac app's window has a speech engine object and no service behind it, so
// the microphone used to fail with "Dictation needs a connection" on a Mac that
// was online. It now says where the Mac's own dictation is.
await page.getByLabel('How to dictate on this Mac').click();
await page.waitForTimeout(300);
text = await body();
ok('the microphone in the Mac app points to the Mac\'s dictation', /microphone key \(F5\)/.test(text), text.slice(0, 300));
ok('and never claims to need a connection', !/needs a connection/.test(text));

await page.getByText(/^Suggested 3$/).click();
await page.waitForTimeout(500);
text = await body();
ok('each suggestion shows its agent and deal', /from deal-bot/.test(text) && /Djibouti diesel/.test(text));
ok('it shows the source link', text.includes('https://example.com/thread/42'));
ok('markup in a note is shown as text, not run',
  text.includes('<img src=x') && await page.evaluate(() => window.__pwned === undefined && !document.querySelector('img[src="x"]')));

// ── Accept, dismiss ──
const act = async (title, label) => {
  await page.getByLabel(`${label}: ${title}`).click();
  await page.waitForTimeout(700);
};
await act(TASK.title, 'Accept');
await act('send the signed term sheet', 'Accept');
await act('buy a boat', 'Dismiss');
text = await body();
ok('decided suggestions leave the waiting list', /Nothing waiting/.test(text) && /3 decided/.test(text));

await page.getByText('Finished', { exact: true }).click();
await page.waitForTimeout(300);
const everything = page.getByText('Everything', { exact: true }).first();
if (await everything.count()) await everything.click();
await page.waitForTimeout(600);
for (const view of ['Month', 'MONTH']) {
  const tab = page.getByText(view, { exact: true }).first();
  if (await tab.count()) { await tab.click(); break; }
}
await page.waitForTimeout(600);
text = await body();
ok('an accepted task is on the page, titled like any other', /Call the refinery about Q1 volumes/.test(text), text.slice(0, 400));
ok('it carries its agent label', /from deal-bot · Djibouti diesel/.test(text));
ok('a task owned by someone else is theirs to deliver', /Send the signed term sheet/.test(text) && /Abebe/.test(text));
ok('the dismissed one never reached the page', !/boat/i.test(text));

// ── A status suggestion, and a forged one ──
drop('status.json', { type: 'status_suggestion', id: 'deal-42-done', owner: 'me', deal: 'Djibouti diesel', agent: 'deal-bot',
  target_task_id: 'deal-42-call', suggested_status: 'done', evidence: 'Refinery confirmed by email on 25 Nov.' });
drop('forged.json', { type: 'status_suggestion', id: 'forged', owner: 'me', deal: 'd', agent: 'other-bot',
  target_task_id: 'deal-42-call', suggested_status: 'done', evidence: 'trust me' });
drop('first-again.json', [TASK]);

// With nothing waiting the tab row is folded away like any other time; the
// Projects button brings it back, and Suggested with it.
if (!(await page.getByText(/^Suggested/).count())) await page.getByLabel('Projects').click();
await page.getByText(/^Suggested/).first().click();
await page.waitForTimeout(300);
await page.getByText('Check now').click();
await page.waitForTimeout(1500);
text = await body();
ok('the status suggestion waits, with its evidence', /STATUS CHANGE/.test(text) && /Refinery confirmed by email/.test(text));
ok('another agent\'s suggestion for that task was rejected', inDir(folder.dirs.rejected).includes('forged.json'));
ok('a duplicate proposal added nothing', inDir(folder.dirs.processed).includes('first-again.json') && !/NEW TASK/.test(text));

await page.getByLabel(/^Accept: Mark/).click();
await page.waitForTimeout(800);

// ── The export ──
ok('no export is written while the switch is off', !fs.existsSync(path.join(folder.dirs.exported, 'dayflow-export.json')));
await page.getByLabel('Write my tasks to Google Drive').click();
await page.waitForTimeout(6000);
const exportFile = path.join(folder.dirs.exported, 'dayflow-export.json');
ok('switching it on writes the export', fs.existsSync(exportFile));
if (fs.existsSync(exportFile)) {
  const out = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  const by = id => out.suggestions.find(s => s.id === id) || {};
  ok('the task the status suggestion finished reads completed', by('deal-42-call').status === 'completed', by('deal-42-call').status);
  ok('the other accepted task reads accepted', by('owed-1').status === 'accepted');
  ok('the dismissed one reads dismissed', by('skip-1').status === 'dismissed');
  ok('the export lists the real tasks with their agent', out.tasks.length === 2 && out.tasks.every(t => t.agent && t.agent.name === 'deal-bot'));
}

// ── It survives a reload ──
drop('first-again-2.json', [TASK]);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
if (await page.getByText(/unlock/i).count()) {
  inputs = page.locator('input, textarea');
  const n = await inputs.count();
  await inputs.nth(n > 1 ? 1 : 0).fill('a strong master password');
  if (n > 1) await inputs.nth(0).fill('t@example.com');
  await page.getByText(/unlock/i).last().click();
  await page.waitForTimeout(3000);
}
await page.waitForTimeout(2500);
text = await body();
ok('a file waiting at the next launch is read then', inDir(folder.dirs.processed).includes('first-again-2.json'), inDir(folder.dirs.inbox).join(','));
ok('after a reload nothing decided comes back as waiting', !/Suggested \d/.test(text), text.slice(0, 200));
ok('no page errors anywhere', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();
fs.rmSync(drive, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
