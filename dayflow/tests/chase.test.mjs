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
import {
  chaseMessage, owedBy, recordChase, chasesOf, chaseCount, lastChase,
  chaseLabel, chaseDetail, historyWith, MAX_CHASES,
} from '../src/services/chase.js';

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

// ── Whether you have already asked ──────────────────────────────────────────
//
// The column could say a thing had been waiting three weeks and could write the
// message asking for it, and knew nothing about whether you had sent one. So
// the row read the same on Thursday as it had on Monday, before you chased —
// and for anybody delegating twenty things a week the question is not how long
// it has been waiting. It is whether they have already asked.
{
  const NOW = new Date(2026, 8, 26, 9, 0);
  const at = (m, d) => new Date(2026, m, d, 9, 0);
  const owed = { id: 'x', title: 'The survey', taskType: 'done_for_me', owePerson: 'Marchetti',
                 createdAt: '2026-09-05T09:00:00.000Z' };

  ok('a task never chased says nothing', chaseLabel(owed) === null);
  ok('and has no detail either', chaseDetail(owed, NOW) === null);
  ok('nor a count', chaseCount(owed) === 0);
  ok('nor a last time', lastChase(owed) === null);

  const once = { ...owed, ...recordChase(owed, at(8, 12)) };
  ok('one chase is counted', chaseCount(once) === 1);
  ok('and said on the row', chaseLabel(once) === 'chased once', String(chaseLabel(once)));
  ok('with the when in the sheet', chaseDetail(once, NOW) === 'Chased once — 2 weeks ago',
     chaseDetail(once, NOW));

  const twice = { ...once, ...recordChase(once, at(8, 25)) };
  ok('two is twice', chaseLabel(twice) === 'chased twice', String(chaseLabel(twice)));
  ok('and the last one is the one reported',
     chaseDetail(twice, NOW) === 'Chased twice — yesterday', chaseDetail(twice, NOW));

  const thrice = { ...twice, ...recordChase(twice, NOW) };
  ok('past two it is a number', chaseLabel(thrice) === 'chased 3 times',
     String(chaseLabel(thrice)));
  ok('and today is today', chaseDetail(thrice, NOW) === 'Chased 3 times — earlier today',
     chaseDetail(thrice, NOW));

  // A finished thing is not being chased, whatever it says underneath.
  ok('a completed task says nothing', chaseLabel({ ...thrice, completed: true }) === null);
  ok('nor does an archived one', chaseLabel({ ...thrice, archivedAt: 'x' }) === null);
}

// The record is a list rather than a count and a date, because those two would
// eventually disagree.
{
  const NOW = new Date(2026, 8, 26, 9, 0);
  let task = { id: 'y' };
  for (let i = 0; i < MAX_CHASES + 6; i += 1) {
    task = { ...task, ...recordChase(task, new Date(2026, 0, 1 + i, 9, 0)) };
  }
  ok('the list is bounded', chasesOf(task).length === MAX_CHASES, String(chasesOf(task).length));
  ok('and what is kept is what happened most recently',
     lastChase(task).getDate() === 1 + MAX_CHASES + 5,
     lastChase(task).toDateString());
}

// Junk in the field is not a chase.
ok('a list of nonsense counts nothing', chaseCount({ chases: ['soon', null, 42] }) === 0);
ok('and a field that is not a list is survived', chaseCount({ chases: 'twice' }) === 0);
ok('out-of-order stamps still report the latest', (() => {
  const t = { chases: ['2026-09-20T09:00:00.000Z', '2026-09-01T09:00:00.000Z'] };
  return lastChase(t).getDate() === 20;
})());

// ── Everything you have with one person ──────────────────────────────────────
//
// A different question from owedBy, and the difference is the point: what is
// outstanding shrinks as things arrive, what you have with somebody does not.
{
  const list = [
    owed('Marchetti', 'The signed inventory', 20),
    owed('Marchetti', 'The meter reading', 12, { completed: true }),
    owed('marchetti', 'The gate key', 3),
    owed('Okafor', 'The deposit back', 9),
    { taskType: 'todo', title: 'Cancel the gym membership', createdAt: ago(1) },
  ];

  ok('a finished thing still counts towards the person',
     historyWith(list, 'Marchetti').length === 3,
     JSON.stringify(historyWith(list, 'Marchetti').map(t => t.title)));
  ok('while what they still owe does not',
     owedBy(list, 'Marchetti').length === 2);
  ok('the name is matched however it was typed',
     historyWith(list, '  MARCHETTI ').length === 3);
  ok('and nobody else is swept in',
     !historyWith(list, 'Marchetti').some(t => t.title.includes('deposit')));
  ok('nor anything from the other column',
     !historyWith(list, 'Marchetti').some(t => t.title.includes('gym')));
  ok('oldest first, the way the chase reads them',
     historyWith(list, 'Marchetti')[0].title === 'The signed inventory');
  ok('no name asks nothing', historyWith(list, '   ').length === 0);
  ok('and neither does no list', historyWith(null, 'Marchetti').length === 0);

  // An archived task is still a thing that happened with them. It is out of the
  // chase because you are not asking for it any more, not because it never was.
  const filed = [...list, owed('Marchetti', 'The old invoice', 90, { archivedAt: ago(60) })];
  ok('and a filed one is still part of the history',
     historyWith(filed, 'Marchetti').length === 4);
  ok('though never part of the chase', owedBy(filed, 'Marchetti').length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
