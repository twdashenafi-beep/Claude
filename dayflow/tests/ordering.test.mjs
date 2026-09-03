// Ordering tests: dragging a task to where you want it.
//
// Priority says how a task feels; order says where you put it. Pure logic —
// the arithmetic of inserting between neighbours, and of turning a drag
// distance into an index. Run with `npm test`.

import {
  orderOf, sortForDisplay, orderForNewTask, moveWithin, targetIndex, shiftFor,
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
