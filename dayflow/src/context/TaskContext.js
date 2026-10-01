import React, {
  createContext, useContext, useState, useCallback, useEffect, useRef, useMemo,
} from 'react';
import Store from '../services/store';
import { scheduleTaskNotifications, cancelTaskNotifications } from '../services/notifications';
import { createTaskEncryptor, decryptTask } from '../services/encryption';
import { noteStage, nowMs } from '../services/opening';
import Opening from '../components/Opening';
import { newId } from '../utils/id';
import { pullTasks, pushTasks, mergeTasks, watchTasks } from '../services/sync';
import { orderForNewTask } from '../services/ordering';
import { deviceZone } from '../services/zones';
import {
  PROJECT_KIND, EVERYTHING, projectOf, isTask, isProject,
  sortProjects, orderForNewProject,
} from '../services/projects';
import { nextOccurrence, repeats } from '../services/repeat';
import { isArchived } from '../services/archive';
import { capitalizeTitle } from '../utils/text';

const TaskContext = createContext();
// Exported so that what reports on the drawer reads the same drawer. A second
// copy of this string somewhere else would go on agreeing with this one right
// up until the day it did not.
export const STORAGE_KEY = '@dayflow_vault_v2';
// A backstop, not the mechanism. Realtime delivers changes in about a second;
// this only covers a dropped socket or a device that was asleep.
const SYNC_BACKSTOP_MS = 300000;

// When Realtime is not running — not enabled on the project, or a socket that
// will not open — polling is the only thing left, so it has to be brisk enough
// that the app still feels synced.
const SYNC_FALLBACK_MS = 20000;

// Realtime fires once per row, so a device saving twenty tasks would otherwise
// trigger twenty merges. Coalesce them.
const SYNC_DEBOUNCE_MS = 800;

// How long an edit waits before going up. Long enough that ticking off four
// things in a row is one push, short enough to feel immediate on the device
// watching.
const PUSH_DEBOUNCE_MS = 1200;

// A stored row this big is carrying a recording. A row that is only words is
// under two kilobytes; one with a minute of audio in it is hundreds.
//
// Used for nothing but reporting: the decrypt does the same work either way.
// But sixteen of these are two thirds of everything stored on this device and
// none of them is on the screen you are waiting for, so whether they own the
// wait is the one number worth having.
const A_RECORDING = 20000;

// How long the thread may be held before it has to let the screen draw.
// Decrypting runs on the same thread as drawing, so without this the app is
// simply frozen for as long as the vault takes.
const SLICE_MS = 60;

// How often the count on screen is refreshed.
//
// Not the same question as how often to breathe. Yielding often is what keeps
// the screen alive; re-rendering as often is just work, and a figure that
// changes sixteen times a second is not more honest than one that changes five
// times — it is the same truth, read by nobody, at four times the cost.

const TELL_MS = 200;

const breathe = () => new Promise(resolve => setTimeout(resolve, 0));

// Every mutation stamps updatedAt. Merging across devices has nothing else to
// go on — the server cannot read the task — so the timestamp is what decides
// which of two edits wins.
const stamp = () => new Date().toISOString();

