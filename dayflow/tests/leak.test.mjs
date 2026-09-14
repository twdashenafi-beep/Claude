// What the server can actually read.
//
// The app promises that everything it syncs is ciphertext. This is the code
// that checks the promise rather than repeating it, so what matters most here
// is that it cannot be fooled in either direction: it must catch plaintext that
// is really there, and it must not cry wolf about base64, because a false alarm
// about your own encryption is worse than no alarm at all.
//
// Run with `npm test`.
import { inspectRows } from '../src/services/leak.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// What crypto-js actually writes: base64 of "Salted__" and the rest.
const SEALED = 'U2FsdGVkX1+9kP2mQvR7xYzAbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/==';
const TITLES = ['The signed inventory', 'Cancel the gym membership', 'Call Priya'];
const sealed = (n = 1) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, ciphertext: SEALED }));

// ── Nothing to judge ──
ok('no rows at all is not a verdict', inspectRows([], TITLES).verdict === 'empty');
ok('nor is null', inspectRows(null, TITLES).verdict === 'empty');
ok('nor rows that carry no ciphertext',
   inspectRows([{ id: 'a' }, { id: 'b', ciphertext: '' }], TITLES).verdict === 'empty');
ok('and a junk row does not throw',
   inspectRows([null, undefined, 42, { ciphertext: null }], TITLES).verdict === 'empty');

// ── Sealed ──
{
  const r = inspectRows(sealed(3), TITLES);
  ok('base64 is judged unreadable', r.verdict === 'clear');
  ok('and it says how many rows it looked at', r.checked === 3, String(r.checked));
  ok('and hands back enough of one to see', r.sample.length === 28, r.sample);
  ok('which is the start of the real row', SEALED.startsWith(r.sample), r.sample);
  ok('with no reason, because there is nothing to report', r.reason === null);
}
ok('rows with nothing in them are not counted',
   inspectRows([{ ciphertext: '' }, ...sealed(2)], TITLES).checked === 2);
ok('no titles to go on is still a verdict', inspectRows(sealed(1), []).verdict === 'clear');
ok('and so is a list full of nothing',
   inspectRows(sealed(1), [null, undefined, '']).verdict === 'clear');

// ── The failure this exists for ──
//
// A task is stored as encrypt(JSON.stringify(task)). An encrypt() that could
// not find a source of randomness used to fail by returning its input, so the
// row held the task's own JSON while every screen looked perfectly normal.
{
  const plain = JSON.stringify({ id: 'x', title: 'The signed inventory', taskType: 'done_for_me' });
  const r = inspectRows([{ id: 'x', ciphertext: plain }], TITLES);
  ok('a task stored as its own JSON is caught', r.verdict === 'exposed');
  ok('and named for what it is', r.reason === 'it is stored as plain text', r.reason);
  ok('and shows the row that gave it away', r.sample.startsWith('{"id"'), r.sample);
}
ok('an array of them too',
   inspectRows([{ ciphertext: '[{"title":"x"}]' }], TITLES).verdict === 'exposed');
ok('and leading whitespace does not hide it',
   inspectRows([{ ciphertext: '\n  {"title":"x"}' }], TITLES).verdict === 'exposed');

// ── Your own words ──
{
  const r = inspectRows([{ ciphertext: `xxxx The signed inventory xxxx` }], TITLES);
  ok('a title sitting in the clear is caught', r.verdict === 'exposed');
  ok('and quoted back, so it is obvious what leaked',
     r.reason.includes('The signed inventory'), r.reason);
}
ok('one bad row among good ones is still found',
   inspectRows([...sealed(2), { ciphertext: 'Cancel the gym membership' }, ...sealed(2)].flat(),
               TITLES).verdict === 'exposed');
ok('and the count says how far it got',
   inspectRows([...sealed(2), { ciphertext: 'Cancel the gym membership' }], TITLES).checked === 3);

// ── It must not cry wolf ──
//
// Base64 is letters and digits, so a short enough word turns up in it by
// chance. Six characters is the floor for evidence; below that the JSON test
// above is what catches a real failure.
ok('a four-letter title is not evidence',
   inspectRows([{ ciphertext: 'U2FsdGVkX1+Call9kP2mQvR7xYz' }], ['Call']).verdict === 'clear');
ok('a five-letter one is not either',
   inspectRows([{ ciphertext: 'U2FsdGVkX1+Vlad9kPz' }], ['Vlad']).verdict === 'clear');
