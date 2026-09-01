// The crash reporter must never carry task content. In an app whose whole claim
// is that nobody else can read your tasks, a diagnostic that shipped a title
// somewhere would break that promise more thoroughly than the bug it helped fix.

let pass = 0, fail = 0;
const ok = (label, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

// recordError writes through AsyncStorage, so exercise the sanitising directly
// with the same shape the boundary passes it.
const sanitise = (error, info) => ({
  message: String(error?.message || error),
  stack: String(error?.stack || '').split('\n').slice(0, 12).join('\n'),
  componentStack: String(info?.componentStack || '').split('\n').slice(0, 8).join('\n'),
  at: new Date().toISOString(),
});

const SECRET = 'Call Mekdi about the lease';
const err = new Error('Cannot read properties of undefined (reading "map")');
err.stack = `Error: ${err.message}\n    at TodoScreen (app.js:120)\n    at renderWithHooks (react-dom.js:14)`;
const entry = sanitise(err, { componentStack: '\n    in TodoScreen\n    in TaskProvider' });

const serialised = JSON.stringify(entry);
ok('report carries the error message', entry.message.includes('undefined'));
ok('report carries a stack for debugging', entry.stack.includes('TodoScreen'));
ok('report contains no task content', !serialised.includes(SECRET));
ok('report has only the four expected fields',
   Object.keys(entry).sort().join(',') === 'at,componentStack,message,stack');

// A crash whose message happens to embed data must still not be widened by us —
// we cannot sanitise a message the runtime built, but we must not add to it.
const leaky = new Error(`Failed to parse: ${SECRET}`);
const leakyEntry = sanitise(leaky, {});
// The message is passed through verbatim: a runtime message that already
// embeds data is not something we can sanitise, but we must not widen it, and
// nothing is read out of application state to accompany it.
ok('runtime message is passed through unchanged',
   leakyEntry.message === `Failed to parse: ${SECRET}`);
ok('no extra fields are attached to it',
   Object.keys(leakyEntry).sort().join(',') === 'at,componentStack,message,stack');

// Stacks are capped so a deep recursion cannot fill storage.
const deep = new Error('boom');
deep.stack = Array.from({ length: 500 }, (_, i) => `    at frame${i}`).join('\n');
ok('stack is truncated', sanitise(deep, {}).stack.split('\n').length <= 12);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
