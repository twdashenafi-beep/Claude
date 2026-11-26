import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import Store from '../services/store';
import { encrypt, decrypt } from '../services/encryption';
import { useTasks } from './TaskContext';
import {
  emptyState, normaliseState, parseInboxFile, applyProposals, pendingOf, findSuggestion,
  taskDataFor, statusChangeFor, markAccepted, markDismissed, buildAgentExport,
  NEW_TASK, STATUS_SUGGESTION, PENDING,
} from '../services/agentInbox';

// The agent inbox, wired to the app.
//
// Only the Mac app can reach the folder — its window is given a small bridge
// (desktop/preload.js) and nothing else is. Everywhere else this provider is
// present and inert: no tab, no polling, no export.
//
// Suggestions are kept apart from the task list, under their own key, encrypted
// with the same key as the tasks. Apart because the task list syncs, and a
// phone running an older build would show any record it does not recognise as
// an ordinary task — which is exactly what a suggestion must never become
// without a tap. Only what is accepted joins the list, through addTask, and
// syncs from there like anything else.

const STATE_KEY = '@dayflow_agent_inbox';
const EXPORT_KEY = '@dayflow_agent_export';
const CHECK_EVERY_MS = 15 * 60 * 1000;
const EXPORT_DELAY_MS = 4000;

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
  available: false, folder: null, suggestions: [], pending: [], lastCheck: null,
  exportOn: false, lastExport: null,
  accept: async () => ({ error: 'unavailable' }), dismiss: async () => {},
  checkNow: async () => {}, setExportOn: () => {},
};

export function AgentInboxProvider({ encryptionKey, children }) {
  const bridge = useMemo(desktopInbox, []);
  const { tasks, archived, projects, addTask, toggleTask } = useTasks();

  const [state, setState] = useState(emptyState);
  const stateRef = useRef(state);
  const [loaded, setLoaded] = useState(false);
  const [folder, setFolder] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);
  const [exportOn, setExportOnState] = useState(false);
  const [lastExport, setLastExport] = useState(null);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // ── Storage ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!bridge || !encryptionKey) return undefined;
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
  }, [bridge, encryptionKey]);

  const commit = useCallback(async next => {
    stateRef.current = next;
    setState(next);
    await Store.setItem(STATE_KEY, encrypt(JSON.stringify(next), encryptionKey));
  }, [encryptionKey]);

  // ── Checking the folder ───────────────────────────────────────────────────
  //
  // Each file ends in processed/ or rejected/, and the state is saved before
  // the file is moved: if the app stops between the two, the file is read again
  // next time and every proposal in it is recognised as a duplicate.
  const checking = useRef(false);
  const checkNow = useCallback(async () => {
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
    checkNow();
    const timer = setInterval(checkNow, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [bridge, loaded, checkNow]);

  // ── Deciding ──────────────────────────────────────────────────────────────
  const accept = useCallback(async key => {
    const s = findSuggestion(stateRef.current, key);
    if (!s || s.status !== PENDING) return { error: 'Already decided.' };
    if (s.type === NEW_TASK) {
      const task = addTask(taskDataFor(s));
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
  }, [addTask, toggleTask, commit]);

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

  const value = useMemo(() => (bridge ? {
    available: true, folder, suggestions: state.suggestions, pending: pendingOf(state),
    lastCheck, exportOn, lastExport, accept, dismiss, checkNow, setExportOn,
  } : INERT), [bridge, folder, state, lastCheck, exportOn, lastExport, accept, dismiss, checkNow, setExportOn]);

  return <AgentInboxContext.Provider value={value}>{children}</AgentInboxContext.Provider>;
}

export function useAgentInbox() {
  return useContext(AgentInboxContext) || INERT;
}
