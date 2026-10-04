// What a remembered key has to survive being handed.
//
// Most of this service is a wrapper around the device keychain, which does not
// exist outside a phone and cannot be exercised here. What can be — and what is
// worth being, because it is the part that decides whether a vault opens — is
// the reading of what comes back out of it.
//
// A keychain returns a string or nothing. Everything that is not a key must
// read as nothing, because the alternative is an app that believes it has been
// unlocked and then cannot decrypt a single task.
//
// Run with `npm test`.

import { parcel, unparcel } from '../src/services/keyParcel.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const KEY = 'a'.repeat(64);

{
  const held = unparcel(JSON.stringify({ email: 't@example.com', dataKey: KEY }));
  ok('a key and whose it is comes back', held && held.dataKey === KEY, JSON.stringify(held));
  ok('and the account with it', held && held.email === 't@example.com');
}

// An account that was never written down is not a reason to refuse the key: the
// key is the thing that opens the vault, and the email is only how sync knows
// where to put it.
{
  const held = unparcel(JSON.stringify({ dataKey: KEY }));
  ok('a key with no account is still a key', held && held.dataKey === KEY);
  ok('and the account reads as empty rather than missing', held && held.email === '');
}

// Everything that is not a key.
for (const [what, raw] of [
  ['nothing at all', null],
  ['an empty string', ''],
  ['something that is not JSON', 'not json at all'],
  ['JSON that is not an object', '"just a string"'],
  ['an object with no key in it', JSON.stringify({ email: 't@example.com' })],
  ['a key that is empty', JSON.stringify({ email: 't@example.com', dataKey: '' })],
  ['a key that is not a string', JSON.stringify({ email: 't@example.com', dataKey: 12345 })],
  ['null', JSON.stringify(null)],
]) {
  ok(`${what} reads as nothing`, unparcel(raw) === null, JSON.stringify(unparcel(raw)));
}

// Not a string at all, which is what a keychain that threw looks like by the
// time it reaches here.
ok('and so does anything that is not a string', unparcel(undefined) === null && unparcel(7) === null);

// ── What a face unlock needs to sign in with ────────────────────────────────
//
// A face unlock unwrapped the key and went straight in, never reaching the
// server. That was harmless only while a signed-in session sat in ordinary
// storage refreshing itself — and the keychain survives the app being deleted
// while that storage does not. So a reinstalled app could still open with a
// face and never sync again: "Not signed in", every time, with nothing on any
// screen able to repair it, because signing in only ever happened on the
// screen a face unlock skips.
//
// The auth hash is what a password sign-in sends. Carrying it here is what
// lets a face do both jobs.
{
  const round = unparcel(parcel('t@example.com', KEY, 'the-auth-hash'));
  ok('a parcel carries what the server accepts as a password',
     round.authHash === 'the-auth-hash', JSON.stringify(round));
  ok('along with the key', round.dataKey === KEY);
  ok('and the account it belongs to', round.email === 't@example.com');

  // Every parcel written before this existed. Those devices must still open —
  // the key is the part that matters, and refusing them would turn a sync
  // fault into a vault nobody can get into.
  const old = unparcel(JSON.stringify({ email: 't@example.com', dataKey: KEY }));
  ok('a parcel from before this still opens the vault', old !== null && old.dataKey === KEY,
     JSON.stringify(old));
  ok('and says it has no hash, rather than carrying undefined about',
     old.authHash === '', JSON.stringify(old.authHash));

  // A hash that is not a string is not a hash. It would be sent to the server
  // as a password, and "[object Object]" is a confusing way to fail.
  const bad = unparcel(JSON.stringify({ email: 'a@b.c', dataKey: KEY, authHash: { nope: 1 } }));
  ok('and nonsense in that field reads as nothing', bad.authHash === '',
     JSON.stringify(bad.authHash));

  // The key is still the one thing without which there is no parcel at all.
  ok('a parcel with a hash but no key is still nothing',
     unparcel(JSON.stringify({ email: 'a@b.c', authHash: 'x' })) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
