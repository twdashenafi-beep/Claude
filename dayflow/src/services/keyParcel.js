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

// What is stored is the key and whose it is. The account matters because an
// unlocked vault has to know where to sync before it can do anything.
export function parcel(email, dataKey) {
  return JSON.stringify({ email, dataKey });
}

export function unparcel(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const held = JSON.parse(raw);
    if (!held || typeof held.dataKey !== 'string' || !held.dataKey) return null;
    // An account that was never written down is not a reason to refuse the key.
    // The key opens the vault; the email only says where it syncs.
    return { email: typeof held.email === 'string' ? held.email : '', dataKey: held.dataKey };
  } catch {
    return null;
  }
}
