import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import Store from '../services/store';
import { encrypt, decrypt } from '../services/encryption';
import { useTasks } from './TaskContext';
import {
  emptyState, normaliseState, parseInboxFile, applyProposals, pendingOf, findSuggestion,
  taskDataFor, statusChangeFor, markAccepted, markDismissed, buildAgentExport, agentTask,
  NEW_TASK, STATUS_SUGGESTION, PENDING,
} from '../services/agentInbox';
import { mergeSuggestions, rowIdFor, taskIdFor } from '../services/suggestionSync';
import { pullSuggestions, pushSuggestions, watchSuggestions } from '../services/sync';

// The agent inbox, wired to the app.
//
// Only the Mac app can reach the folder — its window is given a small bridge
// (desktop/preload.js) and nothing else is. So the Mac collects, and a device
// with sync on is shown what the Mac collected: each suggestion travels as an
// encrypted row in a table of its own (services/suggestionSync.js). A device
// with neither a bridge nor sync is inert: no tab, no polling.
//
// Suggestions are kept apart from the task list, under their own key and in
// their own table, encrypted with the same key as the tasks. Apart because a
// phone running an older build would show any task row it does not recognise
// as an ordinary task — which is exactly what a suggestion must never become
// without a tap. Only what is accepted joins the list, through addTask, and
// syncs from there like anything else.

const STATE_KEY = '@dayflow_agent_inbox';
const EXPORT_KEY = '@dayflow_agent_export';
const CHECK_EVERY_MS = 15 * 60 * 1000;
const EXPORT_DELAY_MS = 4000;
const SHARE_EVERY_MS = 60 * 1000;
const SHARE_DEBOUNCE_MS = 1200;

export function desktopInbox() {
  try {
    const bridge = globalThis.window && globalThis.window.dayflowDesktop
      && globalThis.window.dayflowDesktop.agentInbox;
    return bridge && typeof bridge.list === 'function' ? bridge : null;
  } catch {
    return null;
  }
}

const AgentInboxContext = createContext(null);

const INERT = {
  available: false, collector: false, folder: null, suggestions: [], pending: [], lastCheck: null,
  sharing: 'off', shareFault: '', lastShared: null,
  exportOn: false, lastExport: null,
  accept: async () => ({ error: 'unavailable' }), dismiss: async () => {},
  checkNow: async () => {}, setExportOn: () => {},
};

