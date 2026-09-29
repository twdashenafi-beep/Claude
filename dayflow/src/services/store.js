// Where the app keeps things on the device it is running on.
//
// On a phone this is AsyncStorage and always has been: SQLite underneath, room
// measured in the space left on the disk. On the web AsyncStorage means
// localStorage, which is a drawer of about five megabytes — and Safari counts
// every character as two bytes against it, so the real ceiling is nearer two
// and a half million characters.
//
// That was fine while a task cost seven hundred bytes. It stopped being fine
// the moment a voice note could be attached, because a recording is the first
// thing this app stores that is measured in hundreds of kilobytes. Sixteen of
// them filled the drawer at two hundred and ninety tasks — against an estimate
// in the shipping notes, written before voice notes existed, of seven thousand.
//
// What that failure looks like from the outside is the reason this exists. The
// write is refused, the list on screen still shows the recording because memory
// does not care about quotas, and the next launch has lost it. The app said the
// device was out of storage, but by then the note was gone and the message
// looked like it was about something else.
//
// So the web moves to IndexedDB, which is the same device and the same origin
// but a drawer measured in hundreds of megabytes rather than five. Everything
// already in localStorage comes across on first run and is cleared out of it,
// which is what actually gives the room back.
//
// The interface is AsyncStorage's, unchanged, because everything that calls it
// was written against that and none of it should have to care.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { oursToMove } from './storeKeys';

const DB_NAME = 'dayflow';
const SHELF = 'kv';

const onWeb = () => Platform.OS === 'web';

function localDrawer() {
  try {
    return typeof globalThis !== 'undefined' && globalThis.localStorage
      ? globalThis.localStorage
      : null;
  } catch {
    // Reading the property itself throws in a browser with site data blocked.
    return null;
  }
}

// A quota refusal has to keep saying "quota".
//
// The screen that tells somebody the device is full decides what to say by
// reading the message, and IndexedDB reports this as a DOMException whose name
// carries the meaning and whose text varies by browser. Rewriting it here keeps
// that decision made in one place.
function asStorageError(error) {
  const name = (error && error.name) || '';
  const text = (error && error.message) || String(error || 'storage failed');
  if (/quota/i.test(name) && !/quota/i.test(text)) {
    return new Error(`quota exceeded: ${text}`);
  }
  return error instanceof Error ? error : new Error(text);
}

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = globalThis.indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(asStorageError(e));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHELF)) db.createObjectStore(SHELF);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(asStorageError(request.error));
    // Another tab holding an old version open. Rare, and worth failing rather
    // than hanging: the fallback below is a working app with less room, and a
    // promise that never settles is a screen that never arrives.
    request.onblocked = () => reject(new Error('another tab is holding storage open'));
  });
  return dbPromise;
}

// One transaction, resolved when the transaction completes rather than when the
// request inside it succeeds. A request that has succeeded inside a transaction
// that later aborts has not written anything.
function withShelf(mode, work) {
  return openDb().then(db => new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(SHELF, mode);
    } catch (e) {
      reject(asStorageError(e));
      return;
    }
    let carried = null;
    tx.oncomplete = () => resolve(carried);
    tx.onerror = () => reject(asStorageError(tx.error));
    tx.onabort = () => reject(asStorageError(tx.error));
    try {
      work(tx.objectStore(SHELF), value => { carried = value; });
    } catch (e) {
      reject(asStorageError(e));
    }
  }));
}

const shelfGet = key => withShelf('readonly', (shelf, keep) => {
  const request = shelf.get(key);
  request.onsuccess = () => keep(request.result === undefined ? null : request.result);
});

const shelfSet = (key, value) => withShelf('readwrite', shelf => { shelf.put(value, key); });
const shelfDelete = key => withShelf('readwrite', shelf => { shelf.delete(key); });

// Everything already in the old drawer, moved and then cleared out of it.
//
// Copied first, all of it, and only then removed — a crash halfway through
// leaves two copies, which is recoverable, rather than none, which is not.
// Nothing already in the new drawer is overwritten: the new one is the truth
// once the move has happened, and a second run must not undo work done since.
async function moveIn() {
  const local = localDrawer();
  if (!local) return;

  const keys = [];
  for (let i = 0; i < local.length; i += 1) {
    const key = local.key(i);
    if (oursToMove(key)) keys.push(key);
  }
  if (!keys.length) return;

  for (const key of keys) {
    const already = await shelfGet(key);
    if (already !== null) continue;
    const value = local.getItem(key);
    if (value !== null) await shelfSet(key, value);
  }

  // The point of the exercise. Until this runs the room is still spent.
  for (const key of keys) {
    try { local.removeItem(key); } catch { /* nothing to be done, and nothing lost */ }
  }
}

// The fallback is the old behaviour exactly: a browser with IndexedDB turned
// off, or a private window that refuses it, gets a working app in a smaller
// drawer rather than a broken one.
const oldDrawer = {
  async getItem(key) {
    const local = localDrawer();
    return local ? local.getItem(key) : null;
  },
  async setItem(key, value) {
    const local = localDrawer();
    if (!local) throw new Error('this browser is not storing anything');
    try { local.setItem(key, value); } catch (e) { throw asStorageError(e); }
  },
  async removeItem(key) {
    const local = localDrawer();
    if (local) local.removeItem(key);
  },
};

let webDrawer = null;

function drawer() {
  if (webDrawer) return webDrawer;
  webDrawer = (async () => {
    if (typeof globalThis === 'undefined' || !globalThis.indexedDB) return oldDrawer;
    try {
      await openDb();
      await moveIn();
    } catch {
      return oldDrawer;
    }
    return {
      getItem: shelfGet,
      setItem: shelfSet,
      removeItem: shelfDelete,
    };
  })();
  return webDrawer;
}

export async function getItem(key) {
  if (!onWeb()) return AsyncStorage.getItem(key);
  const it = await drawer();
  return it.getItem(key);
}

export async function setItem(key, value) {
  if (!onWeb()) return AsyncStorage.setItem(key, value);
  const it = await drawer();
  return it.setItem(key, value);
}

export async function removeItem(key) {
  if (!onWeb()) return AsyncStorage.removeItem(key);
  const it = await drawer();
  return it.removeItem(key);
}

export async function multiRemove(keys) {
  const list = Array.isArray(keys) ? keys : [];
  if (!onWeb()) return AsyncStorage.multiRemove(list);
  const it = await drawer();
  for (const key of list) await it.removeItem(key);
  return undefined;
}

// Shaped like AsyncStorage because one of the things holding it is Supabase's
// auth client, which was handed AsyncStorage itself and expects an object.
export default { getItem, setItem, removeItem, multiRemove };
