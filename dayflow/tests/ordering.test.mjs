// Ordering tests: dragging a task to where you want it.
//
// Priority says how a task feels; order says where you put it. Pure logic —
// the arithmetic of inserting between neighbours, and of turning a drag
// distance into an index. Run with `npm test`.

import {
  orderOf, sortForDisplay, orderForNewTask, moveWithin, targetIndex, shiftFor,
  placedByTime,
} from '../src/services/ordering.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};
const ids = list => list.map(t => t.id).join(',');
const RANK = { high: 0, medium: 1, low: 2 };
const rankOf = t => RANK[t.priority];

// ── Reading an order off a task ──
ok('a number is an order', orderOf({ order: 3 }) === 3);
ok('zero is an order, not an absence', orderOf({ order: 0 }) === 0);
ok('a negative order is fine — that is the top of the list', orderOf({ order: -2 }) === -2);
ok('a missing order is null', orderOf({}) === null);
ok('a non-numeric order is null', orderOf({ order: 'first' }) === null);
ok('an infinite order is null, not a sort trap', orderOf({ order: Infinity }) === null);
ok('a missing task is null', orderOf(undefined) === null);

// ── Display order ──
{
  const placed = [
    { id: 'c', order: 2, priority: 'low' },
    { id: 'a', order: 0, priority: 'low' },
    { id: 'b', order: 1, priority: 'high' },
  ];
  ok('placed tasks sort by where they were put, not by priority',
     ids(sortForDisplay(placed, rankOf)) === 'a,b,c');
}
{
  const mixed = [
    { id: 'untouched-high', priority: 'high', createdAt: '2026-01-01' },
    { id: 'placed', order: 5, priority: 'low', createdAt: '2026-01-02' },
    { id: 'untouched-low', priority: 'low', createdAt: '2026-01-03' },
  ];
  ok('a task you placed sits above ones you never touched',
     ids(sortForDisplay(mixed, rankOf)) === 'placed,untouched-high,untouched-low');
}
{
  const none = [
    { id: 'low', priority: 'low', createdAt: '2026-01-01' },
    { id: 'high', priority: 'high', createdAt: '2026-01-02' },
    { id: 'mid', priority: 'medium', createdAt: '2026-01-03' },
  ];
  ok('with nothing placed, the old priority order is untouched',
     ids(sortForDisplay(none, rankOf)) === 'high,mid,low');
}
{
  const tie = [
    { id: 'later', priority: 'high', createdAt: '2026-02-01' },
    { id: 'earlier', priority: 'high', createdAt: '2026-01-01' },
  ];
  ok('equal priority falls back to when it was made',
     ids(sortForDisplay(tie, rankOf)) === 'earlier,later');
}
ok('sorting does not mutate its input', (() => {
  const input = [{ id: 'b', order: 1 }, { id: 'a', order: 0 }];
  sortForDisplay(input, rankOf);
  return ids(input) === 'b,a';
})());

// ── Where a new task goes ──
ok('a new task goes above everything placed',
   orderForNewTask([{ order: 0 }, { order: 5 }]) === -1);
ok('the first task in an empty column starts at zero', orderForNewTask([]) === 0);
ok('unplaced tasks do not drag the new one down',
   orderForNewTask([{}, {}]) === 0);

// ── Moving ──
const placed3 = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }, { id: 'c', order: 2 }];

ok('moving to the same place changes nothing', moveWithin(placed3, 1, 1).length === 0);

{
  const changes = moveWithin(placed3, 2, 0);
  ok('moving to the top touches one task', changes.length === 1);
  ok('moving to the top puts it above the rest',
     changes[0].id === 'c' && changes[0].order < 0, JSON.stringify(changes));
}
{
  const changes = moveWithin(placed3, 0, 2);
  ok('moving to the bottom touches one task', changes.length === 1);
  ok('moving to the bottom puts it below the rest',
     changes[0].id === 'a' && changes[0].order > 2, JSON.stringify(changes));
}
{
  const changes = moveWithin(placed3, 0, 1);
  ok('moving into the middle takes a place between the neighbours',
     changes.length === 1 && changes[0].order > 1 && changes[0].order < 2,
     JSON.stringify(changes));
}
{
  // Applying the change and re-sorting has to produce what was dragged.
  const changes = moveWithin(placed3, 0, 1);
  const applied = placed3.map(t => {
    const change = changes.find(c => c.id === t.id);
    return change ? { ...t, order: change.order } : t;
  });
  ok('the result is the order you dragged',
     ids(sortForDisplay(applied, () => 0)) === 'b,a,c');
}
{
  const unplaced = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const changes = moveWithin(unplaced, 2, 0);
  ok('a column that was never ordered is numbered once, in full',
     changes.length === 3, JSON.stringify(changes));
  ok('and numbered into the order dragged',
     changes.map(c => c.id).join(',') === 'c,a,b');
}
{
  // A gap split until floating point runs out has to renumber, not silently
  // place two tasks at the same value.
  // Two neighbours with nothing representable between them, and a task dragged
  // into that gap — the only case where a midpoint cannot be found.
  const tight = [{ id: 'a', order: 1 }, { id: 'b', order: 1 + Number.EPSILON }, { id: 'x', order: 5 }];
  const changes = moveWithin(tight, 2, 1);
  ok('an exhausted gap renumbers the column instead of colliding',
     changes.length === 3, JSON.stringify(changes));
  ok('renumbering leaves every task a distinct place',
     new Set(changes.map(c => c.order)).size === 3);
}
ok('an out-of-range source is refused', moveWithin(placed3, 9, 0).length === 0);
ok('an out-of-range target is refused', moveWithin(placed3, 0, 9).length === 0);
ok('moving does not mutate the list', (() => {
  const input = [{ id: 'a', order: 0 }, { id: 'b', order: 1 }];
  moveWithin(input, 0, 1);
  return ids(input) === 'a,b';
})());

