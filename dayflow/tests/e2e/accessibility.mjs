// Every control, read aloud.
//
// A screen reader does not see a layout. It sees a list of controls, each with
// a name, and anything without one is announced as "button" — which is the same
// as not being there. So this walks the app surface by surface and asks three
// questions of every control it can find: does it have a name, does a text
// field have one (a placeholder is not a label: it is gone the moment anything
// is typed), and is it big enough to hit.
//
// Twenty-four pixels is the floor, which is WCAG's minimum rather than Apple's
// forty-four. Forty-four everywhere would mean rebuilding the sheets at half
// the density, and several controls here are deliberately quiet — a row of
// chips, a hairline of navigation. What is not deliberate is a twelve-pixel
// target, and that is what this catches.
//
// The numbers come from the rendered page rather than the source, which matters
// more than it sounds: hitSlop is React Native's way of making a small control
// hittable and react-native-web ignores it completely. Four controls in this app
// were relying on it, on the platform where it does nothing.
//
// Needs a build and a browser:
//   npm i -D playwright && npx playwright install chromium
//   npm run build:pages
//   npm run test:e2e
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('needs playwright');
  process.exit(1);
}
//   npm i -D playwright && npx playwright install chromium
//   npm run build:pages
//   npm run test:e2e
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
await new Promise(r => server.listen(4877, r));

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
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };
const ctx = await browser.newContext({ serviceWorkers: 'block' });
const page = await ctx.newPage();
page.on('pageerror', e => console.log(`  page error: ${e}`));
await page.route(u => u.hostname === 'stubproject.supabase.co', route);
await page.goto('http://localhost:4877/Claude/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const AUDIT = () => {
  const named = el => {
    const label = (el.getAttribute('aria-label') || '').trim();
    if (label) return label;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const target = document.getElementById(by);
      if (target && (target.innerText || '').trim()) return target.innerText.trim();
    }
    const text = (el.innerText || '').trim();
    if (text) return text;
    const title = (el.getAttribute('title') || '').trim();
    return title || '';
  };
  const controls = [...document.querySelectorAll(
    '[role="button"],[role="checkbox"],[role="radio"],[role="link"],[role="switch"],button,a,input,textarea,select'
  )];
  return controls.map(el => {
    const r = el.getBoundingClientRect();
    return {
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      name: named(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
      visible: r.width > 0 && r.height > 0,
      checked: el.getAttribute('aria-checked'),
      tag: el.tagName.toLowerCase(),
      snippet: (el.outerHTML || '').slice(0, 110),
    };
  }).filter(c => c.visible);
};

const MIN = 24;

const look = async label => {
  const found = await page.evaluate(AUDIT);
  const controls = found.filter(c => c.tag !== 'input' && c.tag !== 'textarea');
  const fields = found.filter(c => c.tag === 'input' || c.tag === 'textarea');

  const unnamed = controls.filter(c => !c.name);
  const anonymous = fields.filter(c => !c.name);
  const small = found.filter(c => c.name && (c.w < MIN || c.h < MIN));

  ok(`${label}: there is something to look at`, found.length > 0, String(found.length));
  ok(`${label}: every control says what it is`, unnamed.length === 0,
     JSON.stringify(unnamed.map(c => c.snippet)));
  ok(`${label}: every field is named, not merely hinted at`, anonymous.length === 0,
     JSON.stringify(anonymous.map(c => c.snippet)));
  ok(`${label}: nothing is too small to hit`, small.length === 0,
     JSON.stringify(small.map(c => `${c.name} ${c.w}x${c.h}`)));
};

await look('connect screen');

let inputs = page.locator('input, textarea');
await inputs.nth(0).fill(PROJECT);
await inputs.nth(1).fill(KEY);
await page.getByText('Connect', { exact: true }).click();
await page.waitForTimeout(1200);
await look('sign in');

await page.getByText('Create an account').click();
await page.waitForTimeout(400);
await look('create an account');
inputs = page.locator('input, textarea');
await inputs.nth(0).fill(USER.email);
await inputs.nth(1).fill('a strong master password');
await inputs.nth(2).fill('a strong master password');
await page.getByText('CREATE ACCOUNT', { exact: false }).first().click();
await page.waitForTimeout(2500);
await look('recovery code');
const ack = page.locator('text=/written|saved|wrote|understand|acknowledge/i').first();
if (await ack.count()) await ack.click();
const cont = page.locator('text=/continue|done|open/i').first();
if (await cont.count()) await cont.click();
await page.waitForTimeout(1500);

const box = page.locator('input, textarea').first();
await box.fill('Ring the letting agent');
await box.press('Enter');
await page.waitForTimeout(900);
await box.fill('Owe me the survey from Marchetti');
await box.press('Enter');
await page.waitForTimeout(900);
await look('the page');

await page.getByLabel('Add a task to To Do').click();
await page.waitForTimeout(600);
await look('add sheet');
await page.getByText('Cancel', { exact: true }).last().click();
await page.waitForTimeout(600);

await page.locator('text=Ring the letting agent').first().click();
await page.waitForTimeout(900);
await look('task sheet');
await page.getByText('Cancel', { exact: true }).last().click();
await page.waitForTimeout(700);

await page.getByLabel('Account settings').click();
await page.waitForTimeout(700);
await look('account');
await page.getByText('Done', { exact: true }).first().click();
await page.waitForTimeout(600);

await page.getByLabel('Search').click();
await page.waitForTimeout(700);
await look('search');
// Closed by its own button. Escape left the sheet open, and everything below
// was then audited through it — which is how a walk of the whole app quietly
// covers half of it.
await page.getByLabel('Close search').click();
await page.waitForTimeout(700);

await page.getByLabel('Projects').click();
await page.waitForTimeout(800);
await look('projects');
const naming = page.getByLabel('New project');
if (await naming.count()) {
  await naming.click();
  await page.waitForTimeout(500);
  await look('naming a project');
  // Out of the naming row by its own Cancel: Escape left it open, and the two
  // surfaces below were audited through it — the same mistake as the search
  // sheet above, found the same way, by the numbers not changing.
  const giveUp = page.getByLabel('Cancel', { exact: true });
  if (await giveUp.count()) await giveUp.first().click();
  await page.waitForTimeout(600);
}

const archive = page.getByLabel('Archive', { exact: true });
if (await archive.count()) {
  await archive.click();
  await page.waitForTimeout(900);
  await look('archive');
}

const briefing = page.getByLabel('Open the daily briefing');
if (await briefing.count()) {
  await briefing.click();
  await page.waitForTimeout(900);
  await look('briefing');
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
