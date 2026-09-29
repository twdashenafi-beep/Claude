// Which keys the move is allowed to touch.
//
// The rest of the store is browser machinery — IndexedDB, localStorage, a
// migration — and the browser suite exercises it end to end. What can be
// decided here, and is worth deciding here, is the one rule that keeps a
// migration from wandering: whose keys these are.
//
// Moving a stranger's key into a drawer they have never heard of, and then
// deleting the one they had, is how a migration breaks something it was never
// asked to touch. So the rule is narrow, and this is the guard on it.
//
// Run with `npm test`.

import { oursToMove } from '../src/services/storeKeys.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// Everything the app writes for itself.
for (const key of [
  '@dayflow_vault_v2',
  '@dayflow_vault_v2_unreadable',
  '@dayflow_vault_record',
  '@dayflow_calendar_v1',
  '@dayflow_sync_config',
  '@dayflow_sync_skipped',
  '@dayflow_alerts_shown',
  '@dayflow_last_error',
]) {
  ok(`${key} comes across`, oursToMove(key) === true);
}

// And the session, which has to travel or signing in happens again on the far
// side of a migration nobody asked to see.
ok('the Supabase session comes across', oursToMove('sb-stubproject-auth-token') === true);

// Nothing else.
for (const key of [
  'theme',
  'some-other-app',
  'dayflow_vault_v2',        // no leading @: not ours, and not a near miss worth guessing at
  'notsb-something',
  '',
]) {
  ok(`${JSON.stringify(key)} is left where it is`, oursToMove(key) === false);
}

ok('and so is anything that is not a string', oursToMove(null) === false && oursToMove(7) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
