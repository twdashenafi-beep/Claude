// The voice notes on a task, of which there can be more than one.
//
// There used to be room for exactly one, and the quick-add microphone spent it:
// a task made by voice arrived with the recording of what you said already in
// the only slot, so the sheet offered a play button, a Remove, and no way at
// all to leave the note you actually wanted. The feature closed the door behind
// itself.
//
// What most of this checks is the other shape. Tasks written before the change
// carry a single field, they are sitting in vaults now, and they have to keep
// working without anywhere else in the app having to know which shape it has.
//
// Run with `npm test`.
import { notesOf, latestNote, noteFields, canAddNote, MAX_NOTES } from '../src/services/voiceNotes.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Nothing ──
ok('a task with no notes has none', eq(notesOf({ title: 'x' }), []));
ok('nothing at all has none', eq(notesOf(null), []));
ok('and undefined', eq(notesOf(undefined), []));
ok('an empty single field is not a note', eq(notesOf({ voiceNoteUri: '' }), []));
ok('nor is a null one', eq(notesOf({ voiceNoteUri: null }), []));
ok('nor a list of nothing', eq(notesOf({ voiceNotes: [] }), []));
ok('and nothing has nothing to play', latestNote({ title: 'x' }) === null);

// ── The old shape still works ──
//
// This is the one that matters: these tasks exist, and every screen reads them
// through here.
ok('a task written with the single field has one note',
   eq(notesOf({ voiceNoteUri: 'data:audio/webm;base64,AAA' }), ['data:audio/webm;base64,AAA']));
ok('and that is what a row plays',
   latestNote({ voiceNoteUri: 'one' }) === 'one');

// ── The new shape ──
ok('a list is a list', eq(notesOf({ voiceNotes: ['a', 'b'] }), ['a', 'b']));
ok('and the row plays the most recent of them', latestNote({ voiceNotes: ['a', 'b'] }) === 'b');

// ── Both at once ──
//
// A task that had a note before the change and has had one added since. The old
// one is the older one, so it comes first.
ok('the single field comes before the list',
   eq(notesOf({ voiceNoteUri: 'first', voiceNotes: ['second'] }), ['first', 'second']));
ok('and the newest is what plays',
   latestNote({ voiceNoteUri: 'first', voiceNotes: ['second'] }) === 'second');
ok('the same recording in both places is one note, not two',
   eq(notesOf({ voiceNoteUri: 'same', voiceNotes: ['same'] }), ['same']));
ok('and a repeat inside the list is not two either',
   eq(notesOf({ voiceNotes: ['a', 'a', 'b'] }), ['a', 'b']));

// ── Junk ──
ok('a list with holes in it drops them',
   eq(notesOf({ voiceNotes: ['a', null, '', undefined, 'b'] }), ['a', 'b']));
ok('a list that is not a list is ignored',
   eq(notesOf({ voiceNotes: 'not a list' }), []));
ok('and a number in the single field is not a recording',
   eq(notesOf({ voiceNoteUri: 42 }), []));

// ── Saving ──
//
// The single field is cleared rather than left behind, so a task that has been
// through here has one source of truth and cannot disagree with itself.
ok('saving writes the list', eq(noteFields(['a', 'b']).voiceNotes, ['a', 'b']));
ok('and clears the old field', noteFields(['a']).voiceNoteUri === null);
ok('saving nothing is an empty list', eq(noteFields([]).voiceNotes, []));
ok('saving junk is an empty list', eq(noteFields('x').voiceNotes, []));
ok('and holes are dropped on the way out', eq(noteFields(['a', '', null]).voiceNotes, ['a']));

// A saved task reads back as what was saved.
{
  const saved = noteFields(['a', 'b']);
  ok('what is saved is what is read', eq(notesOf(saved), ['a', 'b']));
}

// ── A limit, because each one is the recording itself ──
//
// They live in the same few megabytes as every typed task, so one task cannot
// be allowed to take all of it.
const many = Array.from({ length: MAX_NOTES + 3 }, (_, i) => `note-${i}`);
ok('saving more than the limit keeps the limit', noteFields(many).voiceNotes.length === MAX_NOTES);
ok('and keeps the earliest of them',
   eq(noteFields(many).voiceNotes, many.slice(0, MAX_NOTES)));
ok('there is room below the limit', canAddNote(many.slice(0, MAX_NOTES - 1)) === true);
ok('and none at it', canAddNote(many.slice(0, MAX_NOTES)) === false);
ok('an empty task has room', canAddNote([]) === true);
ok('and so does one that has never been asked', canAddNote(undefined) === true);
ok('the limit is a handful, not a hoard', MAX_NOTES >= 2 && MAX_NOTES <= 10, String(MAX_NOTES));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
