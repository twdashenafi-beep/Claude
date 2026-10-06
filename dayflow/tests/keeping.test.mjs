// Whether there is a copy of any of this anywhere else.
//
// The app lost somebody's list once — deleted and reinstalled, and the vault
// went with the app because iOS keeps the Keychain and not the storage beside
// it. Nothing warned them, because nothing recorded when a copy had last been
// taken. These are the rules for the line that now does.
//
// The hard part is not the wording. It is earning the right to say anything at
// all: a page that mentions backups every morning is furniture, and furniture
// is what people stop seeing.
import { keptLine, keptNote, missedBy } from '../src/services/keeping.js';

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${c ? '' : '  ' + x}`); };

const NOW = new Date(2026, 9, 6, 9, 0);
const ago = days => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString();
};
const line = (copy, count, synced = false) => keptLine({ copy, count, synced, now: NOW });

// ── When it says nothing ────────────────────────────────────────────────────
//
// Four reasons, and each one is a reason somebody would otherwise be nagged
// about a risk they are not carrying.
ok('a working sync means there is already a second copy, so nothing is said',
   line(null, 400, true) === null, String(line(null, 400, true)));
ok('and that holds even with no copy ever taken and an old one',
   line({ at: ago(300), count: 0 }, 400, true) === null);
ok('a nearly empty app is not warned about losing nothing',
   line(null, 4) === null, String(line(null, 4)));
ok('a copy taken this morning says nothing',
   line({ at: ago(0), count: 40 }, 40) === null, String(line({ at: ago(0), count: 40 }, 40)));
ok('nor does a recent copy that only misses a handful',
   line({ at: ago(3), count: 40 }, 46) === null, String(line({ at: ago(3), count: 40 }, 46)));

// ── When it speaks ──────────────────────────────────────────────────────────
ok('never copied, with a real list, is said plainly',
   /copied off this phone/.test(line(null, 41) || ''), String(line(null, 41)));

// Time passing is one risk.
const old = line({ at: ago(30), count: 41 }, 41);
ok('a copy a month old is said', /Last copy/.test(old || ''), String(old));
ok('in weeks or months, not a day count', /weeks|months/.test(old || ''), String(old));

// A week where everything happened at once is the other, and it does not wait
// a fortnight: a copy from Tuesday that misses twenty-three things is a copy of
// somebody else's list.
const busy = line({ at: ago(4), count: 18 }, 41);
ok('a recent copy that misses a lot is said anyway', busy !== null, String(busy));
ok('and says how much it misses, not how old it is',
   /23 of these were written since/.test(busy || ''), String(busy));

// The count is the point: "eleven days ago" says how long you have been lucky,
// this says what the luck is worth.
// Written as the whole string rather than a regex with an or in it. The first
// version of this assertion was `a === x || !/written since/.test(a)`, which
// passes for very nearly any output — including no output at all.
ok('a copy that misses nothing says only when it was, and says it exactly',
   line({ at: ago(30), count: 50 }, 41) === 'Last copy 4 weeks ago',
   String(line({ at: ago(30), count: 50 }, 41)));

// ── Rubbish in ──────────────────────────────────────────────────────────────
//
// This reads off disk, so it has to survive whatever is there — including a
// half-written record from a crash mid-save.
ok('no arguments at all is silence, not a crash', keptLine() === null);
ok('a copy with an unreadable date is treated as no copy',
   /copied off this phone/.test(line({ at: 'not a date', count: 3 }, 41) || ''),
   String(line({ at: 'not a date', count: 3 }, 41)));
ok('a copy with a missing count is still a copy',
   /Last copy/.test(line({ at: ago(30) }, 41) || ''), String(line({ at: ago(30) }, 41)));
ok('a negative count cannot invent things to miss', missedBy({ count: 90 }, 41) === 0);
ok('and no copy misses everything', missedBy(null, 41) === 41);

// ── The factual one, beside the button ──────────────────────────────────────
//
// Always said, because somebody standing in front of Export is asking exactly
// this, and "nothing is known" is an answer to it.
ok('with no copy it says so rather than staying blank',
   /No copy has been taken/.test(keptNote(null, 41, NOW)), keptNote(null, 41, NOW));
ok('with one it says when, and how much was in it',
   /Last copy 3 days ago · 38 things in it, 3 written since\./
     .test(keptNote({ at: ago(3), count: 38 }, 41, NOW)),
   keptNote({ at: ago(3), count: 38 }, 41, NOW));
ok('one thing is a thing, not 1 things',
   /1 thing in it/.test(keptNote({ at: ago(3), count: 1 }, 1, NOW)),
   keptNote({ at: ago(3), count: 1 }, 1, NOW));
ok('a copy taken today says today, not 0 days ago',
   /today/.test(keptNote({ at: ago(0), count: 41 }, 41, NOW)),
   keptNote({ at: ago(0), count: 41 }, 41, NOW));
ok('and the Day page line says today the same way, if it says anything',
   !/0 days/.test(line({ at: ago(0), count: 10 }, 41) || ''),
   String(line({ at: ago(0), count: 10 }, 41)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
