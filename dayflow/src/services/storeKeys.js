// Whose keys these are.
//
// Split out from the store itself so it can be reasoned about on its own: the
// store is browser machinery and cannot be loaded outside one, and this is the
// one rule in it that keeps a migration from wandering.
//
// Deliberately narrow. Everything the app writes for itself is prefixed, and
// the other thing that has to come across is the session Supabase keeps, or
// signing in happens again on the far side of a move nobody asked to see.
// Anything else in this origin belongs to something else, and moving a
// stranger's key into a drawer they have never heard of — then deleting the one
// they had — is how a migration breaks what it was never asked to touch.
export function oursToMove(key) {
  return typeof key === 'string' && (key.startsWith('@dayflow') || key.startsWith('sb-'));
}
