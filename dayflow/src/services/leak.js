// What the server can actually read.
//
// The app's central promise is that everything it syncs is ciphertext and the
// key never leaves the device. That is a claim, and a claim about encryption is
// worth exactly as much as the last time somebody checked it — which until now
// meant opening the Supabase dashboard on a computer and squinting at a column
// of base64. On a phone that is not a check anybody is going to perform, and a
// check nobody performs is not a check.
//
// So the app asks on your behalf. It pulls its own rows back from the server
// and looks at them the way an intruder would: is any of this readable?
//
// The failure it is looking for is a real one, not a hypothetical. A task is
// stored as encrypt(JSON.stringify(task)), and an encrypt() that cannot find a
// source of randomness used to fail by returning its input — so the row would
// hold the task's JSON, in the clear, while every screen in the app looked
// perfectly normal.
//
// Three marks, weakest claim last. Does it still look like the JSON it was
// before encryption; can you read your own words in it; and — the one that
// needs nothing to compare against — does it contain any character that a
// ciphertext cannot. AES out of crypto-js is strict base64 and nothing else,
// which was checked rather than assumed: two hundred encryptions of a title
// full of spaces, punctuation and a currency symbol emitted A-Z a-z 0-9 + / =
// and no other character at all. So a single space in a row is proof, and it
// is proof even for a vault this device has never seen the titles of.
//
// Pure: no network, no storage. It is handed rows and told what to look for.

// Short titles are poor evidence. Base64 is letters and digits, so a four-letter
// word turning up in it by chance is unlikely but not impossible, and a false
// alarm about your own encryption is worse than no alarm at all. Six characters
// makes coincidence vanishingly improbable, and the JSON test below catches the
// real failure regardless of how short your titles are.
const MIN_EVIDENCE = 6;

// Enough distinct words to be conclusive without walking a thousand titles
// against a thousand rows. The longest are the most distinctive.
const MAX_NEEDLES = 50;

// Enough of a row to show what is actually stored. The point is for you to see
// it, not to read it.
const SAMPLE = 28;

function needlesFrom(titles) {
  return [...new Set((titles || [])
    .map(t => String(t == null ? '' : t).trim())
    .filter(t => t.length >= MIN_EVIDENCE))]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_NEEDLES);
}

// Everything a ciphertext is allowed to be made of, and nothing else.
const SEALED_ALPHABET = /^[A-Za-z0-9+/=]+$/;

// Why this row is readable, or null if it is not.
//
// The three tests are ordered by how good the sentence they produce is, not by
// how sure they are: the last one is the surest and the least illuminating.
function readable(ciphertext, needles) {
  const text = String(ciphertext);
  const start = text.trimStart()[0];

  // A task is stored as JSON before it is encrypted. If the row still looks
  // like that JSON, nothing encrypted it.
  if (start === '{' || start === '[') return 'it is stored as plain text';

  // Quoting your own words back is the version of this that needs no
  // explaining. It is bounded, so it is a better sentence rather than a
  // stronger test — the alphabet below is what actually guarantees the answer.
  for (const needle of needles) {
    if (text.includes(needle)) return `your own words are in it — “${needle}”`;
  }

  // One space, one apostrophe, one pound sign: none of them can survive
  // encryption, so any of them means it did not happen. This is what makes the
  // bound on the search above harmless.
  if (!SEALED_ALPHABET.test(text.trim())) return 'it is not ciphertext at all';

  return null;
}

// { verdict, checked, sample, reason }
//
//   'empty'   nothing has reached the server, so there is nothing to judge
//   'clear'   every row was unreadable
//   'exposed' at least one row was not, and `reason` says how it gave itself away
export function inspectRows(rows, titles) {
  const needles = needlesFrom(titles);
  let checked = 0;
  let sample = '';

  for (const row of rows || []) {
    const ciphertext = row && row.ciphertext;
    // A row with nothing in it is neither evidence for nor against.
    if (typeof ciphertext !== 'string' || ciphertext.length === 0) continue;

    checked += 1;
    if (!sample) sample = ciphertext.slice(0, SAMPLE);

    const reason = readable(ciphertext, needles);
    // One readable row is the answer. It does not get better further down.
    if (reason) return { verdict: 'exposed', checked, sample: ciphertext.slice(0, SAMPLE), reason };
  }

  if (checked === 0) return { verdict: 'empty', checked: 0, sample: '', reason: null };
  return { verdict: 'clear', checked, sample, reason: null };
}
