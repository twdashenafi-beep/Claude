import Store from './store';

// When a copy of everything was last taken on this device, and how much was in
// it.
//
// Per device rather than synced, and deliberately: the question the line above
// it answers is "is this phone the only place my list exists", and another
// device's backup is no answer to that.
//
// Unreadable is treated as absent. A half-written record from a crash mid-save
// would otherwise promise a copy that is not there, which is the one lie this
// whole feature exists to stop telling.

const KEY = '@dayflow_last_copy';

export async function loadCopy() {
  try {
    const raw = await Store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const at = typeof parsed.at === 'string' ? parsed.at : '';
    if (!at || Number.isNaN(Date.parse(at))) return null;
    const count = Number(parsed.count);
    return { at, count: Number.isFinite(count) && count >= 0 ? count : 0 };
  } catch {
    return null;
  }
}

// Written only once a copy has actually reached a file. Recording one when the
// share sheet was cancelled would say the list is safe when it is not.
export async function saveCopy(count, now = new Date()) {
  const when = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const kept = { at: when.toISOString(), count: Math.max(0, Number(count) || 0) };
  try {
    await Store.setItem(KEY, JSON.stringify(kept));
  } catch {
    // A line that under-reports a copy is better than a crash on a full disk.
  }
  return kept;
}
