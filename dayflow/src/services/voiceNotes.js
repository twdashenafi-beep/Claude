// The voice notes on a task, of which there can be more than one.
//
// There used to be room for exactly one, which was fine until the quick-add
// microphone began keeping the audio of what you dictated. That recording is
// attached to the task it made — and it took the only slot there was. So every
// task created by voice arrived with its one place already spent, and the task
// sheet offered a play button, a Remove, and no way whatsoever to add the note
// you actually wanted to leave. The feature closed the door behind itself.
//
// They are a list now. The first is usually what you said when you made the
// task; the rest are what you have added since.
//
// The list lives inside the encrypted blob like everything else about a task,
// so there is no schema to change and nothing to migrate — but there are tasks
// already written with the single field, and they have to keep working. Reading
// goes through here so that neither shape has to be thought about anywhere else.

// Each note is the recording itself, base64, inside the vault that every typed
// task also shares. A minute each is already the limit; this is the limit on
// how many minutes one task may take.
export const MAX_NOTES = 5;

// Every voice note on a task, oldest first. Always an array.
export function notesOf(task) {
  if (!task) return [];

  // The single field first: on a task old enough to have one, it is the one
  // that was there before any of the others.
  const legacy = typeof task.voiceNoteUri === 'string' ? [task.voiceNoteUri] : [];
  const list = Array.isArray(task.voiceNotes) ? task.voiceNotes : [];

  const seen = new Set();
  return [...legacy, ...list].filter(uri => {
    if (typeof uri !== 'string' || uri === '') return false;
    // A task written during the change could carry the same recording in both
    // places. It is one note, not two.
    if (seen.has(uri)) return false;
    seen.add(uri);
    return true;
  });
}

// What a row plays when there is only room for one button.
//
// The last rather than the first: the oldest is usually the dictation that made
// the task, and anything added since was added because it had more to say.
export function latestNote(task) {
  const notes = notesOf(task);
  return notes.length ? notes[notes.length - 1] : null;
}

// The fields to save for a given list. The single field is cleared rather than
// left behind, so a task that has been through here has one source of truth.
export function noteFields(notes) {
  const list = (Array.isArray(notes) ? notes : [])
    .filter(uri => typeof uri === 'string' && uri !== '')
    .slice(0, MAX_NOTES);
  return { voiceNotes: list, voiceNoteUri: null };
}

export function canAddNote(notes) {
  return (Array.isArray(notes) ? notes.length : 0) < MAX_NOTES;
}
