// Crypto and merge tests — the parts that decide whether three devices can
// read each other's tasks, and which edit wins when two disagree.
// Pure logic only: no network, no browser. Run with `npm test`.

import { mergeTasks } from '../src/services/merge.js';
import { encryptTask, decryptTask, createTaskEncryptor } from '../src/services/encryption.js';
import { deriveAccountKeys } from '../src/services/crypto.js';
import { createVault, unlockWithPassword } from '../src/services/vault.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

// ── Cross-device key agreement ──
const A = await deriveAccountKeys('T.Ashenafi@PM.me ', 'correct horse battery');
const B = await deriveAccountKeys('t.ashenafi@pm.me', 'correct horse battery');
ok('same email (any case/space) + password -> same kek on every device', A.kek === B.kek);
ok('auth hash differs from the key-encrypting key', A.authHash !== A.kek);
const C = await deriveAccountKeys('t.ashenafi@pm.me', 'correct horse batteryX');
ok('different password -> different kek', C.kek !== A.kek);
const D = await deriveAccountKeys('other@pm.me', 'correct horse battery');
ok('different email -> different kek', D.kek !== A.kek);

// ── Blob encryption ──
// Tasks are encrypted with the vault's data key, not the password-derived one.
const vaultA = await createVault('t.ashenafi@pm.me', A.kek);
const key = vaultA.dataKey;
ok('two devices with the same password reach the same data key',
   unlockWithPassword(vaultA.record, B.kek) === key);
const task = { id: 'x1', title: 'Call Mekdi', priority: 'high', owePerson: 'Sara', updatedAt: '2026-09-01T10:00:00Z' };
const blob = encryptTask(task, key);
ok('ciphertext leaks no field', !blob.includes('Mekdi') && !blob.includes('high') && !blob.includes('Sara'));
ok('round trips', JSON.stringify(decryptTask(blob, key)) === JSON.stringify(task));
ok('wrong key returns null, not garbage', decryptTask(blob, C.kek) === null);

// ── Memoised encryptor ──
const enc = createTaskEncryptor();
const list = [task, { ...task, id: 'x2', title: 'Second' }];
const r1 = enc(list, key);
const r2 = enc(list, key);
ok('unchanged tasks reuse ciphertext', r1[0].ciphertext === r2[0].ciphertext);
const r3 = enc([{ ...list[0], title: 'Changed' }, list[1]], key);
ok('changed task re-encrypts', r3[0].ciphertext !== r1[0].ciphertext);
ok('untouched sibling still reused', r3[1].ciphertext === r1[1].ciphertext);

// ── Merge: last write wins ──
const dec = c => decryptTask(c, key);
const mk = (id, title, at) => ({ id, title, updatedAt: at });
const row = (t, deleted = false) => ({ id: t.id, ciphertext: encryptTask(t, key), updatedAt: t.updatedAt, deleted });

let m = mergeTasks({
  localTasks: [mk('a', 'local newer', '2026-09-01T12:00:00Z')],
  localTombstones: [],
  remoteRows: [row(mk('a', 'remote older', '2026-09-01T10:00:00Z'))],
  decryptRow: dec,
});
ok('newer local edit beats older remote', m.tasks.find(t => t.id === 'a').title === 'local newer');
ok('and is queued to push', m.pushIds.includes('a'));

m = mergeTasks({
  localTasks: [mk('a', 'local older', '2026-09-01T10:00:00Z')],
  localTombstones: [],
  remoteRows: [row(mk('a', 'remote newer', '2026-09-01T12:00:00Z'))],
  decryptRow: dec,
});
ok('newer remote edit beats older local', m.tasks.find(t => t.id === 'a').title === 'remote newer');

// ── Merge: a task from another device arrives ──
m = mergeTasks({
  localTasks: [], localTombstones: [],
  remoteRows: [row(mk('b', 'from the iPad', '2026-09-01T12:00:00Z'))],
  decryptRow: dec,
});
ok('new remote task is adopted', m.tasks.length === 1 && m.tasks[0].title === 'from the iPad');

// ── Merge: tombstones ──
m = mergeTasks({
  localTasks: [mk('c', 'still here', '2026-09-01T10:00:00Z')],
  localTombstones: [],
  remoteRows: [{ id: 'c', ciphertext: '', updatedAt: '2026-09-01T12:00:00Z', deleted: true }],
  decryptRow: dec,
});
ok('remote delete removes the local task', !m.tasks.find(t => t.id === 'c'));
ok('and is remembered as a tombstone', m.tombstones.some(t => t.id === 'c'));

m = mergeTasks({
  localTasks: [], localTombstones: [{ id: 'd', updatedAt: '2026-09-01T12:00:00Z' }],
  remoteRows: [row(mk('d', 'deleted here while offline', '2026-09-01T10:00:00Z'))],
  decryptRow: dec,
});
ok('local delete is not resurrected by a stale remote row', !m.tasks.find(t => t.id === 'd'));

m = mergeTasks({
  localTasks: [], localTombstones: [{ id: 'e', updatedAt: '2026-09-01T10:00:00Z' }],
  remoteRows: [row(mk('e', 'recreated on another device', '2026-09-01T12:00:00Z'))],
  decryptRow: dec,
});
ok('a newer remote edit revives a stale local tombstone', !!m.tasks.find(t => t.id === 'e'));

// ── Merge: undecryptable row is skipped, not fatal ──
m = mergeTasks({
  localTasks: [mk('f', 'mine', '2026-09-01T10:00:00Z')],
  localTombstones: [],
  remoteRows: [{ id: 'g', ciphertext: 'not-real-ciphertext', updatedAt: '2026-09-01T12:00:00Z', deleted: false }],
  decryptRow: dec,
});
ok('unreadable row is skipped without losing the rest', m.tasks.length === 1 && m.tasks[0].id === 'f');

// ── Local-only task gets pushed ──
m = mergeTasks({
  localTasks: [mk('h', 'never synced', '2026-09-01T10:00:00Z')],
  localTombstones: [], remoteRows: [], decryptRow: dec,
});
ok('task the server has not seen is queued to push', m.pushIds.includes('h'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
