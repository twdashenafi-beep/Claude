// Asking for the thing back.
//
// Owe Me has always known who owes you what and how long it has been, and has
// never once helped you ask. This writes the asking — per person rather than
// per task, because if the agent owes you the inventory and the meter reading
// that is one message, not two, and anybody who sends two looks like they
// cannot keep track of their own paperwork.
//
// The wording is checked closely here for one reason: it goes out under the
// user's name. It has to be something nobody would be embarrassed to have sent.
//
// Run with `npm test`.
import { chaseMessage, owedBy } from '../src/services/chase.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const NOW = new Date('2026-09-15T12:00:00');
const ago = d => new Date(NOW.getTime() - d * 86400000).toISOString();
const owed = (person, title, days, extra = {}) => ({
  taskType: 'done_for_me', owePerson: person, title, createdAt: ago(days), ...extra,
});

const TASKS = [
  owed('Marchetti', 'The signed inventory', 21),
  owed('Marchetti', 'The meter reading', 5),
  owed('Okafor', 'The deposit back', 1),
  { taskType: 'todo', title: 'Cancel the gym membership', createdAt: ago(3) },
];
const msg = (person, tasks = TASKS) => chaseMessage(tasks, person, NOW);

// ── Nothing to ask for ──
ok('nobody owes nobody', msg('') === null);
ok('a name with nothing against it', msg('Nigel') === null);
ok('no tasks at all', chaseMessage([], 'Marchetti', NOW) === null);
ok('nor a list that is not one', chaseMessage(null, 'Marchetti', NOW) === null);
ok('and a To Do is not owed by anyone',
   chaseMessage([{ taskType: 'todo', owePerson: 'Marchetti', title: 'x', createdAt: ago(2) }],
                'Marchetti', NOW) === null);

// ── One thing ──
{
  const m = msg('Okafor');
  ok('it greets them by name', m.startsWith('Hi Okafor'), m);
  ok('it names the thing', m.includes('the deposit back'), m);
  ok('it asks rather than demands', m.includes('could you let me know'), m);
  ok('and says how long it has been', m.includes('asked about it yesterday'), m);
  ok('with no bullet points for a single thing', !m.includes('•'), m);
  ok('and it is one line', !m.includes('\n'), JSON.stringify(m));
}

// ── More than one ──
//
// The whole point. One message, oldest first, so a single reply can clear the
// lot and nobody is chased twice in a day.
{
  const m = msg('Marchetti');
  ok('it greets them once', (m.match(/Hi Marchetti/g) || []).length === 1, m);
  ok('it lists both things', m.includes('The signed inventory') && m.includes('The meter reading'), m);
  ok('as bullets', (m.match(/•/g) || []).length === 2, m);
  ok('oldest first, because that is the one they have sat on',
     m.indexOf('The signed inventory') < m.indexOf('The meter reading'), m);
  ok('each with how long it has waited',
     m.includes('asked 3 weeks ago') && m.includes('asked 5 days ago'), m);
  ok('and nothing belonging to anybody else', !m.includes('deposit'), m);
  ok('nor anything from the other column', !m.includes('gym'), m);
}

// ── What is no longer owed ──
ok('a finished thing is not chased',
   msg('Okafor', [owed('Okafor', 'The deposit back', 1, { completed: true })]) === null);
ok('nor an archived one',
   msg('Okafor', [owed('Okafor', 'The deposit back', 1, { archivedAt: ago(0) })]) === null);
{
  const m = msg('Marchetti', [
    owed('Marchetti', 'The signed inventory', 21),
    owed('Marchetti', 'The meter reading', 5, { completed: true }),
  ]);
  ok('one done and one not becomes a single ask', !m.includes('•'), m);
  ok('and it is the one still outstanding', m.includes('the signed inventory'), m);
}

// ── Names ──
ok('the name is matched however it was typed',
   msg('marchetti').startsWith('Hi marchetti'), msg('marchetti'));
ok('and padding does not hide it', msg('  Okafor  ') !== null);
ok('but a different person is a different person', msg('Marchett') === null);

// ── Titles keep their own capitals ──
//
// A title dropped into the middle of a sentence has to read like the middle of
// a sentence — except when the first word is a name or an initialism, which
// must not be quietly lowercased.
ok('an ordinary title is lowercased into the sentence',
   msg('Sam', [owed('Sam', 'The spare keys', 2)]).includes('where the spare keys has got to'),
   msg('Sam', [owed('Sam', 'The spare keys', 2)]));
ok('an initialism is left alone',
   msg('Sam', [owed('Sam', 'BACS details', 2)]).includes('where BACS details'),
   msg('Sam', [owed('Sam', 'BACS details', 2)]));
ok('and a deliberate spelling is left alone',
   msg('Sam', [owed('Sam', 'iPhone case', 2)]).includes('where iPhone case'),
   msg('Sam', [owed('Sam', 'iPhone case', 2)]));
ok('a name at the front is left alone',
   msg('Sam', [owed('Sam', 'Marchetti paperwork', 2)]).includes('where Marchetti paperwork'),
   msg('Sam', [owed('Sam', 'Marchetti paperwork', 2)]));

// ── Time ──
ok('something asked today says so',
   msg('Sam', [owed('Sam', 'The keys', 0)]).includes('earlier today'),
   msg('Sam', [owed('Sam', 'The keys', 0)]));
ok('and a task with no date at all simply does not say when',
   msg('Sam', [{ taskType: 'done_for_me', owePerson: 'Sam', title: 'The keys' }])
     === 'Hi Sam — could you let me know where the keys has got to?',
   msg('Sam', [{ taskType: 'done_for_me', owePerson: 'Sam', title: 'The keys' }]));

// ── Nothing embarrassing ──
//
// It goes out under your name. No guilt, no apology, no exclamation marks.
{
  const all = ['Marchetti', 'Okafor'].map(p => msg(p)).join('\n');
  ok('it never scolds', !/\b(still|again|chase|urgent|asap|reminder)\b/i.test(all), all);
  ok('it never apologises', !/\b(sorry|apolog)/i.test(all), all);
  ok('and it never shouts', !all.includes('!'), all);
}

// ── Titles with nothing in them are not asked about ──
ok('a nameless task is not listed',
   msg('Sam', [owed('Sam', '   ', 2)]) === null);
ok('and does not become an empty bullet',
   !(msg('Sam', [owed('Sam', 'The keys', 2), owed('Sam', '', 1)]) || '').includes('• \n'));

// ── owedBy on its own ──
ok('owedBy finds both', owedBy(TASKS, 'Marchetti').length === 2);
ok('oldest first', owedBy(TASKS, 'Marchetti')[0].title === 'The signed inventory');
ok('and nobody is not somebody', owedBy(TASKS, '').length === 0);
ok('a missing list is empty', owedBy(undefined, 'Marchetti').length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
