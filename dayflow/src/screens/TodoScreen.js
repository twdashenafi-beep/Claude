import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, useWindowDimensions,
} from 'react-native';
import { useTasks } from '../context/TaskContext';
import { sortForDisplay, targetIndex, shiftFor, moveWithin } from '../services/ordering';
import { pendingAlerts, alertBody, alertSummary, pruneShown } from '../services/alerts';
import { recordChase } from '../services/chase';
import { isReckoningDay } from '../services/reckoning';
import { eventsFor } from '../services/calendarFeed';
import { scopeNow, horizonStamp } from '../services/scope';
import { dayLoad, loadLine, gapsLine } from '../services/agenda';
import { EVERYTHING, projectOf, projectName } from '../services/projects';
import { moveTick } from '../services/haptics';
import { ARCHIVE, deletionOf } from '../services/archive';
import { loadShown, saveShown } from '../services/alertStore';
import { alertPermission, requestAlertPermission, showSystemAlert, onAlertOpened } from '../services/notifications';
import { playChime } from '../services/chime';
import TaskItem from '../components/TaskItem';
import ProjectBar from '../components/ProjectBar';
import ArchiveSheet from '../components/ArchiveSheet';
import SearchSheet from '../components/SearchSheet';
import ViewToggle from '../components/ViewToggle';
import AddTaskModal from '../components/AddTaskModal';
import TaskDetail from '../components/TaskDetail';
import AIInput from '../components/AIInput';
import DailyBriefing from '../components/DailyBriefing';
import WeekReckoning from '../components/WeekReckoning';
import ConfettiOverlay from '../components/ConfettiOverlay';
import AccountSheet from '../components/AccountSheet';
import { VIEW_MODES } from '../utils/constants';
import { COLORS, SERIF, SANS, SHEET_MAX_WIDTH } from '../utils/theme';
import { format, startOfWeek } from 'date-fns';

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// Sync is background work; it earns one quiet word in the tally line, and says
// nothing at all when there is nothing to report.
// Long enough to notice the bar and reach for it, short enough that it is gone
// before it becomes furniture.
const UNDO_WINDOW_MS = 7000;

const SCOPE_NAMES = { day: 'Day', week: 'Week', month: 'Month' };

// Often enough that a reminder lands on the minute it is meant to.
const ALERT_TICK_MS = 20000;

const SYNC_LABEL = {
  syncing: 'syncing…',
  error: 'sync failed — will retry',
  off: '',
  ok: '',
  idle: '',
};

// One of the two columns. Both are always on the page — the whole point of the
// layout is seeing what you owe and what you are owed side by side.
// How close to the top or bottom of the screen a held row has to get before the
// page starts coming with it, and how fast it does.
const EDGE = 96;
const EDGE_STEP = 9;