// ── Drag distance to index ──
const H = [40, 40, 40, 40];
ok('no movement stays put', targetIndex(H, 1, 0) === 1);
ok('a nudge that has not crossed a midpoint stays put', targetIndex(H, 0, 15) === 0);
ok('crossing one midpoint moves one row', targetIndex(H, 0, 25) === 1);
ok('crossing two moves two', targetIndex(H, 0, 65) === 2);
ok('dragging up crosses the other way', targetIndex(H, 3, -25) === 2);
ok('dragging far up lands at the top', targetIndex(H, 3, -500) === 0);
ok('dragging far down lands at the bottom', targetIndex(H, 0, 500) === 3);
{
  // A tall row takes more travel to cross than a short one.
  const uneven = [30, 90, 30];
  ok('a tall row needs more travel to cross', targetIndex(uneven, 0, 40) === 0);
  ok('and is crossed once past its middle', targetIndex(uneven, 0, 50) === 1);
}

// ── How far the others move aside ──
ok('a row outside the moved range stays where it is', shiftFor(3, 0, 1, 40) === 0);
ok('the dragged row itself is not shifted', shiftFor(1, 1, 3, 40) === 0);
ok('rows below a downward move come up', shiftFor(2, 1, 3, 40) === -40);
ok('rows above an upward move go down', shiftFor(1, 3, 1, 40) === 40);
ok('nothing shifts when nothing moves', shiftFor(2, 1, 1, 40) === 0);

// ── The same helpers move the project tabs, sideways ──
//
// The tab bar reuses moveWithin, targetIndex and shiftFor with widths in place
// of heights and dx in place of dy. That reuse is only sound if these really
// are about sizes along an axis rather than about rows in a column, so it is
// checked here rather than assumed there.
{
  const projects = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, order: i }));
  const apply = (list, changes) => {
    const by = new Map(changes.map(c => [c.id, c.order]));
    return [...list]
      .map(p => (by.has(p.id) ? { ...p, order: by.get(p.id) } : p))
      .sort((a, b) => a.order - b.order);
  };

  let wrong = 0;
  for (let from = 0; from < projects.length; from += 1) {
    for (let to = 0; to < projects.length; to += 1) {
      const after = apply(projects, moveWithin(projects, from, to));
      const want = [...projects];
      const [moved] = want.splice(from, 1);
      want.splice(to, 0, moved);
      if (after.map(p => p.id).join() !== want.map(p => p.id).join()) wrong += 1;
    }
  }
  ok('every move from every position to every other lands correctly', wrong === 0, `${wrong} wrong`);

  // Tabs are not a uniform width, any more than rows are a uniform height.
  const widths = [80, 120, 60, 200, 90];
  ok('a small sideways drag stays where it is', targetIndex(widths, 0, 10) === 0);
  ok('passing the next tab crosses it', targetIndex(widths, 0, 100) === 1);
  ok('a drag to the far right reaches the end', targetIndex(widths, 0, 10000) === 4);
  ok('and to the far left reaches the start', targetIndex(widths, 4, -10000) === 0);
  ok('nothing goes past either end', targetIndex(widths, 2, -99999) === 0);
  ok('an empty row is survived', targetIndex([], 0, 50) === 0);

  // The tabs that are not in hand slide aside by the width of the one that is.
  ok('a tab between the two ends slides left', shiftFor(1, 0, 2, 80) === -80);
  ok('and the other way it slides right', shiftFor(1, 2, 0, 80) === 80);
  ok('a tab outside the move does not stir', shiftFor(4, 0, 2, 80) === 0);
}

