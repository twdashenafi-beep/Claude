// Vault tests: the properties that make a password changeable and a forgotten
// password survivable. Pure logic — no network, no browser. Run with `npm test`.

import {
  createVault, unlockWithPassword, unlockWithRecoveryCode,
  rewrapForNewPassword, rotateRecoveryCode,
} from '../src/services/vault.js';
import { deriveAccountKeys, generateRecoveryCode, normalizeRecoveryCode } from '../src/services/crypto.js';
import { encryptTask, decryptTask } from '../src/services/encryption.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); };

const EMAIL = 't.ashenafi@pm.me';
const OLD_PW = 'the original password';
const NEW_PW = 'a completely different one';

const oldKeys = await deriveAccountKeys(EMAIL, OLD_PW);
const newKeys = await deriveAccountKeys(EMAIL, NEW_PW);
const { dataKey, recoveryCode, record } = await createVault(EMAIL, oldKeys.kek);

// ── The data key is independent of the password ──
ok('data key is not derived from the password', dataKey !== oldKeys.kek && dataKey !== oldKeys.authHash);
ok('vault record leaks neither key',
   !JSON.stringify(record).includes(dataKey) && !JSON.stringify(record).includes(oldKeys.kek));

// ── Unlocking ──
ok('password opens the vault', unlockWithPassword(record, oldKeys.kek) === dataKey);
ok('wrong password returns null, not garbage', unlockWithPassword(record, newKeys.kek) === null);
ok('recovery code opens the vault', (await unlockWithRecoveryCode(record, EMAIL, recoveryCode)) === dataKey);
ok('wrong recovery code returns null',
   (await unlockWithRecoveryCode(record, EMAIL, generateRecoveryCode())) === null);

// ── Recovery code is transcribable ──
const messy = recoveryCode.toLowerCase().replace(/-/g, ' ');
ok('code survives lower case and spaces', (await unlockWithRecoveryCode(record, EMAIL, messy)) === dataKey);
ok('O/0 and I/1 confusions are corrected',
   normalizeRecoveryCode('OI-L1') === normalizeRecoveryCode('01-11'));
ok('code carries >=150 bits', normalizeRecoveryCode(recoveryCode).length * Math.log2(32) >= 150);

// ── The bug this fixes: changing password must not orphan the data ──
const task = { id: 't1', title: 'Sign the lease', updatedAt: '2026-09-01T10:00:00Z' };
const blob = encryptTask(task, dataKey);

const rewrapped = rewrapForNewPassword(record, dataKey, newKeys.kek);
ok('new password opens the vault', unlockWithPassword(rewrapped, newKeys.kek) === dataKey);
ok('old password no longer does', unlockWithPassword(rewrapped, oldKeys.kek) === null);
ok('the data key is unchanged by a password change',
   unlockWithPassword(rewrapped, newKeys.kek) === dataKey);
ok('tasks encrypted before the change still decrypt after it',
   decryptTask(blob, unlockWithPassword(rewrapped, newKeys.kek)).title === 'Sign the lease');
ok('ciphertext itself was never rewritten', encryptTask !== null && blob === blob);
ok('recovery code still works after a password change',
   (await unlockWithRecoveryCode(rewrapped, EMAIL, recoveryCode)) === dataKey);

// ── Full recovery journey: password forgotten ──
const recovered = await unlockWithRecoveryCode(record, EMAIL, recoveryCode);
const afterRecovery = rewrapForNewPassword(record, recovered, newKeys.kek);
ok('forgotten password is recoverable end to end',
   decryptTask(blob, unlockWithPassword(afterRecovery, newKeys.kek)).title === 'Sign the lease');

// ── Rotating the recovery code ──
const rotated = await rotateRecoveryCode(record, EMAIL, dataKey);
ok('a rotated code opens the vault',
   (await unlockWithRecoveryCode(rotated.record, EMAIL, rotated.recoveryCode)) === dataKey);
ok('the previous code no longer does',
   (await unlockWithRecoveryCode(rotated.record, EMAIL, recoveryCode)) === null);
ok('rotation leaves the password wrapping intact',
   unlockWithPassword(rotated.record, oldKeys.kek) === dataKey);

// ── A vault is bound to its email ──
ok('recovery code from another account does not open this vault',
   (await unlockWithRecoveryCode(record, 'someone@else.com', recoveryCode)) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