function Column({
  tasks, showCompleted, onToggleCompleted, emptyText, total,
  onToggle, onDelete, onPress, onReorder, onReopenAll, onClearAll,
  scrollRef, scrollY,
}) {
  const open = useMemo(
    () => sortForDisplay(tasks.filter(t => !t.completed), t => PRIORITY_ORDER[t.priority]),
    [tasks]
  );
  const completed = useMemo(() => tasks.filter(t => t.completed), [tasks]);

  // Row heights, because they are not uniform — a two-line title is taller than
  // a one-line one, so how far a drag has travelled cannot be counted in rows.
  const heights = useRef({});
  const measure = useCallback((id, height) => { heights.current[id] = height; }, []);

  // Held in a ref as well as state: the release handler needs the latest target
  // and would otherwise close over whatever it was when the drag began.
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const setDragState = value => { dragRef.current = value; setDrag(value); };

  // Where the page was when the row was picked up, how far the finger has
  // travelled since, and the timer that walks the page along at the edges.
  const dragFromScroll = useRef(0);
  const lastDy = useRef(0);
  const autoScroll = useRef(null);
  // How far the page has moved since the lift. The row is carried by the
  // finger, but it sits in a page that is sliding underneath it, so without
  // this it slips out from under the thumb as soon as the edge scrolling
  // starts.
  const [drift, setDrift] = useState(0);

  // The open list, read at the moment a gesture needs it rather than captured
  // when the handlers were built.
  //
  // Those handlers are passed to every row. Rebuilding them whenever the list
  // changes changes a prop on all of them, which defeats the memo on the row
  // and re-renders both columns for a single tick — the cost of which grows
  // with the number of tasks, which is exactly the wrong way round.
  const openRef = useRef(open);
  openRef.current = open;

  const stopAutoScroll = useCallback(() => {
    clearInterval(autoScroll.current);
    autoScroll.current = null;
  }, []);

  // A drag abandoned by leaving the page must not leave a timer running.
  useEffect(() => () => clearInterval(autoScroll.current), []);

  const startDrag = useCallback(id => {
    const from = openRef.current.findIndex(t => t.id === id);
    if (from < 0) return;
    // Where the page was when the row came up. Everything below is measured
    // against this, because the page can move under the finger from here on.
    dragFromScroll.current = scrollY.current;
    setDrift(0);
    setDragState({ id, from, to: from });
  }, []);

  // Recomputed from the last finger position and however far the page has
  // scrolled since — the row has to be judged against the list, and the list
  // has been moving.
  const placeUnderFinger = useCallback(() => {
    const current = dragRef.current;
    if (!current) return;
    const travelled = scrollY.current - dragFromScroll.current;
    const sizes = openRef.current.map(t => heights.current[t.id] || 0);
    const to = targetIndex(sizes, current.from, lastDy.current + travelled);
    if (to !== current.to) {
      moveTick();
      setDragState({ ...current, to });
    }
  }, []);

  const moveDrag = useCallback((dy, pageY) => {
    if (!dragRef.current) return;
    lastDy.current = dy;
    placeUnderFinger();

    // Carrying a row to the top of a long list used to be impossible rather
    // than difficult: nothing scrolled, so a row could only travel as far as a
    // thumb reaches in one go. Near either edge the page now comes along.
    const height = typeof window === 'undefined' ? 800 : window.innerHeight;
    const near = typeof pageY !== 'number' ? 0
      : pageY < EDGE ? -1
      : pageY > height - EDGE ? 1
      : 0;
    if (near === 0) { stopAutoScroll(); return; }
    if (autoScroll.current) return;
    autoScroll.current = setInterval(() => {
      const next = Math.max(0, scrollY.current + near * EDGE_STEP);
      if (next === scrollY.current) return;
      scrollY.current = next;
      setDrift(next - dragFromScroll.current);
      if (scrollRef.current) scrollRef.current.scrollTo({ y: next, animated: false });
      placeUnderFinger();
    }, 16);
  }, [placeUnderFinger]);

  const endDrag = useCallback(() => {
    stopAutoScroll();
    const current = dragRef.current;
    setDragState(null);
    setDrift(0);
    lastDy.current = 0;
    if (!current || current.to === current.from) return;
    const changes = moveWithin(openRef.current, current.from, current.to);
    if (changes.length) onReorder(changes);
  }, [onReorder]);

  const row = (task, index) => (
    <TaskItem
      key={task.id}
      task={task}
      drift={drag && drag.id === task.id ? drift : 0}
      onToggle={onToggle}
      onDelete={onDelete}
      onPress={onPress}
      onMeasure={measure}
      onDragStart={startDrag}
      onDragMove={moveDrag}
      onDragEnd={endDrag}
      dragging={!!drag && drag.id === task.id}
      shift={drag ? shiftFor(index, drag.from, drag.to, heights.current[drag.id] || 0) : 0}
    />
  );

  return (
    <View style={s.column}>
      {open.length === 0 && completed.length === 0 ? (
        <Text style={s.empty}>{emptyText}</Text>
      ) : null}

      {open.map(row)}

      {open.length === 0 && completed.length > 0 ? (
        <Text style={s.empty}>All settled.</Text>
      ) : null}

      {/* Finished tasks keep no order — there is nothing left to prioritise —
          so they render without a handle and outside the drag's indices. */}
      {showCompleted
        ? completed.map(task => (
            <TaskItem
              key={task.id}
              task={task}
              onToggle={onToggle}
              onDelete={onDelete}
              onPress={onPress}
            />
          ))
        : null}

      {completed.length > 0 ? (
        <View style={s.columnFoot}>
          <TouchableOpacity
            onPress={onToggleCompleted}
            accessibilityRole="button"
            aria-expanded={showCompleted}
            accessibilityLabel={`${showCompleted ? 'Hide' : 'Show'} ${completed.length} completed`}
          >
            <Text style={s.footLink}>
              {showCompleted ? 'Hide' : 'Show'} {completed.length} done
            </Text>
          </TouchableOpacity>
          {showCompleted ? (
            <View style={s.footActions}>
              <TouchableOpacity
                onPress={onReopenAll}
                accessibilityRole="button"
                accessibilityLabel="Reopen all completed tasks"
              >
                <Text style={s.footLink}>Reopen all</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onClearAll}
                accessibilityRole="button"
                accessibilityLabel="Permanently delete all completed tasks"
              >
                <Text style={[s.footLink, { color: COLORS.inkFaint }]}>Clear all</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Ruled off at the foot of the column, the way a ledger totals up. */}
      {total ? (
        <View style={s.totalBlock}>
          <View style={s.totalRule} />
          <Text style={s.totalText}>{total}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function TodoScreen({ account, dataKey, onLock, onDeleted }) {
  const {
    tasks, addTask, toggleTask, deleteTask, restoreTask, updateTask, reorderTasks, syncState,
    storageError, vaultError,
    projects, addProject, renameProject, deleteProject, moveTaskToProject, reorderProjects,
    archived, archiveTask, archiveTasks, unarchiveTask, deleteTasks, restoreTasks,
    importTasks, tombstones,
  } = useTasks();
  const { width } = useWindowDimensions();

  const [viewMode, setViewMode] = useState(VIEW_MODES.DAY);
  const [addingTo, setAddingTo] = useState(null); // 'todo' | 'done_for_me' | null
  const [selectedDate] = useState(new Date());
  const [detailTask, setDetailTask] = useState(null);
  const [showBriefing, setShowBriefing] = useState(false);
  // Friday, Saturday, Sunday. A weekly reckoning that sat in the header all
  // week would be one more thing to ignore on a Tuesday; this one turns up when
  // the week is over and goes away again when the next one starts. Saturday and
  // Sunday are included because plenty of people close the week then, and an
  // action available for one working day would be missed by half the year.
  const [showWeek, setShowWeek] = useState(false);

  // What the day already contains.
  //
  // Read once when the vault opens and then left alone. A diary is not a live
  // feed — nobody's Tuesday changes while they are looking at it often enough
  // to be worth polling for — and re-reading it on every render would ask the
  // phone for calendar permission in a loop.
  const [diary, setDiary] = useState(null);
  // Bumped when a calendar is imported or forgotten, so the day's line changes
  // as soon as you close the sheet rather than on the next launch.
  const [diaryAt, setDiaryAt] = useState(0);
  useEffect(() => {
    if (!dataKey) return undefined;
    let dropped = false;
    eventsFor(new Date(), dataKey)
      .then(read => { if (!dropped) setDiary(read); })
      .catch(() => {});
    return () => { dropped = true; };
  }, [dataKey, diaryAt]);
  const [banner, setBanner] = useState(null);

  // Which project's sheet is on screen. Empty is the main list, and the bar
  // stays open while you are inside a project so it always says where you are.
  const [project, setProject] = useState(EVERYTHING);
  const [showProjects, setShowProjects] = useState(false);
  // Search sits over everything rather than beside it: it is the one part of
  // the app that ignores which page you are on.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [askAlerts, setAskAlerts] = useState(false);
  const [showCompleted, setShowCompleted] = useState({ todo: false, done_for_me: false });
  const [celebrating, setCelebrating] = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  // Where the horizon is, as a string, changed by the same timer that raises
  // reminders. It turns over at midnight and again at nine in the evening.
  //
  // Which page a task belongs on is worked out from the clock, and a phone left
  // on the desk would otherwise still be showing the afternoon's Day page at
  // ten at night — which is exactly the hour tomorrow is supposed to arrive.
  const [today, setToday] = useState(() => horizonStamp());

  const inView = useMemo(
    () => tasks.filter(t => scopeNow(t) === viewMode && projectOf(t) === project),
    // `today` is not read here and is a dependency on purpose: it is what makes
    // the list recompute when the date turns over.
    [tasks, viewMode, project, today]
  );
  const todo = useMemo(() => inView.filter(t => t.taskType === 'todo'), [inView]);
  const oweMe = useMemo(() => inView.filter(t => t.taskType === 'done_for_me'), [inView]);

  const openCount = useMemo(() => inView.filter(t => !t.completed).length, [inView]);
  const doneCount = inView.length - openCount;

  // Who you are waiting on, so the column foots with something actionable.
  const oweSummary = useMemo(() => {
    const waiting = oweMe.filter(t => !t.completed);
    if (waiting.length === 0) return null;
    const people = new Set(waiting.map(t => (t.owePerson || '').trim()).filter(Boolean));
    const item = `${waiting.length} ${waiting.length === 1 ? 'item' : 'items'}`;
    if (people.size === 0) return `Waiting on ${item}`;
    return `Waiting on ${item} · ${people.size} ${people.size === 1 ? 'person' : 'people'}`;
  }, [oweMe]);

  const prevOpen = useRef(openCount);
  useEffect(() => {
    if (prevOpen.current > 0 && openCount === 0 && doneCount > 0) setCelebrating(true);
    prevOpen.current = openCount;
  }, [openCount, doneCount]);

  const dateLabel =
    viewMode === VIEW_MODES.DAY
      ? format(selectedDate, 'EEEE, d MMMM yyyy')
      : viewMode === VIEW_MODES.WEEK
      ? `Week of ${format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'd MMMM yyyy')}`
      : format(selectedDate, 'MMMM yyyy');

  // Page margins on a wide screen; tighter on a phone, where the two columns
  // need every pixel they can get.
  const narrow = width < 480;
  const gutter = narrow ? 16 : 44;
  const columnGap = narrow ? 16 : 26;

  // The open tasks of one column, in the order they are shown. The same
  // function the column itself sorts with, so moving by button and moving by
  // hand agree about what "the one above" means.
  const openInColumn = useCallback(
    type => sortForDisplay(
      inView.filter(t => t.taskType === type && !t.completed),
      t => PRIORITY_ORDER[t.priority]
    ),
    [inView]
  );

  // Where a task sits in its column, so the sheet can grey out the moves that
  // would do nothing.
  // The page itself, so a row held against the top or bottom of the screen can
  // bring it along rather than running out of room.
  const scrollRef = useRef(null);
  const scrollY = useRef(0);

  const announceScope = useCallback(scope => {
    const name = SCOPE_NAMES[scope] || scope;
    setBanner({
      text: `Moved to ${name}`,
      action: 'VIEW',
      label: `Switch to ${name}`,
      run: () => setViewMode(scope),
    });
  }, []);

  const placeOf = useCallback(id => {
    const task = tasks.find(t => t.id === id);
    if (!task) return null;
    const list = openInColumn(task.taskType);
    const index = list.findIndex(t => t.id === id);
    return index < 0 ? null : { index, total: list.length };
  }, [tasks, openInColumn]);

  // Reordering without dragging. On a phone a drag inside a scrolling list is
  // fiddly at the best of times, and a finger held still on a row is how you
  // select text everywhere else.
  const moveTask = useCallback((id, to) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const list = openInColumn(task.taskType);
    const from = list.findIndex(t => t.id === id);
    if (from < 0) return;

    const target = to === 'top' ? 0
      : to === 'bottom' ? list.length - 1
      : Math.max(0, Math.min(list.length - 1, from + to));

    const changes = moveWithin(list, from, target);
    if (changes.length) reorderTasks(changes);
  }, [tasks, openInColumn, reorderTasks]);

  // Deleting asks nothing and offers a way back instead. A confirmation on
  // every row would cost more, more often, than the occasional undo.
  const removeTask = useCallback(id => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    // One button, two meanings — so the bar afterwards says which one happened
    // rather than leaving you to guess whether the record survived.
    if (deletionOf(task) === 'archive') {
      archiveTask(id);
      setBanner({
        text: `Archived “${task.title}”`,
        action: 'UNDO',
        label: `Put ${task.title} back on the page`,
        run: () => unarchiveTask(id),
      });
      return;
    }

    deleteTask(id);
    setBanner({
      text: `Deleted “${task.title}”`,
      action: 'UNDO',
      label: `Undo deleting ${task.title}`,
      run: () => restoreTask(task),
    });
  }, [tasks, deleteTask, restoreTask, archiveTask, unarchiveTask]);

  // Clearing a column files its finished work rather than destroying it.
  const clearCompleted = useCallback(type => {
    const done = inView.filter(t => t.taskType === type && t.completed);
    if (done.length === 0) return;
    archiveTasks(done.map(t => t.id));
    setBanner({
      text: `Archived ${done.length} finished ${done.length === 1 ? 'task' : 'tasks'}`,
      action: 'VIEW',
      label: 'Open the archive',
      run: () => { setProject(ARCHIVE); setShowProjects(true); },
    });
  }, [inView, archiveTasks]);

  // Moving a task to another scope takes it off the page you are looking at.
  // Saying where it went, with a way to follow it, beats it just disappearing.
  const moveScope = useCallback((id, scope) => {
    updateTask(id, { viewScope: scope });
    announceScope(scope);
  }, [updateTask, announceScope]);

  // Saving the task sheet can move a task clean out of the view you are looking
  // at — a different scope, or the other column. Without a word it simply
  // vanishes from the page, which reads as having lost it rather than moved it.
  const saveTask = useCallback((id, updates) => {
    const before = tasks.find(t => t.id === id);
    updateTask(id, updates);
    if (!before) return;
    if (updates.viewScope && updates.viewScope !== before.viewScope) {
      announceScope(updates.viewScope);
      return;
    }
    if (updates.taskType && updates.taskType !== before.taskType) {
      const name = updates.taskType === 'done_for_me' ? 'Owe Me' : 'To Do';
      setBanner({ text: `Moved to ${name}` });
    }
  }, [tasks, updateTask, announceScope]);

  useEffect(() => {
    if (!banner) return undefined;
    const handle = setTimeout(() => setBanner(null), UNDO_WINDOW_MS);
    return () => clearTimeout(handle);
  }, [banner]);

  // ── Reminders ─────────────────────────────────────────────────────────────
  //
  // The check runs on a timer rather than off a render, and reads the task list
  // from a ref, so an edit does not restart the clock and push a reminder late.
  //
  // It is the whole list, not the tasks with reminders on them, and three other
  // things now read it for the same reason the reminder does: they run outside
  // a render and need the list as it is at that moment rather than as it was
  // when the callback was made.
  const liveTasks = useRef(tasks);
  useEffect(() => { liveTasks.current = tasks; }, [tasks]);
  // Which project a task belongs to, in words. Held in a ref for the same
  // reason the list above is: the timer that raises alerts is created once and
  // would otherwise be asking a list of projects that existed at mount.
  const whereOf = useRef(() => '');
  whereOf.current = task => {
    const id = projectOf(task);
    return id === EVERYTHING ? '' : projectName(projects, id);
  };
  const shownAlerts = useRef([]);
  // Held so the list effect below can run the same check without restarting
  // the timer, and without a second copy of it.
  const checkAlerts = useRef(null);

  useEffect(() => {
    let stopped = false;

    const tick = async () => {
      const now = Date.now();
      // Cheap, and this is the one thing in the app that already runs on a
      // clock rather than on a render.
      setToday(was => {
        const stamp = horizonStamp(now);
        return stamp === was ? was : stamp;
      });
      const due = pendingAlerts({
        tasks: liveTasks.current,
        now,
        shown: shownAlerts.current,
      });
      if (stopped || due.length === 0) return;

      // Recorded before they are raised: a notification that fails to appear is
      // better than one that repeats every twenty seconds.
      shownAlerts.current = pruneShown([...shownAlerts.current, ...due.map(a => a.key)], now);
      saveShown(shownAlerts.current);

      // Once for the batch: three tasks coming due together is one sound, not
      // three overlapping ones. Nothing waits on it — the alert strip and the
      // system notification are the reminder; the sound is how it announces
      // itself, and a device that will not play it must not hold them up.
      playChime().catch(() => {});

      for (const alert of due) {
        await showSystemAlert(
          alert.task.title,
          alertBody(alert, whereOf.current(alert.task)),
          alert.key,
          { taskId: alert.task.id },
        );
      }
      if (!stopped) setAlerts(prev => [...prev, ...due]);
    };

    checkAlerts.current = tick;

    loadShown().then(keys => {
      if (stopped) return;
      shownAlerts.current = pruneShown(keys, Date.now());
      tick();
    });

    const handle = setInterval(tick, ALERT_TICK_MS);
    return () => { stopped = true; checkAlerts.current = null; clearInterval(handle); };
  }, []);

  // The check on mount runs before the vault has finished decrypting, so it
  // sees no tasks. Without this, a reminder already overdue at launch waits out
  // a whole tick before it is raised — and so does one you have just set.
  useEffect(() => {
    if (checkAlerts.current) checkAlerts.current();
  }, [tasks]);

  // Offered once, and only where there is something to be reminded about —
  // asking on a first launch with an empty page is a prompt with no meaning.
  useEffect(() => {
    if (alertPermission() !== 'default') return;
    if (!tasks.some(t => !t.completed && t.dueDate && t.dueTime)) return;
    setAskAlerts(true);
  }, [tasks]);

  const tally = useMemo(() => {
    if (searching) return 'Search';
    if (project === ARCHIVE) return 'Archive';
    const where = project !== EVERYTHING ? `${projectName(projects, project)}  ·  ` : '';
    const count = inView.length === 0
      ? 'Nothing on the page yet'
      : `${doneCount} of ${inView.length} done`;
    return `${where}${count}`;
  }, [searching, project, projects, inView.length, doneCount]);

  // Only on the day's own page. On Week or Month "2h free" answers a question
  // nobody asked, and in the archive it is nonsense.
  const load = useMemo(
    () => (diary ? dayLoad(inView, diary.events, new Date()) : null),
    [diary, inView],
  );
  const dayLine = useMemo(() => {
    if (!load || searching || project === ARCHIVE || viewMode !== VIEW_MODES.DAY) return null;
    return [loadLine(load), gapsLine(load)].filter(Boolean).join('  ·  ') || null;
  }, [load, searching, project, viewMode]);

  // Search reaches past the current page by design, so it is handed the
  // archive as well as what is on screen — the whole point is not having to
  // remember which of the two a task ended up in.
  const searchable = useMemo(() => [...tasks, ...archived], [tasks, archived]);

  // Opening a result does not just show the task: it takes you to where the
  // task lives, so closing the sheet leaves you somewhere that makes sense
  // rather than back on the page you searched from.
  const openResult = useCallback(task => {
    setSearching(false);
    setQuery('');
    if (task.archivedAt) {
      setProject(ARCHIVE);
      setShowProjects(true);
    } else {
      setProject(projectOf(task));
      setViewMode(scopeNow(task));
    }
    setDetailTask(task);
  }, []);

  // Opening the task a reminder is about, from the strip or from the
  // notification itself. Both end in the same place as opening a search
  // result: where the task lives, not merely on top of wherever you were.
  const openTaskById = useCallback(id => {
    const found = [...liveTasks.current, ...archived].find(t => t.id === id);
    if (found) openResult(found);
    setAlerts(prev => prev.filter(a => a.task.id !== id));
  }, [archived, openResult]);

  const openAlerts = useCallback(() => {
    const [first] = alerts;
    if (!first) return;
    // The task as it is now, not as it was when the alert was raised: it may
    // have been moved to another project in between, and going to where it used
    // to live would be worse than not going at all.
    const live = liveTasks.current.find(t => t.id === first.task.id) || first.task;
    openResult(live);
    setAlerts([]);
  }, [alerts, openResult]);

  // A reminder tapped on the home screen, or one tapped while the app was
  // closed and had to be started for it.
  useEffect(() => onAlertOpened(openTaskById), [openTaskById]);

  // A chase has been sent. Written to every task the message covered, and
  // written whatever the sheet does next: a chase is something that happened,
  // not an edit waiting on Save.
  const markChased = useCallback(ids => {
    const at = new Date();
    for (const id of ids || []) {
      const task = liveTasks.current.find(t => t.id === id);
      if (task) updateTask(id, recordChase(task, at));
    }
  }, [updateTask]);

  // Everything one person owes, in one place. The search sheet already looks at
  // who owes a task and ranks those hits second, so this is a name typed into
  // it rather than a screen of its own — which is also why closing it leaves
  // you where a search leaves you rather than somewhere new.
  const seeEverythingFrom = useCallback(person => {
    if (!person) return;
    setDetailTask(null);
    setQuery(person);
    setSearching(true);
  }, []);

  const addHere = useCallback(
    data => addTask({ ...data, projectId: project }),
    [addTask, project]
  );

  const shared = {
    onToggle: toggleTask,
    onDelete: removeTask,
    onPress: setDetailTask,
    onReorder: reorderTasks,
  };

  return (
    <SafeAreaView style={s.desk}>
      <ScrollView
        ref={scrollRef}
        onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.sheet, { paddingHorizontal: gutter }]}>
          {/* Masthead */}
          <View style={s.mastheadRow}>
            {/* Four actions and a wordmark do not fit across a phone: Account
                was wrapping onto a line of its own. The name is the thing to
                drop — on a phone it is already on the icon you tapped to get
                here, and the date below is a better anchor than a repeat of
                the app's own name. */}
            {narrow ? <View /> : <Text style={s.wordmark}>DayFlow</Text>}
            <View style={s.mastheadActions}>
              {isReckoningDay() ? (
                <TouchableOpacity
                  onPress={() => setShowWeek(true)}
                  style={s.navHit}
                  accessibilityRole="button"
                  accessibilityLabel="Open the week's reckoning"
                >
                  <Text style={s.briefing}>Week</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => setShowBriefing(true)}
                style={s.navHit}
                accessibilityRole="button"
                accessibilityLabel="Open the daily briefing"
              >
                <Text style={s.briefing}>Briefing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowProjects(v => !v)}
                style={s.navHit}
                accessibilityRole="button"
                aria-expanded={showProjects || project !== EVERYTHING}
                accessibilityLabel="Projects"
              >
                <Text style={s.briefing}>Projects</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setSearching(v => !v); setQuery(''); }}
                style={s.navHit}
                accessibilityRole="button"
                aria-expanded={searching}
                accessibilityLabel="Search"
              >
                <Text style={s.briefing}>Search</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowAccount(true)}
                style={s.navHit}
                accessibilityRole="button"
                accessibilityLabel="Account settings"
              >
                <Text style={s.lock}>Account</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Shown on request, and kept open while you are inside a project —
              a sheet holding one project's tasks and no way to tell is worse
              than the row taking a little room. */}
          {!searching && (showProjects || project !== EVERYTHING) ? (
            <ProjectBar
              projects={projects}
              active={project}
              onSelect={setProject}
              onCreate={name => { const made = addProject(name); setProject(made.id); }}
              onRename={renameProject}
              onReorder={reorderProjects}
              onDelete={id => {
                deleteProject(id);
                setProject(EVERYTHING);
                setBanner({
                  text: 'Project deleted — its tasks are back in Everything',
                  action: 'OK',
                  label: 'Dismiss',
                  run: () => {},
                });
              }}
            />
          ) : null}

          {/* The archive is not a day's page: today's date above a record of
              past work says nothing, and the archive carries its own dates. */}
          {searching || project === ARCHIVE ? null : (
            <Text style={s.date} accessibilityRole="header">{dateLabel}</Text>
          )}
          <Text style={s.tally}>
            {tally}
            {SYNC_LABEL[syncState] ? `  ·  ${SYNC_LABEL[syncState]}` : ''}
          </Text>
          {/* The hours that are already spoken for. A line rather than a
              panel: it is context for the list underneath, not a thing to
              look at on its own. */}
          {dayLine ? <Text style={s.diary} dataSet={{ diaryline: 'true' }}>{dayLine}</Text> : null}

          {/* A device that has stopped saving says so, in the one place that is
              always on screen. Not the undo bar at the bottom: that clears
              itself after a few seconds, and this is true until it is not. */}
          {vaultError ? (
            <View style={s.storageBar} accessibilityRole="alert">
              <Text style={s.storageText}>{vaultError}</Text>
            </View>
          ) : null}

          {storageError ? (
            <View style={s.storageBar} accessibilityRole="alert">
              <Text style={s.storageText}>{storageError}</Text>
              <Text style={s.storageHint}>
                {syncState === 'off'
                  ? 'Connect this device to your other devices, or empty the archive, to make room.'
                  : 'Your other devices still have everything. Emptying the archive here makes room.'}
              </Text>
            </View>
          ) : null}

          {/* The archive answers a different question from the rest of the app —
              what got done, and when — so it does not carry scopes, columns or
              an input for adding to it. */}
          {searching || project === ARCHIVE ? null : (
            <ViewToggle activeView={viewMode} onChangeView={setViewMode} />
          )}
          {searching || project === ARCHIVE ? null : (
            <AIInput onAddTask={addHere} viewMode={viewMode} activeTab="todo" />
          )}

          {searching ? (
            <SearchSheet
              query={query}
              onQuery={setQuery}
              tasks={searchable}
              projects={projects}
              onOpen={openResult}
              onClose={() => { setSearching(false); setQuery(''); }}
            />
          ) : project === ARCHIVE ? (
            <ArchiveSheet
              tasks={archived}
              projects={projects}
              onRestore={id => {
                unarchiveTask(id);
                setBanner({
                  text: 'Put back on the page',
                  action: 'OK',
                  label: 'Dismiss',
                  run: () => {},
                });
              }}
              onDelete={id => {
                const task = archived.find(t => t.id === id);
                deleteTask(id);
                if (task) {
                  setBanner({
                    text: `Deleted “${task.title}” for good`,
                    action: 'UNDO',
                    label: `Undo deleting ${task.title}`,
                    run: () => restoreTask(task),
                  });
                }
              }}
              onEmpty={() => {
                const all = [...archived];
                deleteTasks(all.map(t => t.id));
                setBanner({
                  text: `Emptied the archive — ${all.length} deleted`,
                  action: 'UNDO',
                  label: 'Put the archive back',
                  run: () => restoreTasks(all),
                });
              }}
            />
          ) : (
            <>
            {/* Column headings, side by side */}
            <View style={[s.headings, { marginTop: narrow ? 18 : 26 }]}>
              <View style={[s.headCell, { paddingRight: columnGap / 2 }]}>
                <Text style={s.headText} accessibilityRole="header">To Do</Text>
                <TouchableOpacity
                  onPress={() => setAddingTo('todo')}
                  style={s.plusHit}
                  accessibilityRole="button"
                  accessibilityLabel="Add a task to To Do"
                >
                  <Text style={s.addGlyph}>+</Text>
                </TouchableOpacity>
              </View>

              <View style={s.headTick} />

              <View style={[s.headCell, { paddingLeft: columnGap / 2 }]}>
                <Text style={s.headText} accessibilityRole="header">Owe Me</Text>
                <TouchableOpacity
                  onPress={() => setAddingTo('done_for_me')}
                  style={s.plusHit}
                  accessibilityRole="button"
                  accessibilityLabel="Add something you are waiting on to Owe Me"
                >
                  <Text style={s.addGlyph}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* The rule under both headings */}
            <View style={s.headRule} />

            {/* The two columns, split by the vertical rule */}
            <View style={s.columns}>
              <View style={[s.columnWrap, { paddingRight: columnGap / 2 }]}>
                <Column
                  scrollRef={scrollRef}
                  scrollY={scrollY}
                  tasks={todo}
                  emptyText={
                    viewMode === VIEW_MODES.DAY
                      ? 'Nothing due today.'
                      : viewMode === VIEW_MODES.WEEK
                      ? 'Nothing this week.'
                      : 'A clear month.'
                  }
                  showCompleted={showCompleted.todo}
                  onToggleCompleted={() => setShowCompleted(p => ({ ...p, todo: !p.todo }))}
                  onReopenAll={() => todo.filter(t => t.completed).forEach(t => toggleTask(t.id))}
                  onClearAll={() => clearCompleted('todo')}
                  {...shared}
                />
              </View>

              <View style={s.columnRule} />

              <View style={[s.columnWrap, { paddingLeft: columnGap / 2 }]}>
                <Column
                  scrollRef={scrollRef}
                  scrollY={scrollY}
                  tasks={oweMe}
                  total={oweSummary}
                  emptyText="Not waiting on anyone."
                  showCompleted={showCompleted.done_for_me}
                  onToggleCompleted={() =>
                    setShowCompleted(p => ({ ...p, done_for_me: !p.done_for_me }))
                  }
                  onReopenAll={() => oweMe.filter(t => t.completed).forEach(t => toggleTask(t.id))}
                  onClearAll={() => clearCompleted('done_for_me')}
                  {...shared}
                />
              </View>
            </View>
            </>
          )}
        </View>

      </ScrollView>

      <AddTaskModal
        visible={!!addingTo}
        onClose={() => setAddingTo(null)}
        onAdd={addHere}
        section="todo"
        defaultTaskType={addingTo || 'todo'}
        viewMode={viewMode}
      />

      <TaskDetail
        task={detailTask}
        visible={!!detailTask}
        onClose={() => setDetailTask(null)}
        onSave={saveTask}
        onMove={moveTask}
        place={detailTask ? placeOf(detailTask.id) : null}
        onChased={markChased}
        onSeeAll={seeEverythingFrom}
        tasks={tasks}
        projects={projects}
      />

      {/* The strip used to say "2 tasks due", which is a notification about the
          existence of notifications: it named nothing, so there was nothing to
          act on but going to look. It names the first now and says how many
          are behind it — and the whole line is the way in, because the thing
          anybody wants on being reminded is the task itself. */}
      {alerts.length > 0 ? (
        <View style={s.alertBar} dataSet={{ notice: 'true' }} accessibilityRole="alert">
          <TouchableOpacity
            style={s.alertBody}
            onPress={() => openAlerts()}
            accessibilityRole="button"
            accessibilityLabel={`${alertSummary(alerts, whereOf.current)}. Opens the task.`}
          >
            <Text style={s.alertText} numberOfLines={2}>
              {alertSummary(alerts, whereOf.current)}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setAlerts([])}
            accessibilityRole="button"
            accessibilityLabel="Dismiss reminders"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.alertAction}>DISMISS</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {askAlerts && alerts.length === 0 ? (
        <View style={s.undoBar}>
          <Text style={s.undoText} numberOfLines={1}>Alert me when a task is due</Text>
          <TouchableOpacity
            onPress={async () => { await requestAlertPermission(); setAskAlerts(false); }}
            accessibilityRole="button"
            accessibilityLabel="Turn on alerts for tasks that are due"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.undoAction}>TURN ON</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {banner ? (
        <View style={s.undoBar} dataSet={{ notice: 'true' }} accessibilityRole="alert">
          <Text style={s.undoText} numberOfLines={1}>{banner.text}</Text>
          <TouchableOpacity
            onPress={() => { banner.run(); setBanner(null); }}
            accessibilityRole="button"
            accessibilityLabel={banner.label}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.undoAction}>{banner.action}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <DailyBriefing
        visible={showBriefing}
        onClose={() => setShowBriefing(false)}
        tasks={tasks}
        archived={archived}
        diary={diary}
      />
      <WeekReckoning
        visible={showWeek}
        onClose={() => setShowWeek(false)}
        tasks={tasks}
        archived={archived}
      />
      <ConfettiOverlay visible={celebrating} onDone={() => setCelebrating(false)} />

      <AccountSheet
        onCalendar={() => setDiaryAt(n => n + 1)}
        visible={showAccount}
        email={account}
        dataKey={dataKey}
        tasks={tasks}
        archived={archived}
        projects={projects}
        tombstones={tombstones}
        onImport={importTasks}
        onClose={() => setShowAccount(false)}
        onLock={onLock}
        onDeleted={onDeleted}
      />

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  storageBar: {
    marginTop: 12, padding: 12,
    borderWidth: 1, borderColor: COLORS.accent, borderRadius: 4,
  },
  storageText: { fontFamily: SANS, fontSize: 13, fontWeight: '600', color: COLORS.accent },
  storageHint: {
    fontFamily: SERIF, fontSize: 12.5, fontStyle: 'italic',
    color: COLORS.inkSoft, marginTop: 4,
  },
  // The tappable half of the strip: everything but the dismiss.
  alertBody: { flex: 1, paddingVertical: 4, paddingRight: 12 },
  alertBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 16, paddingHorizontal: 20, paddingVertical: 13,
    backgroundColor: COLORS.accent,
  },
  alertText: { flex: 1, fontFamily: SERIF, fontSize: 13.5, color: COLORS.sheet },
  alertAction: {
    fontFamily: SANS, fontSize: 12, fontWeight: '700', letterSpacing: 1.2,
    color: COLORS.sheet,
  },
  undoBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 16, paddingHorizontal: 20, paddingVertical: 13,
    backgroundColor: COLORS.ink,
  },
  undoText: { flex: 1, fontFamily: SERIF, fontSize: 13.5, color: COLORS.sheet },
  undoAction: {
    fontFamily: SANS, fontSize: 12, fontWeight: '700', letterSpacing: 1.2,
    color: COLORS.sheet,
  },
  desk: { flex: 1, backgroundColor: COLORS.desk },
  scroll: { flexGrow: 1, alignItems: 'center' },

  sheet: {
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    flexGrow: 1,
    backgroundColor: COLORS.sheet,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.sheetEdge,
    paddingTop: 26,
    paddingBottom: 48,
    shadowColor: '#3B3628',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 3,
  },

  mastheadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  // Four actions now. On a narrow phone the row wraps rather than pushing the
  // wordmark off the edge, so it has to be allowed to shrink first.
  mastheadActions: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end',
    flexShrink: 1, gap: 14, rowGap: 6,
  },
  // The four words along the top are eleven and a half point, which makes them
  // twelve pixels tall — and twelve pixels is not a target, it is a dare.
  // hitSlop is the React Native answer and react-native-web ignores it
  // entirely, so on the device this app is actually used on these were as small
  // as they looked. Padding makes the box; the negative margins take it back
  // out of the layout, so nothing moves and the row is no taller than it was.
  navHit: { paddingVertical: 9, marginVertical: -9 },
  // Same, and worth more: this one is eleven pixels wide.
  plusHit: { paddingVertical: 8, paddingHorizontal: 12, marginVertical: -8, marginHorizontal: -12 },
  lock: {
    fontFamily: SANS, fontSize: 11.5, letterSpacing: 0.6,
    textTransform: 'uppercase', color: COLORS.inkSoft, fontWeight: '600',
  },
  wordmark: {
    fontFamily: SERIF, fontSize: 12.5, letterSpacing: 3,
    textTransform: 'uppercase', color: COLORS.inkSoft,
  },
  briefing: {
    fontFamily: SANS, fontSize: 11.5, letterSpacing: 0.6,
    textTransform: 'uppercase', color: COLORS.accent, fontWeight: '600',
  },
  date: { fontFamily: SERIF, fontSize: 25, color: COLORS.ink, marginTop: 10, letterSpacing: -0.3 },
  tally: { fontFamily: SANS, fontSize: 12, color: COLORS.inkFaint, marginTop: 4 },
  diary: { fontFamily: SANS, fontSize: 12, color: COLORS.inkSoft, marginTop: 3 },

  // Headings sit above the rule, one per column.
  headings: { flexDirection: 'row', alignItems: 'flex-end' },
  // The vertical rule breaking the surface just above the horizontal one.
  headTick: { width: 1, height: 11, backgroundColor: COLORS.pencil },
  headCell: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingBottom: 7,
  },
  headText: {
    fontFamily: SERIF, fontSize: 17, letterSpacing: 2.4,
    textTransform: 'uppercase', color: COLORS.ink,
  },
  addGlyph: { fontFamily: SANS, fontSize: 19, color: COLORS.inkFaint, lineHeight: 22 },

  headRule: { height: 1, backgroundColor: COLORS.pencil },

  // The columns and the line between them.
  columns: { flexDirection: 'row', flexGrow: 1, alignItems: 'stretch' },
  columnWrap: { flex: 1 },
  columnRule: { width: 1, backgroundColor: COLORS.pencil },
  column: { paddingTop: 6 },

  empty: {
    fontFamily: SERIF, fontSize: 13.5, fontStyle: 'italic',
    color: COLORS.inkFaint, paddingVertical: 14,
  },

  columnFoot: { paddingTop: 10, gap: 6 },
  footActions: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  footLink: { fontFamily: SANS, fontSize: 12, color: COLORS.inkSoft },

  totalBlock: { paddingTop: 14 },
  totalRule: { height: 1, backgroundColor: COLORS.rule, marginBottom: 6 },
  totalText: {
    fontFamily: SERIF, fontSize: 12.5, fontStyle: 'italic', color: COLORS.inkSoft,
    textAlign: 'right',
  },
});
