import React, {
  createContext, useContext, useState, useCallback, useEffect, useRef, useMemo,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scheduleTaskNotifications, cancelTaskNotifications } from '../services/notifications';
import { createTaskEncryptor, decryptTask } from '../services/encryption';
import { newId } from '../utils/id';
import { pullTasks, pushTasks, mergeTasks, watchTasks } from '../services/sync';
import { orderForNewTask } from '../services/ordering';
import {
  PROJECT_KIND, EVERYTHING, projectOf, isTask, isProject,
  sortProjects, orderForNewProject,
} from '../services/projects';
import { isArchived } from '../services/archive';

const TaskContext = createContext();
const STORAGE_KEY = '@dayflow_vault_v2';
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

// Every mutation stamps updatedAt. Merging across devices has nothing else to
// go on — the server cannot read the task — so the timestamp is what decides
// which of two edits wins.
const stamp = () => new Date().toISOString();

export function TaskProvider({ children, encryptionKey, synced }) {
  const [tasks, setTasks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [syncState, setSyncState] = useState(synced ? 'idle' : 'off');
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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const vault = JSON.parse(stored);
          const rows = Array.isArray(vault) ? vault : vault.rows || [];
          tombstones.current = (Array.isArray(vault) ? [] : vault.tombstones) || [];
          const decrypted = rows
            .map(row => {
              const task = decryptTask(row.ciphertext, encryptionKey);
              return task ? { ...task, id: row.id, updatedAt: row.updatedAt } : null;
            })
            .filter(Boolean);
            if (!cancelled) { tasksRef.current = decrypted; setTasks(decrypted); }
        }
      } catch (e) {
        console.warn('Failed to load vault:', e.message);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [encryptionKey]);

  const persist = useCallback(
    async list => {
      const rows = encryptAll(list, encryptionKey);
      await AsyncStorage.setItem(
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
    persist(list).catch(() => {});
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
      title: taskData.title,
      date: taskData.date || now,
      dueDate: taskData.dueDate || taskData.date || now,
      dueTime: taskData.dueTime || '',
      reminderEnabled: taskData.reminderEnabled || false,
      earlyReminderMinutes: taskData.earlyReminderMinutes || 0,
      priority: taskData.priority || 'medium',
      completed: false,
      section: taskData.section || 'todo',
      taskType: taskData.taskType || 'todo',
      viewScope: taskData.viewScope || 'day',
      owePerson: taskData.owePerson || '',
      notes: taskData.notes || '',
      voiceNoteUri: taskData.voiceNoteUri || null,
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
    setTasks(prev =>
      prev.map(t => {
        if (t.id !== id) return t;
        const updated = { ...t, completed: !t.completed, updatedAt: stamp() };
        if (updated.completed) cancelTaskNotifications(id);
        else if (updated.dueDate && updated.dueTime) scheduleTaskNotifications(updated).catch(() => {});
        return updated;
      })
    );
    noteEdit();
  }, [noteEdit]);

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

  const updateTask = useCallback((id, updates) => {
    setTasks(prev =>
      prev.map(t => {
        if (t.id !== id) return t;
        const updated = { ...t, ...updates, updatedAt: stamp() };
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
        reorderTasks, syncState, syncNow,
        projects, addProject, renameProject, deleteProject, moveTaskToProject,
        archived, archiveTask, archiveTasks, unarchiveTask,
        deleteTasks, restoreTasks,
      }}
    >
      {children}
    </TaskContext.Provider>
  );
}

export function useTasks() {
  const context = useContext(TaskContext);
  if (!context) throw new Error('useTasks must be used within TaskProvider');
  return context;
}
