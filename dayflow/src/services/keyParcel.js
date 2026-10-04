// How a remembered key is wrapped, and read back.
//
// Split from the service that talks to the keychain so it can be reasoned about
// on its own: that side is a phone and cannot be loaded outside one, while this
// is the part that decides whether a vault opens.
//
// A keychain hands back a string or nothing. Everything that is not a key has
// to read as nothing, because the alternative is an app that believes it has
// been unlocked and then cannot decrypt a single task — which looks, from the
// inside, exactly like the data being gone.

// What is stored is the key, whose it is, and what the server accepts as a
// password for them.
//
// That last one is here because of a fault that hid behind Face ID for weeks.
// Opening with a face unwrapped the data key and went straight in, never
// touching the server — which was fine only because a signed-in session was
// already sitting in ordinary storage, refreshing itself. Delete the app and
// that storage goes; the keychain does not. So the phone could still open the
// vault with a face while having no session at all, and every sync from then
// on failed with "Not signed in", for ever, with nothing to fix it.
//
// The auth hash is what a password sign-in sends: a one-way derivation the
// server already knows and which opens nothing on its own. It sits beside a
// data key that decrypts every task, behind the same face, so it adds no
// exposure — and it is what lets a face unlock sign in as well as open up.
export function parcel(email, dataKey, authHash) {
  return JSON.stringify({ email, dataKey, authHash });
}

export function unparcel(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const held = JSON.parse(raw);
    if (!held || typeof held.dataKey !== 'string' || !held.dataKey) return null;
    // An account that was never written down is not a reason to refuse the key.
    // The key opens the vault; the email only says where it syncs.
    return {
      email: typeof held.email === 'string' ? held.email : '',
      dataKey: held.dataKey,
      // Absent in every parcel written before this existed. Those devices
      // still open — the key is the part that matters — and the first
      // password unlock writes a parcel that has it.
      authHash: typeof held.authHash === 'string' ? held.authHash : '',
    };
  } catch {
    return null;
  }
}
