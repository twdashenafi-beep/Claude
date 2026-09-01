import React, {
  createContext, useContext, useState, useCallback, useEffect, useRef, useMemo,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scheduleTaskNotifications, cancelTaskNotifications } from '../services/notifications';
import { createTaskEncryptor, decryptTask } from '../services/encryption';
import { newId } from '../utils/id';
import { pullTasks, pushTasks, mergeTasks, watchTasks } from '../services/sync';

const TaskContext = createContext();
const STORAGE_KEY = '@dayflow_vault_v2';
// A backstop, not the mechanism. Realtime delivers changes in about a second;
// this only covers a dropped socket or a device that was asleep.
const SYNC_BACKSTOP_MS = 300000;

// Realtime fires once per row, so a device saving twenty tasks would otherwise
// trigger twenty merges. Coalesce them.
const SYNC_DEBOUNCE_MS = 800;

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
          if (!cancelled) setTasks(decrypted);
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
    if (!loaded) return;
    pending.current = tasks;
    const handle = setTimeout(flush, 250);
    return () => clearTimeout(handle);
  }, [tasks, loaded, flush]);

  useEffect(() => flush, [flush]);

  // ── Cloud sync ────────────────────────────────────────────────────────────
  const syncNow = useCallback(async () => {
    if (!synced || !loaded) return;
    setSyncState('syncing');
    try {
      const remoteRows = await pullTasks();
      if (!remoteRows) { setSyncState('off'); return; }

      let outbound = [];
      setTasks(current => {
        const result = mergeTasks({
          localTasks: current,
          localTombstones: tombstones.current,
          remoteRows,
          decryptRow: ciphertext => decryptTask(ciphertext, encryptionKey),
        });
        tombstones.current = result.tombstones;
        const byId = new Map(result.tasks.map(t => [t.id, t]));
        outbound = result.pushIds.map(id => byId.get(id)).filter(Boolean);
        return result.tasks;
      });

      // setTasks batches, so give React a tick to apply before encrypting.
      await Promise.resolve();

      const rows = outbound.length ? encryptAll(outbound, encryptionKey) : [];
      const tombRows = tombstones.current.map(t => ({
        id: t.id, ciphertext: '', updatedAt: t.updatedAt, deleted: true,
      }));
      if (rows.length || tombRows.length) await pushTasks([...rows, ...tombRows]);

      setSyncState('ok');
    } catch (e) {
      console.warn('Sync failed:', e.message);
      setSyncState('error');
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

    const unwatch = watchTasks(nudge);
    // Without Realtime there is nothing pushing changes, so fall back to the
    // old cadence rather than syncing only on launch.
    const backstop = setInterval(syncNow, unwatch ? SYNC_BACKSTOP_MS : 60000);

    return () => {
      clearTimeout(debounce);
      clearInterval(backstop);
      if (unwatch) unwatch();
    };
  }, [synced, loaded, syncNow]);

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
    };
    setTasks(prev => [newTask, ...prev]);

    if (newTask.dueDate && newTask.dueTime) {
      scheduleTaskNotifications(newTask).catch(() => {});
    }
    return newTask;
  }, []);

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
  }, []);

  const deleteTask = useCallback(id => {
    cancelTaskNotifications(id);
    // Tombstone, not removal: an offline device would otherwise re-upload this
    // task on its next push and it would come back.
    tombstones.current = [
      ...tombstones.current.filter(t => t.id !== id),
      { id, updatedAt: stamp() },
    ];
    setTasks(prev => prev.filter(t => t.id !== id));
  }, []);

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
  }, []);

  return (
    <TaskContext.Provider
      value={{ tasks, addTask, toggleTask, deleteTask, updateTask, syncState, syncNow }}
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