// ── A time decides the order, whichever order they were written in ─────────
//
// "Call Bob at 11am" went in first, so it sat at the top; "Call John at 9am"
// went in second and landed above it, because the list was ordered by what was
// newest. Neither arrangement had anything to do with the day: one of them was
// right by accident and the other was wrong by the same accident. The clock
// already knows the answer, and a list that has to be dragged into the order
// the clock decided is doing work it could have had for nothing.
{
  const DAY = '2026-10-15T00:00:00.000Z';
  // `order` set as the app sets it: every new task goes in above the last, so
  // the newest carries the lowest number. The times here disagree with that
  // sequence on purpose — if they agreed, this would pass without the sort
  // looking at a clock at all.
  const bob = { id: 'bob', dueDate: DAY, dueTime: '11:00', order: 0, priority: 'medium', createdAt: '1' };
  const john = { id: 'john', dueDate: DAY, dueTime: '09:00', order: -1, priority: 'medium', createdAt: '2' };
  const noon = { id: 'noon', dueDate: DAY, dueTime: '12:00', order: -2, priority: 'medium', createdAt: '3' };

  ok('nine in the morning comes above eleven',
     ids(sortForDisplay([bob, john], rankOf)) === 'john,bob',
     ids(sortForDisplay([bob, john], rankOf)));
  ok('and the answer does not depend on which was handed over first',
     ids(sortForDisplay([john, bob], rankOf)) === 'john,bob',
     ids(sortForDisplay([john, bob], rankOf)));
  ok('three of them run through the day in order',
     ids(sortForDisplay([noon, bob, john], rankOf)) === 'john,bob,noon',
     ids(sortForDisplay([noon, bob, john], rankOf)));

  // The newest-first rule is what used to decide this, so a test that does not
  // contradict it is a test that proves nothing. Stated outright: the order
  // values here would give exactly the reverse.
  ok('which is the opposite of what the placed order alone would give',
     ids(sortForDisplay([noon, bob, john], rankOf)).split(',').reverse().join(',') === 'noon,bob,john');

  // A high-priority task later in the day stays later in the day. Priority is
  // how a task feels; a time is an appointment with the day, and an
  // appointment does not move because you feel strongly about it.
  const urgentLate = { ...bob, id: 'urgentLate', priority: 'high' };
  ok('a time outranks priority',
     ids(sortForDisplay([urgentLate, john], rankOf)) === 'john,urgentLate',
     ids(sortForDisplay([urgentLate, john], rankOf)));

  // ── Tasks with no time keep the place you gave them ──
  const dragged = { id: 'dragged', order: -9, priority: 'low', createdAt: '0' };
  const untouched = { id: 'untouched', priority: 'high', createdAt: '0' };
  ok('anything with a time sits above anything without one',
     ids(sortForDisplay([dragged, untouched, bob], rankOf)) === 'bob,dragged,untouched',
     ids(sortForDisplay([dragged, untouched, bob], rankOf)));
  ok('and among those the old rules are untouched',
     ids(sortForDisplay([untouched, dragged], rankOf)) === 'dragged,untouched',
     ids(sortForDisplay([untouched, dragged], rankOf)));

  // A date without a time is not a position in the day. "Due Thursday" is due
  // some time on Thursday, and the whole day is not an appointment.
  const thursday = { id: 'thursday', dueDate: DAY, dueTime: '', order: -9, priority: 'medium', createdAt: '0' };
  ok('a date with no time is not placed by the clock',
     ids(sortForDisplay([thursday, bob], rankOf)) === 'bob,thursday',
     ids(sortForDisplay([thursday, bob], rankOf)));

  // Two at the same minute is the one case the clock cannot settle, so where
  // you put them still decides — which is also what keeps dragging meaningful
  // for a pair of tasks that genuinely happen together.
  const alsoNine = { id: 'alsoNine', dueDate: DAY, dueTime: '09:00', order: -7, priority: 'medium', createdAt: '9' };
  ok('two at the same minute fall back to where they were placed',
     ids(sortForDisplay([john, alsoNine], rankOf)) === 'alsoNine,john',
     ids(sortForDisplay([john, alsoNine], rankOf)));

  // Yesterday at 5pm is earlier than this morning at 9, and an overdue task
  // rising to the top is the point rather than a side effect.
  const yesterday = { id: 'yesterday', dueDate: '2026-10-14T00:00:00.000Z', dueTime: '17:00', order: 5, priority: 'low', createdAt: '0' };
  ok('an earlier day comes before an earlier hour',
     ids(sortForDisplay([john, noon, yesterday], rankOf)) === 'yesterday,john,noon',
     ids(sortForDisplay([john, noon, yesterday], rankOf)));

  // ── And the controls know ──
  ok('a task with a time is placed by it', placedByTime(bob) === true);
  ok('one with only a date is not', placedByTime(thursday) === false);
  ok('nor is one with neither', placedByTime(dragged) === false
     && placedByTime({}) === false && placedByTime(null) === false);
  // A time the picker could not have produced is not a time.
  ok('and nor is something that is not a clock reading',
     placedByTime({ dueDate: DAY, dueTime: '25:00' }) === false
     && placedByTime({ dueDate: DAY, dueTime: 'morning' }) === false,
     String(placedByTime({ dueDate: DAY, dueTime: '25:00' })));
  // A time with nowhere to be is the shape the parser never produces — it
  // makes "at 9am" today — but a stored task could carry it, and half a time
  // is not a position in any day.
  ok('a time with no date is not a position in a day',
     placedByTime({ dueTime: '09:00' }) === false);

  // ── Sorting leaves the caller's list alone ──
  const given = [bob, john, noon];
  sortForDisplay(given, rankOf);
  ok('the list handed in is not reordered underneath the caller',
     ids(given) === 'bob,john,noon', ids(given));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
