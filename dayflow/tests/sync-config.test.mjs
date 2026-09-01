// Sync-config tests: what happens to the two values a person copies out of the
// Supabase dashboard by hand. Pure logic, plus a stubbed fetch for the reachability
// check — no network, no browser. Run with `npm test`.

import { parseConfig, normalizeUrl, normalizeKey, keyRole, verifyConfig }
  from '../src/services/configParse.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

const jwt = role =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role, iss: 'supabase' })).toString('base64url')}.sig`;

const ANON = jwt('anon');
const SERVICE = jwt('service_role');
const URL_OK = 'https://abcdefghijklmnopqrst.supabase.co';

// ── The straightforward case ──
const good = parseConfig(URL_OK, ANON);
ok('a correct pair is accepted', good.ok);
ok('a correct pair is passed through untouched',
   good.ok && good.config.url === URL_OK && good.config.anonKey === ANON);
ok('a correct pair reports no corrections', good.ok && good.fixes.length === 0);

// ── URLs that are almost right ──
ok('trailing slash is removed', normalizeUrl(`${URL_OK}/`) === URL_OK);
ok('a REST path is removed', normalizeUrl(`${URL_OK}/rest/v1`) === URL_OK);
ok('an auth path is removed', normalizeUrl(`${URL_OK}/auth/v1/`) === URL_OK);
ok('a missing scheme is added', normalizeUrl('abcdefghijklmnopqrst.supabase.co') === URL_OK);
ok('surrounding quotes are removed', normalizeUrl(`"${URL_OK}"`) === URL_OK);
ok('surrounding angle brackets are removed', normalizeUrl(`<${URL_OK}>`) === URL_OK);

ok('a dashboard address yields the project URL',
   normalizeUrl('https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api') === URL_OK);
ok('a dashboard address is reported as a correction',
   parseConfig('https://supabase.com/dashboard/project/abcdefghijklmnopqrst', ANON)
     .fixes.some(f => f.includes('dashboard')));

ok('a bare reference id yields the project URL', normalizeUrl('abcdefghijklmnopqrst') === URL_OK);

// ── Keys ──
ok('whitespace inside a key is removed', normalizeKey(`  ${ANON.slice(0, 10)}\n${ANON.slice(10)}  `) === ANON);
ok('the anon role is read off the key', keyRole(ANON) === 'anon');
ok('the service_role is read off the key', keyRole(SERVICE) === 'service_role');
ok('a non-JWT has no role', keyRole('sb_publishable_abc123') === null);
ok('a malformed JWT has no role, rather than throwing', keyRole('a.b.c') === null);

const publishable = parseConfig(URL_OK, 'sb_publishable_abcdef123456');
ok('a publishable key is accepted', publishable.ok);

// ── The refusals that matter ──
const service = parseConfig(URL_OK, SERVICE);
ok('a service_role key is refused', !service.ok);
ok('the service_role refusal says why', !service.ok && /never go in an app/.test(service.error));

const secret = parseConfig(URL_OK, 'sb_secret_abcdef123456');
ok('a secret key is refused', !secret.ok);

const wrongRole = parseConfig(URL_OK, jwt('authenticated'));
ok('a key for some other role is refused', !wrongRole.ok);
ok('the wrong-role refusal names the role', !wrongRole.ok && wrongRole.error.includes('authenticated'));

ok('a key that is not a key at all is refused', !parseConfig(URL_OK, 'hunter2').ok);
ok('a URL that is not a URL is refused', !parseConfig('my project', ANON).ok);
ok('two empty fields are refused', !parseConfig('', '').ok);
ok('a missing key is refused', !parseConfig(URL_OK, '').ok);
ok('a missing URL is refused', !parseConfig('', ANON).ok);

// ── The fields the wrong way round ──
const swapped = parseConfig(ANON, URL_OK);
ok('swapped fields are accepted', swapped.ok);
ok('swapped fields end up in the right places',
   swapped.ok && swapped.config.url === URL_OK && swapped.config.anonKey === ANON);
ok('swapping is reported as a correction', swapped.ok && swapped.fixes.some(f => /wrong way round/.test(f)));

// A project URL splits into three dot-parts just as a JWT does; the swap
// detector must not be fooled by that.
ok('a correct pair is never swapped', good.ok && !good.fixes.some(f => /wrong way round/.test(f)));

// ── Reachability ──
const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const config = { url: URL_OK, anonKey: ANON };

ok('a healthy project verifies',
   (await withFetch(async () => ({ ok: true, status: 200 }), () => verifyConfig(config))).ok);

const rejected = await withFetch(async () => ({ ok: false, status: 401 }), () => verifyConfig(config));
ok('a rejected key does not verify', !rejected.ok);
ok('a rejected key blames the key, not the URL', !rejected.ok && /key/.test(rejected.error));

ok('a rejected legacy key points at the publishable one',
   !rejected.ok && /sb_publishable_/.test(rejected.error));

const rejectedNew = await withFetch(async () => ({ ok: false, status: 401 }),
  () => verifyConfig({ url: URL_OK, anonKey: 'sb_publishable_abcdef123456' }));
ok('a rejected publishable key does not mention legacy keys',
   !rejectedNew.ok && !/legacy/.test(rejectedNew.error));

const unreachable = await withFetch(async () => { throw new Error('ENOTFOUND'); }, () => verifyConfig(config));
ok('an unreachable host does not verify', !unreachable.ok);
ok('an unreachable host blames the URL', !unreachable.ok && unreachable.error.includes(URL_OK));

const notSupabase = await withFetch(async () => ({ ok: false, status: 404 }), () => verifyConfig(config));
ok('a host that is not a Supabase project does not verify', !notSupabase.ok);

const serverError = await withFetch(async () => ({ ok: false, status: 503 }), () => verifyConfig(config));
ok('a server error does not verify', !serverError.ok);

// The verification request must carry the key, or a wrong key would pass.
let sentHeaders = null;
await withFetch(async (_u, init) => { sentHeaders = init.headers; return { ok: true, status: 200 }; },
                () => verifyConfig(config));
ok('the check sends the key as apikey', sentHeaders && sentHeaders.apikey === ANON);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
