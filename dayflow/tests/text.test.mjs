// Task titles start with a capital.
//
// The rule is one line; the care is in the exception. A word that already
// carries a capital is spelled that way on purpose, and forcing the first
// letter would break exactly the words people are fussiest about.
//
// Run with `npm test`.
import { capitalizeTitle } from '../src/utils/text.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};
const is = (input, want) =>
  ok(`${JSON.stringify(input)} → ${JSON.stringify(want)}`,
     capitalizeTitle(input) === want, JSON.stringify(capitalizeTitle(input)));

// ── The rule ──
is('call Mekdi about the deposit', 'Call Mekdi about the deposit');
is('the shopping', 'The shopping');
is('buy milk', 'Buy milk');
is('x', 'X');

// ── Already capital, left alone ──
is('Buy milk', 'Buy milk');
is('Call the bank', 'Call the bank');

// ── A capital elsewhere in the first word means it is deliberate ──
is('iPhone repair', 'iPhone repair');
is('eBay listing', 'eBay listing');
is('macOS update', 'macOS update');
is('iPad case', 'iPad case');
ok('but a capital in a later word does not protect the first',
   capitalizeTitle('call Mekdi') === 'Call Mekdi');

// ── Nothing to capitalise ──
is('3 boxes for the move', '3 boxes for the move');
is('£40 to Tom', '£40 to Tom');
is('', '');
is('   ', '   ');
ok('undefined is empty', capitalizeTitle(undefined) === '');
ok('null is empty', capitalizeTitle(null) === '');

// ── Leading space is kept, not trimmed ──
//
// Trimming would be a second, unrelated change, and a title is trimmed by the
// caller that built it.
is('  spaced out', '  Spaced out');

// ── Accents ──
is('é la carte', 'É la carte');
is('ölçü tape', 'Ölçü tape');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
