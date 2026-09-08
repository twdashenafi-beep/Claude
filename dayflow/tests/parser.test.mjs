// Parser tests: which list something spoken or typed ends up in.
//
// Owe Me is a follow-up list — someone owes you a thing and you need to chase
// it — so the wording has to decide the list, not whichever tab happened to be
// open. Pure logic. Run with `npm test`.

import { parseNaturalLanguage, detectColumn } from '../src/services/nlParser.js';

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

// ── A command with no task in it produces no task ──
//
// This used to assert the opposite — that a bare marker still produced a title —
// on the reasoning that an empty title was worse than a strange one. It is not:
// the strange one was a task called "owe me" sitting in the list, which is what
// a routing word is precisely not. The caller declines an empty title instead
// and leaves the words in the box to be finished.
ok('a bare marker produces no title', parse('owe me').title === '');
ok('and a marker with a real task after it does', parse('owe me the deck').title === 'the deck');

// ── detectColumn on its own ──
ok('a plain task is not owed', detectColumn('call the bank').isOwe === false);
ok('a plain task text is left alone', detectColumn('call the bank').text === 'call the bank');
ok('a plain task names no column', detectColumn('call the bank').commanded === false);
ok('an empty input survives', detectColumn('').isOwe === false);
ok('undefined survives', detectColumn(undefined).isOwe === false);

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

// ── The column named out loud does not become part of the task ──
//
// Saying "Owe me call Mekdi" is an instruction about where the task goes
// followed by the task. Leaving the instruction in fills the list with entries
// called "Owe Me call Mekdi", which is what this is all for.
const title = t => parse(t).title;
const isOwe = t => parse(t).taskType === 'done_for_me';

ok('Owe Me routes and does not appear in the title',
   isOwe('Owe me call Mekdi about the deposit')
   && title('Owe me call Mekdi about the deposit') === 'call Mekdi about the deposit');
ok('however it is capitalised', title('Owe Me call Mekdi') === 'call Mekdi');
ok('and hyphenated', title('Owe-me call Mekdi') === 'call Mekdi');

ok('To Do routes and does not appear either',
   !isOwe('To do buy milk') && title('To do buy milk') === 'buy milk');
ok('To Do hyphenated', title('To-do buy milk') === 'buy milk');
ok('To Do run together', title('Todo buy milk') === 'buy milk');
ok('and pluralised, as dictation sometimes does', title('To-dos buy milk') === 'buy milk');

// Dictation punctuates whether you want it to or not.
ok('a colon after the command goes with it', title('Owe me: the signed lease') === 'the signed lease');
ok('a comma too', title('Owe me, call the bank') === 'call the bank');
ok('and a full stop', title('Owe me. Call the bank') === 'Call the bank');
ok('a full stop after To Do too', title('To do. Buy milk') === 'Buy milk');

// The run-up before the column name is part of the instruction.
ok('"add to" is consumed with the command', title('Add to owe me the deposit') === 'the deposit');
ok('"put in" as well', title('Put in owe me the deposit') === 'the deposit');
ok('and a longer run-up', title('Add a task to to do buy milk') === 'buy milk');
ok('the run-up does not change where it goes', isOwe('Add to owe me the deposit'));

// A command and nothing else is not a task.
ok('saying only Owe Me makes no title', title('Owe me') === '');
ok('saying only To Do makes no title', title('To do') === '');
ok('nor with its punctuation', title('Owe me:') === '');

// ── And ordinary English is left alone ──
//
// "to do" is a phrase people use. Only the opening of a line is an instruction.
ok('to do mid-sentence is part of the task',
   title('the shopping I need to do tomorrow') === 'the shopping I need to do');
ok('a to-do inside a task survives', title('Buy a to-do notebook') === 'Buy a to-do notebook');
ok('and owes me mid-sentence still finds the person',
   parse('Sarah owes me the deck').owePerson === 'Sarah');
ok('with the marker out of the title', title('Sarah owes me the deck') === 'the deck');
ok('waiting on still works', title('waiting on Tom for the deck') === 'the deck');
ok('a plain task is untouched', title('call the bank') === 'call the bank');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
