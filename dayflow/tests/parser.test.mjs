// Parser tests: which list something spoken or typed ends up in.
//
// Owe Me is a follow-up list — someone owes you a thing and you need to chase
// it — so the wording has to decide the list, not whichever tab happened to be
// open. Pure logic. Run with `npm test`.

import { parseNaturalLanguage, detectOwe } from '../src/services/nlParser.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const parse = t => parseNaturalLanguage(t);
const OWE = 'done_for_me';

// ── The phrasings that mean "someone owes me this" ──
const owed = {
  'owe me the signed lease': ['', 'the signed lease'],
  'Owe me: the signed lease': ['', 'the signed lease'],
  'Sarah owes me the Q3 numbers': ['Sarah', 'the Q3 numbers'],
  'sarah owes me the q3 numbers': ['Sarah', 'the q3 numbers'],
  'waiting on Tom for the deck': ['Tom', 'the deck'],
  'waiting for Tom to send the deck': ['Tom', 'send the deck'],
  'chase Priya for the signature': ['Priya', 'the signature'],
  'chase up Priya about the signature': ['Priya', 'the signature'],
  'follow up with James about the contract': ['James', 'the contract'],
};

for (const [input, [person, title]] of Object.entries(owed)) {
  const r = parse(input);
  ok(`"${input}" goes to Owe Me`, r.taskType === OWE, r.taskType);
  ok(`"${input}" names ${person || 'nobody'}`, r.owePerson === person, JSON.stringify(r.owePerson));
  ok(`"${input}" keeps the substance`, r.title === title, JSON.stringify(r.title));
}

// ── Ordinary tasks are untouched ──
for (const input of [
  'call the bank tomorrow at 3pm',
  'pay the rent',
  'book flights next week',
  'I owe Sarah a call',
]) {
  ok(`"${input}" stays in To Do`, parse(input).taskType === 'todo', parse(input).taskType);
}

// ── A word in a name's place that is not a name ──
ok('"waiting on the report" is not filed under a person called "the"',
   parse('waiting on the report').owePerson === '');
ok('"you owe me the numbers" files no person',
   parse('you owe me the numbers').owePerson === '');
ok('"you owe me the numbers" is still Owe Me',
   parse('you owe me the numbers').taskType === OWE);

// ── Dates and priority still work through the marker ──
const dated = parse('Sarah owes me the deck tomorrow');
ok('a date after the marker is still read', !!dated.dueDate);
ok('the date is taken out of the title', dated.title === 'the deck', JSON.stringify(dated.title));
ok('the person survives date extraction', dated.owePerson === 'Sarah');

const urgent = parse('urgent: chase Tom for the invoice');
ok('priority is still read', urgent.priority === 'high');
ok('priority does not stop Owe Me routing', urgent.taskType === OWE);

const timed = parse('waiting on Tom for the deck at 3pm');
ok('a time after the marker is still read', timed.dueTime === '15:00', String(timed.dueTime));

// ── Never an empty title ──
ok('a bare marker still produces a title', parse('owe me').title.length > 0);

// ── detectOwe on its own ──
ok('detectOwe reports a plain task as not owed', detectOwe('call the bank').isOwe === false);
ok('detectOwe leaves a plain task text alone', detectOwe('call the bank').text === 'call the bank');
ok('detectOwe survives an empty input', detectOwe('').isOwe === false);
ok('detectOwe survives undefined', detectOwe(undefined).isOwe === false);

// ── Which scope a task lands in ──
//
// The parser only knows the scope when the words carry a date. Claiming 'day'
// otherwise is not a harmless default: the caller falls back to the page you
// are on, and a default here wins that fallback, so anything typed while on
// Week or Month quietly lands on Day.
ok('no date phrase means no opinion about the scope',
   parse('sink survey').viewScope === null);
ok('a plain task offers no scope either', parse('call the bank').viewScope === null);
ok('a bare time is still no scope', parse('call the bank at 3pm').viewScope === null);
ok('a day phrase says day', parse('call the bank tomorrow').viewScope === 'day');
ok('a week phrase says week', parse('call the bank next week').viewScope === 'week');
ok('a month phrase says month', parse('call the bank next month').viewScope === 'month');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