export function TaskProvider({ children, encryptionKey, synced }) {
  const [tasks, setTasks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [syncState, setSyncState] = useState(synced ? 'idle' : 'off');
  // Empty when the last local write succeeded. A storage failure is not a sync
  // failure and does not belong in syncState: one means the server is out of
  // reach, the other means this device is.
  const [storageError, setStorageError] = useState('');
  // Set once, at startup, when what was saved here could not be read. Kept
  // apart from storageError because a later write succeeding says nothing
  // about it — clearing it on the next save would erase the only notice the
  // user gets that something was lost.
  const [vaultError, setVaultError] = useState('');
  const tombstones = useRef([]);
  const encryptAll = useMemo(() => createTaskEncryptor(), []);

  // Bumped by every local mutation, so an edit can go up as soon as it is made.
  // Deliberately a counter rather than a watch on `tasks`: syncing itself sets
  // tasks, so watching that would have each sync schedule the next one forever.
  const [localEdits, setLocalEdits] = useState(0);
  const noteEdit = useCallback(() => setLocalEdits(n => n + 1), []);
  const [realtimeLive, setRealtimeLive] = useState(false);

  // The current task list, readable synchronously. Merging needs the list as it
  // stands and has to act on the result in the same breath; reading it out of a
  // setTasks updater instead means waiting on React to render, which is not
  // something a push can be sequenced against.
  const tasksRef = useRef([]);

  // ── Local vault ───────────────────────────────────────────────────────────
  //
  // Decrypted a slice at a time rather than in one go. AES runs on the same
  // thread that draws, so a vault with recordings in it held that thread for
  // several seconds — and what was on screen while it did was an empty day,
  // which looks exactly like having lost everything. Breathing between slices
  // costs a few milliseconds and lets the screen say what is happening.
  //
  // How long each part took is kept, because "about ten seconds" is not a
  // number anybody can fix. See services/opening.js.
  const [opening, setOpening] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Not begun here. The clock starts on the unlock screen, so what is
      // reported is the whole wait — deriving the key, or asking for a face,
      // and then this.
      try {
        const readAt = nowMs();
        const stored = await Store.getItem(STORAGE_KEY);
        noteStage('reading', nowMs() - readAt);
        if (stored) {
          const vault = JSON.parse(stored);
          const rows = Array.isArray(vault) ? vault : vault.rows || [];
          tombstones.current = (Array.isArray(vault) ? [] : vault.tombstones) || [];
          const decrypted = [];
          const plain = { count: 0, ms: 0 };
          const heavy = { count: 0, ms: 0 };
          let breathedAt = nowMs();
          let toldAt = 0;
          let done = 0;
          const loopFrom = nowMs();
          for (const row of rows) {
            // Per row, not per vault. A single malformed entry threw on the
            // first property read and the catch below abandoned the whole load
            // — so one bad row emptied the list, and the write that follows
            // then overwrote the file it came from.
            try {
              if (!row || typeof row !== 'object') continue;
              const startedAt = nowMs();
              const task = decryptTask(row.ciphertext, encryptionKey);
              const bucket = String(row.ciphertext || '').length >= A_RECORDING ? heavy : plain;
              bucket.count += 1;
              bucket.ms += nowMs() - startedAt;
              if (task) decrypted.push({ ...task, id: row.id, updatedAt: row.updatedAt });
            } catch { /* skip the row, keep the rest */ }
            done += 1;
            if (nowMs() - breathedAt >= SLICE_MS) {
              if (nowMs() - toldAt >= TELL_MS) {
                setOpening({ done, total: rows.length });
                toldAt = nowMs();
              }
              await breathe();
              if (cancelled) return;
              breathedAt = nowMs();
            }
          }
          noteStage(`${plain.count} ${plain.count === 1 ? 'task' : 'tasks'}`, plain.ms);
          if (heavy.count) {
            noteStage(
              `${heavy.count} with ${heavy.count === 1 ? 'a recording' : 'recordings'}`,
              heavy.ms
            );
          }
          // Everything the loop cost that was not decrypting: the yields, and
          // the renders they exist to allow. Reported rather than buried,
          // because it is the price of the screen that says what is happening,
          // and whoever pays it should be able to see what it came to. Last,
          // because it is the only line here that is the app's own doing.
          const drawing = nowMs() - loopFrom - plain.ms - heavy.ms;
          if (drawing > 0) noteStage('letting the screen draw', drawing);
          if (!cancelled) { tasksRef.current = decrypted; setTasks(decrypted); }
        }
      } catch (e) {
        console.warn('Failed to load vault:', e.message);
        // The file could not be read at all. What follows this effect is a
        // write of the empty list that failing to read produced, which would
        // destroy whatever was actually in there. On a device that syncs, the
        // server has another copy; on one that does not, this is the only copy
        // there is. So it is put aside first, under its own key, and the app
        // says that it happened rather than starting quietly from nothing.
        try {
          const raw = await Store.getItem(STORAGE_KEY);
          if (raw) await Store.setItem(`${STORAGE_KEY}_unreadable`, raw);
        } catch { /* nothing more can be done for it */ }
        if (!cancelled) {
          setVaultError(
            'The tasks saved on this device could not be read. A copy has been kept, '
            + 'and anything on your other devices will sync back.'
          );
        }
      }
      if (!cancelled) { setOpening(null); setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [encryptionKey]);

  const persist = useCallback(
    async list => {
      const rows = encryptAll(list, encryptionKey);
      await Store.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 2, rows, tombstones: tombstones.current })
      );
      return rows;
    },
    [encryptAll, encryptionKey]
  );

  // Debounced: a single user action can commit several times in a row, and each
  // commit would otherwise mean its own serialise and storage write.
  const pending = useRef(null);
  const flush = useCallback(() => {
    if (!pending.current) return;
    const list = pending.current;
    pending.current = null;
    persist(list)
      .then(() => setStorageError(''))
      .catch(err => {
        // This used to be swallowed whole. A browser refusing the write —
        // which it does at around seven thousand tasks, and immediately in a
        // private window — then meant the app carried on looking like it was
        // saving while nothing reached the disk, and the next reload dropped
        // everything since. Silence is the wrong answer to "your work is not
        // being saved".
        setStorageError(
          /quota|exceed|full/i.test(err && err.message ? err.message : '')
            ? 'This device is out of storage, so nothing new is being saved here.'
            : 'Saving to this device failed, so nothing new is being kept here.'
        );
      });
  }, [persist]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    if (!loaded) return;
    pending.current = tasks;
    const handle = setTimeout(flush, 250);
    return () => clearTimeout(handle);
  }, [tasks, loaded, flush]);

  useEffect(() => flush, [flush]);

  // ── Cloud sync ────────────────────────────────────────────────────────────
  // Guards against a pile-up: a slow sync would otherwise have the next tick,
  // and every change event that arrives meanwhile, start their own.
  const syncing = useRef(false);

  const syncNow = useCallback(async () => {
    if (!synced || !loaded || syncing.current) return;
    syncing.current = true;
    setSyncState('syncing');
    try {
      const remoteRows = await pullTasks();
      if (!remoteRows) { setSyncState('off'); return; }

      const result = mergeTasks({
        localTasks: tasksRef.current,
        localTombstones: tombstones.current,
        remoteRows,
        decryptRow: ciphertext => decryptTask(ciphertext, encryptionKey),
      });
      tombstones.current = result.tombstones;
      tasksRef.current = result.tasks;
      setTasks(result.tasks);

      const byId = new Map(result.tasks.map(t => [t.id, t]));
      const outbound = result.pushIds.map(id => byId.get(id)).filter(Boolean);

      const rows = outbound.length ? encryptAll(outbound, encryptionKey) : [];
      // Only the tombstones the server does not already hold. Re-sending the
      // rest wrote on every sync, and every write brought another sync back.
      const needed = new Set(result.tombstonePushIds);
      const tombRows = tombstones.current
        .filter(t => needed.has(t.id))
        .map(t => ({ id: t.id, ciphertext: '', updatedAt: t.updatedAt, deleted: true }));
      if (rows.length || tombRows.length) await pushTasks([...rows, ...tombRows]);

      setSyncState('ok');
    } catch (e) {
      console.warn('Sync failed:', e.message);
      setSyncState('error');
    } finally {
      syncing.current = false;
    }
  }, [synced, loaded, encryptionKey, encryptAll]);

  useEffect(() => {
    if (!synced || !loaded) return undefined;

    syncNow();

    let debounce = null;
    const nudge = () => {
      clearTimeout(debounce);
      debounce = setTimeout(syncNow, SYNC_DEBOUNCE_MS);
    };

    const unwatch = watchTasks(nudge, setRealtimeLive);

    return () => {
      clearTimeout(debounce);
      if (unwatch) unwatch();
      setRealtimeLive(false);
    };
  }, [synced, loaded, syncNow]);

  // Polling, paced by whether Realtime is actually delivering. Kept apart from
  // the subscription above so that changing pace does not tear the channel down
  // and build it again.
  useEffect(() => {
    if (!synced || !loaded) return undefined;
    const handle = setInterval(syncNow, realtimeLive ? SYNC_BACKSTOP_MS : SYNC_FALLBACK_MS);
    return () => clearInterval(handle);
  }, [synced, loaded, syncNow, realtimeLive]);

  // Nothing else pushes a local change. Without this an edit waited for the
  // backstop, so a task added on one device took minutes to appear on another
  // — and since Realtime only fires once a write lands, the other device had
  // nothing to react to in the meantime.
  useEffect(() => {
    if (!synced || !loaded || localEdits === 0) return undefined;
    const handle = setTimeout(syncNow, PUSH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [localEdits, synced, loaded, syncNow]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addTask = useCallback(taskData => {
    const now = stamp();
    const newTask = {
      id: newId(),
      title: capitalizeTitle(taskData.title),
      date: taskData.date || now,
      dueDate: taskData.dueDate || taskData.date || now,
      dueTime: taskData.dueTime || '',
      // The zone the time was set in. Empty when there is no time, and empty on
      // a device whose platform cannot do zone arithmetic — both of which fall
      // back to the wall clock the app has always kept.
      tz: taskData.dueTime ? (taskData.tz || deviceZone()) : '',
      reminderEnabled: taskData.reminderEnabled || false,
      earlyReminderMinutes: taskData.earlyReminderMinutes || 0,
      priority: taskData.priority || 'medium',
      completed: false,
      completedAt: null,
      section: taskData.section || 'todo',
      taskType: taskData.taskType || 'todo',
      viewScope: taskData.viewScope || 'day',
      // Not pinned: a scope taken from the page you were standing on, or
      // guessed from a date, is a default rather than a decision.
      scopePinned: !!taskData.scopePinned,
      owePerson: taskData.owePerson || '',
      notes: taskData.notes || '',
      voiceNoteUri: taskData.voiceNoteUri || null,
      voiceNotes: Array.isArray(taskData.voiceNotes) ? taskData.voiceNotes : [],
      // Carried explicitly, because everything a task is made of is listed
      // here: a field left off this list is a field the follow-on to a
      // repeating task silently loses, and it would lose the repeat itself
      // first of all.
      repeat: taskData.repeat || 'none',
      repeatDay: taskData.repeatDay || null,
      attachments: taskData.attachments || [],
      createdAt: now,
      updatedAt: now,
      projectId: taskData.projectId || EVERYTHING,
      // Top of its own column, in its own project: ordering is per column per
      // project, or a task made in one would be placed against another's.
      order: orderForNewTask(
        tasksRef.current.filter(t =>
          isTask(t)
          && t.taskType === (taskData.taskType || 'todo')
          && projectOf(t) === (taskData.projectId || EVERYTHING))
      ),
    };
    // Kept current here as well as in the effect below, so a second task added
    // in the same breath is placed above this one rather than beside it.
    tasksRef.current = [newTask, ...tasksRef.current];
    setTasks(prev => [newTask, ...prev]);

    if (newTask.dueDate && newTask.dueTime) {
      scheduleTaskNotifications(newTask).catch(() => {});
    }
    noteEdit();
    return newTask;
  }, [noteEdit]);

  const toggleTask = useCallback(id => {
    // Decided before the list is touched, and from the list rather than from
    // inside the updater: making the follow-on is a side effect, and a side
    // effect inside a state updater runs at whatever moment React chooses,
    // sometimes twice.
    const before = tasksRef.current.find(t => t.id === id);
    if (!before) return;
    const finishing = !before.completed;
    const follow = finishing && repeats(before) ? nextOccurrence(before) : null;

    const at = stamp();
    // The repeat goes with the new task rather than staying on this one.
    // Nothing is lost — the next one carries it — and it means unticking this
    // by mistake cannot make a second copy, and the one sitting in the archive
    // does not go on claiming it will come back.
    // completedAt is written here and nowhere else, and cleared when a task is
    // unticked. updatedAt cannot answer "what did I finish this week" on its
    // own: any edit afterwards moves it, and a task finished on Monday and
    // retitled on Friday would report itself as Friday's work.
    const flip = t => ({
      ...t,
      completed: !t.completed,
      completedAt: t.completed ? null : at,
      updatedAt: at,
      ...(follow ? { repeat: 'none' } : null),
    });

    // Written straight into the ref as well as through setTasks, and this is
    // the whole reason the function is shaped this way. A second tap arriving
    // before React has committed the first used to read a task that was still
    // waiting, decide it was being finished all over again, and make a second
    // copy of the follow-on. Two taps on a checkbox is not an exotic thing to
    // do; it is what happens when the screen is slow and you press again.
    tasksRef.current = tasksRef.current.map(t => (t.id === id ? flip(t) : t));
    setTasks(prev => prev.map(t => (t.id === id ? flip(t) : t)));

    const after = flip(before);
    if (after.completed) cancelTaskNotifications(id);
    else if (after.dueDate && after.dueTime) scheduleTaskNotifications(after).catch(() => {});

    if (follow) addTask(follow);
    noteEdit();
  }, [noteEdit, addTask]);

  const deleteTask = useCallback(id => {
    cancelTaskNotifications(id);
    // Tombstone, not removal: an offline device would otherwise re-upload this
    // task on its next push and it would come back.
    tombstones.current = [
      ...tombstones.current.filter(t => t.id !== id),
      { id, updatedAt: stamp() },
    ];
    setTasks(prev => prev.filter(t => t.id !== id));
    noteEdit();
  }, [noteEdit]);

  // Undo for a delete. The tombstone has to go and the task come back stamped
  // now: the server still holds the tombstone, so only a newer timestamp keeps
  // it from being deleted again on the next sync.
  // Applied together: a column that has never been ordered is numbered in one
  // go, and doing that a task at a time would be as many renders as tasks.
  const reorderTasks = useCallback(changes => {
    if (!changes || changes.length === 0) return;
    const byId = new Map(changes.map(c => [c.id, c.order]));
    const now = stamp();
    setTasks(prev => prev.map(t => (
      byId.has(t.id) ? { ...t, order: byId.get(t.id), updatedAt: now } : t
    )));
    noteEdit();
  }, [noteEdit]);

  const restoreTask = useCallback(task => {
    if (!task) return;
    tombstones.current = tombstones.current.filter(t => t.id !== task.id);
    const revived = { ...task, updatedAt: stamp() };
    setTasks(prev => (prev.some(t => t.id === task.id) ? prev : [revived, ...prev]));
    if (!revived.completed && revived.dueDate && revived.dueTime) {
      scheduleTaskNotifications(revived).catch(() => {});
    }
    noteEdit();
  }, [noteEdit]);

  // Deleting many at once. Doing it one at a time rebuilds the tombstone list
  // per task, which is quadratic on exactly the thing built to grow large — an
  // archive of a few thousand would stall the app when emptied.
  const deleteTasks = useCallback(ids => {
    if (!ids || ids.length === 0) return;
    const wanted = new Set(ids);
    const now = stamp();
    ids.forEach(id => cancelTaskNotifications(id));
    tombstones.current = [
      ...tombstones.current.filter(t => !wanted.has(t.id)),
      ...ids.map(id => ({ id, updatedAt: now })),
    ];
    setTasks(prev => prev.filter(t => !wanted.has(t.id)));
    noteEdit();
  }, [noteEdit]);

  // And undoing that, in one pass for the same reason.
  const restoreTasks = useCallback(list => {
    if (!list || list.length === 0) return;
    const ids = new Set(list.map(t => t.id));
    const now = stamp();
    tombstones.current = tombstones.current.filter(t => !ids.has(t.id));
    setTasks(prev => {
      const present = new Set(prev.map(t => t.id));
      const revived = list
        .filter(t => !present.has(t.id))
        .map(t => ({ ...t, updatedAt: now }));
      return [...revived, ...prev];
    });
    noteEdit();
  }, [noteEdit]);

  // Bringing a copy back in.
  //
  // The rule the whole of restore.js is arranged around holds here too: nothing
  // is removed. This adds records the device does not have and replaces ones
  // the file holds a newer version of, and touches nothing else.
  //
  // Everything written is stamped now. The decision about which version wins
  // was made before this ran, by comparing the file against what is here; the
  // stamp is what makes that decision survive the next sync, since the server
  // still holds whatever it held. It is the same reason undo stamps a restored
  // task rather than putting back the timestamp it had.
  //
  // Tombstones for the records coming in are dropped for the same reason: a
  // task this device deleted would otherwise be deleted again the moment the
  // next sync ran, which would look exactly like the import having silently
  // failed.
  const importTasks = useCallback(records => {
    const incoming = (records || []).filter(r => r && typeof r === 'object' && r.id);
    if (incoming.length === 0) return { added: 0, updated: 0 };

    const now = stamp();
    const byId = new Map(incoming.map(r => [r.id, { ...r, updatedAt: now }]));
    tombstones.current = tombstones.current.filter(t => !byId.has(t.id));

    const known = new Set(tasksRef.current.map(t => t.id));
    const fresh = [...byId.values()].filter(r => !known.has(r.id));
    const merge = list => [
      ...fresh,
      ...list.map(t => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t)),
    ];

    tasksRef.current = merge(tasksRef.current);
    setTasks(prev => merge(prev));

    for (const record of byId.values()) {
      if (!record.completed && record.dueDate && record.dueTime) {
        scheduleTaskNotifications(record).catch(() => {});
      }
    }
    noteEdit();
    return { added: fresh.length, updated: byId.size - fresh.length };
  }, [noteEdit]);

  const updateTask = useCallback((id, updates) => {
    setTasks(prev =>
      prev.map(t => {
        if (t.id !== id) return t;
        const updated = { ...t, ...updates, updatedAt: stamp() };

        // A task that has changed columns needs a place in the one it arrives
        // in. Order is kept per column per project, so the value it carried was
        // measured against a list it has just left — bringing it along drops
        // the task into the middle of its new column, which reads as having
        // lost it. It goes to the top instead, where a new task goes, because
        // arriving is what it has just done.
        if (updates.taskType && updates.taskType !== t.taskType) {
          updated.order = orderForNewTask(
            prev.filter(other =>
              isTask(other)
              && other.id !== id
              && other.taskType === updates.taskType
              && projectOf(other) === projectOf(updated))
          );
        }
        // Renaming goes through the same rule as naming, or a task edited
        // afterwards would be the one lowercase entry in the list.
        if (typeof updates.title === 'string') updated.title = capitalizeTitle(updates.title);
        if (!updated.completed && updated.dueDate && updated.dueTime) {
          scheduleTaskNotifications(updated).catch(() => {});
        } else cancelTaskNotifications(id);
        return updated;
      })
    );
    noteEdit();
  }, [noteEdit]);

  // One list underneath, two things on top. Everything that syncs, merges or
  // persists works on the whole list; everything that renders wants one or the
  // other.
  const allTasks = useMemo(() => tasks.filter(isTask), [tasks]);
  const visibleTasks = useMemo(() => allTasks.filter(t => !isArchived(t)), [allTasks]);
  const archived = useMemo(() => allTasks.filter(isArchived), [allTasks]);
  const projects = useMemo(() => sortProjects(tasks.filter(isProject)), [tasks]);

  const addProject = useCallback(name => {
    const now = stamp();
    const record = {
      id: newId(),
      kind: PROJECT_KIND,
      name,
      order: orderForNewProject(tasksRef.current.filter(isProject)),
      createdAt: now,
      updatedAt: now,
    };
    tasksRef.current = [...tasksRef.current, record];
    setTasks(prev => [...prev, record]);
    noteEdit();
    return record;
  }, [noteEdit]);

  const renameProject = useCallback((id, name) => {
    setTasks(prev => prev.map(r => (
      r.id === id && isProject(r) ? { ...r, name, updatedAt: stamp() } : r
    )));
    noteEdit();
  }, [noteEdit]);

  // The project goes; its tasks come back to the main list rather than going
  // with it. Losing a project by accident should not lose the work in it, and
  // anything genuinely finished can be deleted task by task.
  const deleteProject = useCallback(id => {
    const now = stamp();
    tombstones.current = [
      ...tombstones.current.filter(t => t.id !== id),
      { id, updatedAt: now },
    ];
    setTasks(prev => prev
      .filter(r => r.id !== id)
      .map(r => (projectOf(r) === id ? { ...r, projectId: EVERYTHING, updatedAt: now } : r)));
    noteEdit();
  }, [noteEdit]);

  // Moving a task between projects, which is the only way one made in the wrong
  // place gets to the right one.
  // Filed rather than destroyed. The task stays exactly where it was — same
  // list, same row, same encryption — and gains the date it was put away, which
  // is what every view then filters on.
  const archiveTask = useCallback(id => {
    const now = stamp();
    setTasks(prev => prev.map(t => (
      t.id === id ? { ...t, archivedAt: now, updatedAt: now } : t
    )));
    noteEdit();
  }, [noteEdit]);

  const archiveTasks = useCallback(ids => {
    if (!ids || ids.length === 0) return;
    const now = stamp();
    const wanted = new Set(ids);
    setTasks(prev => prev.map(t => (
      wanted.has(t.id) ? { ...t, archivedAt: now, updatedAt: now } : t
    )));
    noteEdit();
  }, [noteEdit]);

  // Back out of the archive, and back onto the page it came from.
  const unarchiveTask = useCallback(id => {
    setTasks(prev => prev.map(t => (
      t.id === id ? { ...t, archivedAt: '', updatedAt: stamp() } : t
    )));
    noteEdit();
  }, [noteEdit]);

  const moveTaskToProject = useCallback((taskId, projectId) => {
    setTasks(prev => prev.map(t => (
      t.id === taskId ? { ...t, projectId: projectId || EVERYTHING, updatedAt: stamp() } : t
    )));
    noteEdit();
  }, [noteEdit]);

  return (
    <TaskContext.Provider
      value={{
        tasks: visibleTasks, addTask, toggleTask, deleteTask, restoreTask, updateTask,
        reorderTasks, syncState, syncNow, storageError, vaultError,
        // The same function under a second name. Tasks and projects are one
        // record list underneath, and both carry an order, so moving either is
        // the same write — but a caller passing project changes to something
        // called reorderTasks would be right to wonder.
        reorderProjects: reorderTasks,
        projects, addProject, renameProject, deleteProject, moveTaskToProject,
        archived, archiveTask, archiveTasks, unarchiveTask,
        deleteTasks, restoreTasks, importTasks,
        tombstones: tombstones.current,
      }}
    >
      {/* Only while the wait is long enough to have noticed: a vault that
          decrypts inside one slice never sets this, so a small list opens
          straight into the day with nothing flashing in front of it. */}
      {opening ? <Opening done={opening.done} total={opening.total} /> : children}
    </TaskContext.Provider>
  );
}

export function useTasks() {
  const context = useContext(TaskContext);
  if (!context) throw new Error('useTasks must be used within TaskProvider');
  return context;
}