ok('but six is',
   inspectRows([{ ciphertext: 'U2FsdGVkX1+Priya!9kPz' }], ['Priya!']).verdict === 'exposed');
ok('a title that is only spaces is not evidence',
   inspectRows(sealed(1), ['        ']).verdict === 'clear');
ok('and nor is one that appears nowhere',
   inspectRows(sealed(1), ['Something else entirely']).verdict === 'clear');

// ── Many titles ──
//
// Only so many are worth walking, and the longest are the most distinctive. The
// cap must not let a real leak through at the front of the list.
{
  const many = Array.from({ length: 400 }, (_, i) => `Task number ${i} of many`);
  const r = inspectRows([{ ciphertext: `xx ${many[399]} xx` }], many);
  // Only so many titles are walked, so this one is past the cap and is caught
  // by the alphabet instead. That is the point of having the third test: the
  // bound on the second one cannot let anything through.
  ok('a leak past the cap on titles is still caught',
     r.verdict === 'exposed', JSON.stringify(r));
  ok('by the alphabet rather than by the words',
     r.reason === 'it is not ciphertext at all', r.reason);
  ok('and four hundred titles against sealed rows stays clear',
     inspectRows(sealed(50), many).verdict === 'clear');
}
ok('duplicate titles do not confuse it',
   inspectRows(sealed(1), ['Repeated title', 'Repeated title']).verdict === 'clear');

// ── The test that needs nothing to compare against ──
//
// AES out of crypto-js is strict base64 and nothing else — checked, not
// assumed. So a single character outside that alphabet is proof, whoever the
// vault belongs to and whatever is in it.
ok('a space is proof',
   inspectRows([{ ciphertext: 'U2FsdGVkX1 9kP2mQvR7' }], []).verdict === 'exposed');
ok('and an apostrophe',
   inspectRows([{ ciphertext: "U2FsdGVkX1'9kP2mQvR7" }], []).verdict === 'exposed');
ok('and a pound sign',
   inspectRows([{ ciphertext: 'U2FsdGVkX1£9kP2mQvR7' }], []).verdict === 'exposed');
ok('and it names itself plainly',
   inspectRows([{ ciphertext: 'not encrypted' }], []).reason === 'it is not ciphertext at all',
   inspectRows([{ ciphertext: 'not encrypted' }], []).reason);
ok('a title with no spaces or punctuation is caught even with no titles to go on',
   inspectRows([{ ciphertext: 'Chase Priya' }], []).verdict === 'exposed');

// And it must not fire on the real thing. Every character crypto-js emits is
// in the alphabet, trailing padding and newline included.
ok('real ciphertext passes', inspectRows(sealed(1), []).verdict === 'clear');
ok('padding does not trip it',
   inspectRows([{ ciphertext: 'U2FsdGVkX19rZXk=' }], []).verdict === 'clear');
ok('nor a trailing newline',
   inspectRows([{ ciphertext: 'U2FsdGVkX19rZXk=\n' }], []).verdict === 'clear');

// The real generator, rather than a string that looks like one.
{
  const { createRequire } = await import('node:module');
  const CryptoJS = createRequire(import.meta.url)('crypto-js');
  const rows = [];
  for (let i = 0; i < 50; i += 1) {
    rows.push({
      id: `r${i}`,
      ciphertext: CryptoJS.AES.encrypt(
        JSON.stringify({ id: i, title: TITLES[i % 3], notes: 'Owed £250 since March' }),
        `a master key ${i}`
      ).toString(),
    });
  }
  const r = inspectRows(rows, TITLES);
  ok('fifty rows from the app\'s own encryption read as sealed',
     r.verdict === 'clear', JSON.stringify(r));
  ok('and all fifty were looked at', r.checked === 50, String(r.checked));

  // The regression this whole check exists for, reproduced exactly: encrypt()
  // handing back what it was given.
  const broken = { id: 'bad', ciphertext: JSON.stringify({ id: 'bad', title: TITLES[0] }) };
  const caught = inspectRows([...rows.slice(0, 10), broken, ...rows.slice(10)], TITLES);
  ok('one unencrypted row hidden among fifty sealed ones is found',
     caught.verdict === 'exposed', JSON.stringify(caught));
  ok('and it is named for what went wrong',
     caught.reason === 'it is stored as plain text', caught.reason);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