export function AgentInboxProvider({ encryptionKey, synced = false, children }) {
  const bridge = useMemo(desktopInbox, []);
  const active = !!bridge || synced;
  const { tasks, archived, projects, addTask, toggleTask } = useTasks();

  const [state, setState] = useState(emptyState);
  const stateRef = useRef(state);
  const [loaded, setLoaded] = useState(false);
  const [folder, setFolder] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);
  const [exportOn, setExportOnState] = useState(false);
  const [lastExport, setLastExport] = useState(null);
  // 'off' no sync · 'idle' not tried yet · 'ok' · 'no-table' the sync database
  // has not been given the suggestions table · 'error'
  const [sharing, setSharing] = useState(synced ? 'idle' : 'off');
  const [shareFault, setShareFault] = useState('');
  const [lastShared, setLastShared] = useState(null);
  const [localEdits, setLocalEdits] = useState(0);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // ── Storage ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !encryptionKey) return undefined;
    let alive = true;
    (async () => {
      let next = emptyState();
      try {
        const raw = await Store.getItem(STATE_KEY);
        if (raw) {
          const text = decrypt(raw, encryptionKey);
          if (text) next = normaliseState(JSON.parse(text));
          // Unreadable is kept aside, never written over: it holds the record
          // of what was dismissed, and that is the point of keeping one.
          else await Store.setItem(`${STATE_KEY}_unreadable`, raw);
        }
        setExportOnState((await Store.getItem(EXPORT_KEY)) === 'on');
      } catch {
        // A suggestion list that cannot be read starts empty; tasks are untouched.
      }
      if (!alive) return;
      stateRef.current = next;
      setState(next);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [active, encryptionKey]);

  const save = useCallback(async next => {
    stateRef.current = next;
    setState(next);
    await Store.setItem(STATE_KEY, encrypt(JSON.stringify(next), encryptionKey));
  }, [encryptionKey]);

  // A change made here, as opposed to one that arrived: it is these that the
  // other devices have not seen.
  const commit = useCallback(async next => {
    await save(next);
    setLocalEdits(n => n + 1);
  }, [save]);

  // ── Sharing with this person's other devices ──────────────────────────────
  //
  // Pull, merge, push what the server lacks. The merge reads this device's
  // list after the pull has returned, not before: a tap made while the request
  // was in the air is then part of what is merged, rather than written over.
  const sharingBusy = useRef(false);
  const shareNow = useCallback(async () => {
    if (!synced || !loaded || sharingBusy.current) return;
    sharingBusy.current = true;
    try {
      const pulled = await pullSuggestions();
      if (!pulled) { setSharing('off'); return; }
      if (pulled.missing) { setSharing('no-table'); return; }

      const rowId = key => rowIdFor(key, encryptionKey);
      const result = mergeSuggestions({
        local: stateRef.current.suggestions,
        remoteRows: pulled.rows,
        decryptRow: ciphertext => {
          const text = decrypt(ciphertext, encryptionKey);
          return text ? JSON.parse(text) : null;
        },
        rowId,
      });
      if (result.changed) await save({ ...stateRef.current, suggestions: result.suggestions });

      const byKey = new Map(result.suggestions.map(s => [s.key, s]));
      const rows = result.pushKeys.map(key => {
        const s = byKey.get(key);
        return {
          id: rowId(key),
          ciphertext: encrypt(JSON.stringify(s), encryptionKey),
          updatedAt: s.decidedAt || s.receivedAt,
        };
      });
      await pushSuggestions(rows);
      setSharing('ok');
      setShareFault('');
      setLastShared(new Date().toISOString());
    } catch (err) {
      setShareFault([err && err.code, err && err.message].filter(Boolean).join(' ').slice(0, 200) || 'no reason given');
      setSharing('error');
    } finally {
      sharingBusy.current = false;
    }
  }, [synced, loaded, encryptionKey, save]);

  useEffect(() => {
    if (!synced || !loaded) return undefined;
    shareNow();
    let debounce = null;
    const nudge = () => {
      clearTimeout(debounce);
      debounce = setTimeout(shareNow, SHARE_DEBOUNCE_MS);
    };
    const unwatch = watchSuggestions(nudge);
    const timer = setInterval(shareNow, SHARE_EVERY_MS);
    return () => {
      clearTimeout(debounce);
      clearInterval(timer);
      if (unwatch) unwatch();
    };
  }, [synced, loaded, shareNow]);

  useEffect(() => {
    if (!synced || !loaded || localEdits === 0) return undefined;
    const handle = setTimeout(shareNow, SHARE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [localEdits, synced, loaded, shareNow]);

  // ── Checking the folder ───────────────────────────────────────────────────
  //
  // Each file ends in processed/ or rejected/, and the state is saved before
  // the file is moved: if the app stops between the two, the file is read again
  // next time and every proposal in it is recognised as a duplicate.
  const checking = useRef(false);
  const checkFolder = useCallback(async () => {
    if (!bridge || !loaded || checking.current) return;
    checking.current = true;
    const summary = { at: new Date().toISOString(), files: 0, added: 0, duplicates: 0, rejected: 0, error: '' };
    try {
      const status = await bridge.status();
      setFolder(status && status.available ? status.folder : null);
      if (!status || !status.available) {
        summary.error = 'No DayFlow folder chosen. In the Mac menu: File › Choose Agent Inbox Folder…';
        return;
      }
      const listed = await bridge.list();
      if (!listed || !listed.ok) {
        summary.error = (listed && listed.error) || 'The inbox could not be read.';
        return;
      }
      for (const file of listed.files || []) {
        summary.files += 1;
        const parsed = parseInboxFile(file.text);
        if (!parsed.ok) {
          summary.rejected += 1;
          await bridge.settle(file.name, 'rejected', parsed.reason);
          continue;
        }
        const applied = applyProposals(stateRef.current, parsed.proposals, {
          tasks: tasksRef.current, file: file.name,
        });
        if (!applied.ok) {
          summary.rejected += 1;
          await bridge.settle(file.name, 'rejected', applied.reason);
          continue;
        }
        if (applied.added > 0) await commit(applied.state);
        summary.added += applied.added;
        summary.duplicates += applied.duplicates;
        await bridge.settle(file.name, 'processed');
      }
    } catch (err) {
      summary.error = String(err && err.message ? err.message : err).slice(0, 200);
    } finally {
      checking.current = false;
      setLastCheck(summary);
    }
  }, [bridge, loaded, commit]);

  useEffect(() => {
    if (!bridge || !loaded) return undefined;
    checkFolder();
    const timer = setInterval(checkFolder, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [bridge, loaded, checkFolder]);

  // What the button does: on the Mac, look in the folder; everywhere, ask the
  // other devices what they have.
  const checkNow = useCallback(async () => {
    await checkFolder();
    await shareNow();
  }, [checkFolder, shareNow]);

  // ── Deciding ──────────────────────────────────────────────────────────────
  const accept = useCallback(async key => {
    const s = findSuggestion(stateRef.current, key);
    if (!s || s.status !== PENDING) return { error: 'Already decided.' };
    if (s.type === NEW_TASK) {
      // Another device may have accepted this already, with its task here
      // before word of the decision is: then that task is the one, and a
      // second must not be made. Otherwise the id is fixed by the suggestion,
      // so two devices accepting out of touch make one task between them.
      const task = agentTask(tasksRef.current, s.agent, s.id)
        || addTask({ ...taskDataFor(s), id: taskIdFor(key, encryptionKey) });
      await commit(markAccepted(stateRef.current, key, { taskId: task ? task.id : null }));
      return { ok: true };
    }
    if (s.type === STATUS_SUGGESTION) {
      const change = statusChangeFor(s, tasksRef.current);
      if (change.error) return { error: change.error };
      if (!change.already) toggleTask(change.taskId);
      await commit(markAccepted(stateRef.current, key, { taskId: change.taskId }));
      return { ok: true };
    }
    return { error: 'Unknown suggestion.' };
  }, [addTask, toggleTask, commit, encryptionKey]);

  const dismiss = useCallback(async key => {
    const s = findSuggestion(stateRef.current, key);
    if (!s || s.status !== PENDING) return;
    await commit(markDismissed(stateRef.current, key));
  }, [commit]);

  // ── The export ────────────────────────────────────────────────────────────
  const setExportOn = useCallback(on => {
    setExportOnState(!!on);
    Store.setItem(EXPORT_KEY, on ? 'on' : 'off').catch(() => {});
  }, []);

  useEffect(() => {
    if (!bridge || !loaded || !exportOn || !folder) return undefined;
    const timer = setTimeout(async () => {
      try {
        const text = JSON.stringify(
          buildAgentExport({ tasks: [...tasks, ...archived], projects, state }), null, 2);
        const result = await bridge.writeExport(text);
        setLastExport({ at: new Date().toISOString(), error: result && result.ok ? '' : (result && result.error) || 'failed' });
      } catch (err) {
        setLastExport({ at: new Date().toISOString(), error: String(err && err.message ? err.message : err) });
      }
    }, EXPORT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [bridge, loaded, exportOn, folder, tasks, archived, projects, state]);

  // The tab is shown where there is something behind it: on the Mac always,
  // and elsewhere once sharing has worked or there is something to show. A
  // phone whose sync database has no suggestions table has no tab, and is told
  // nothing it cannot act on.
  const available = !!bridge || sharing === 'ok' || state.suggestions.length > 0;

  const value = useMemo(() => (active ? {
    available, collector: !!bridge, folder, suggestions: state.suggestions, pending: pendingOf(state),
    lastCheck, sharing, shareFault, lastShared,
    exportOn, lastExport, accept, dismiss, checkNow, setExportOn,
  } : INERT), [active, available, bridge, folder, state, lastCheck, sharing, shareFault, lastShared,
    exportOn, lastExport, accept, dismiss, checkNow, setExportOn]);

  return <AgentInboxContext.Provider value={value}>{children}</AgentInboxContext.Provider>;
}

export function useAgentInbox() {
  return useContext(AgentInboxContext) || INERT;
}
