// How long opening took, said in a way somebody can act on.
//
// The point of this is not the number but the breakdown: three costs stack up
// behind one wait, and they are fixed in entirely different ways. A line that
// said only "11.2 s" would be no more useful than the complaint it came from.
//
// Run with `npm test`.

import {
  secondsWords, beginOpening, noteStage, openingRecord, openingLine, forgetOpening, nowMs,
  wasSlow,
} from '../src/services/opening.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// ── Durations somebody can read ──
ok('under a second is milliseconds', secondsWords(320) === '320 ms', secondsWords(320));
ok('and rounded, not fractional', secondsWords(320.7) === '321 ms', secondsWords(320.7));
ok('a second or more is seconds', secondsWords(2010) === '2.0 s', secondsWords(2010));
ok('with one decimal, because tenths are what changed', secondsWords(11249) === '11.2 s', secondsWords(11249));
ok('nothing is nothing, not NaN', secondsWords(undefined) === '0 ms', secondsWords(undefined));
ok('and a negative duration cannot be reported', secondsWords(-5) === '0 ms', secondsWords(-5));

// ── The record ──
forgetOpening();
ok('with nothing measured there is nothing to say', openingLine() === '', openingLine());

beginOpening();
noteStage('reading', 320);
noteStage('274 tasks', 2010);
noteStage('16 with recordings', 8900);

{
  const line = openingLine();
  ok('the total is the sum of the parts', /Opened in 11\.2 s/.test(line), line);
  ok('and every part is named', /reading 320 ms/.test(line), line);
  ok('in the order it happened',
     line.indexOf('reading') < line.indexOf('274 tasks')
     && line.indexOf('274 tasks') < line.indexOf('16 with recordings'), line);

  // The whole reason for splitting the two. If the recordings own the wait,
  // the fix is to stop decrypting them at unlock; if they do not, it is not.
  ok('the recordings are reported apart from the rest',
     /274 tasks 2\.0 s/.test(line) && /16 with recordings 8\.9 s/.test(line), line);
}

// ── A second unlock does not report the first one's time ──
beginOpening();
noteStage('reading', 12);
ok('beginning again forgets what went before',
   openingLine() === 'Opened in 12 ms — reading 12 ms', openingLine());
ok('and the record holds one stage, not four', openingRecord().stages.length === 1);

// ── Handed a record rather than reading the stored one ──
ok('a record passed in is used instead',
   openingLine({ total: 500, stages: [{ name: 'x', ms: 500 }] }) === 'Opened in 500 ms — x 500 ms');
ok('an empty one says nothing', openingLine({ total: 0, stages: [] }) === '');
ok('and neither does rubbish', openingLine(null) !== undefined);

// ── The clock ──
{
  const a = nowMs();
  ok('the clock is a number', typeof a === 'number' && Number.isFinite(a));
  ok('and it does not go backwards', nowMs() >= a);
}

// ── Long enough to be worth saying out loud ──
//
// Everything opens in two seconds; nobody needs telling. Twenty is a different
// matter, and the point of the threshold is that the one case gets reported
// without the other becoming noise.
ok('a quick opening says nothing', wasSlow({ total: 1200, stages: [{ name: 'x', ms: 1200 }] }) === false);
ok('eight seconds is where it starts', wasSlow({ total: 8000, stages: [{ name: 'x', ms: 8000 }] }) === true);
ok('and twenty certainly is', wasSlow({ total: 20400, stages: [{ name: 'x', ms: 20400 }] }) === true);
ok('nothing measured is not slow', wasSlow(null) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
