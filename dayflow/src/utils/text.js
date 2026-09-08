// A task title starts with a capital.
//
// Not for tidiness. Once the routing words are taken out of dictation, what is
// left starts wherever the sentence happened to continue — "Owe me call Mekdi"
// leaves "call Mekdi" — and a list of lowercase entries reads as though
// something went wrong rather than as a list.

// The exception is a word that already carries a capital somewhere. Those are
// spelled the way they are on purpose: "iPhone repair" must not become
// "IPhone repair", and "eBay listing" must not become "EBay listing".
export function capitalizeTitle(text) {
  const title = String(text == null ? '' : text);

  const first = title.search(/\S/);
  if (first < 0) return title;

  const word = title.slice(first).split(/\s/)[0];
  if (/[A-Z]/.test(word)) return title;

  const head = title.charAt(first);
  const upper = head.toUpperCase();
  // Not every character has a different upper case — a title opening with a
  // digit or an emoji is left exactly as it is.
  if (upper === head) return title;

  return title.slice(0, first) + upper + title.slice(first + 1);
}
