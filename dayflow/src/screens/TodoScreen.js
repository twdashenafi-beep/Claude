import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, useWindowDimensions,
} from 'react-native';
import { useTasks } from '../context/TaskContext';
import { sortForDisplay, targetIndex, shiftFor, moveWithin } from '../services/ordering';
import TaskItem from '../components/TaskItem';
import ViewToggle from '../components/ViewToggle';
import AddTaskModal from '../components/AddTaskModal';
import TaskDetail from '../components/TaskDetail';
import AIInput from '../components/AIInput';
import DailyBriefing from '../components/DailyBriefing';
import QuickActions from '../components/QuickActions';
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

const SYNC_LABEL = {
  syncing: 'syncing…',
  error: 'sync failed — will retry',
  off: '',
  ok: '',
  idle: '',
};

// One of the two columns. Both are always on the page — the whole point of the
// layout is seeing what you owe and what you are owed side by side.
function Column({
  tasks, showCompleted, onToggleCompleted, emptyText, total,
  onToggle, onDelete, onPress, onLongPress, onReorder, onReopenAll, onClearAll,
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

  const startDrag = useCallback(id => {
    const from = open.findIndex(t => t.id === id);
    if (from >= 0) setDragState({ id, from, to: from });
  }, [open]);

  const moveDrag = useCallback(dy => {
    const current = dragRef.current;
    if (!current) return;
    const sizes = open.map(t => heights.current[t.id] || 0);
    const to = targetIndex(sizes, current.from, dy);
    if (to !== current.to) setDragState({ ...current, to });
  }, [open]);

  const endDrag = useCallback(() => {
    const current = dragRef.current;
    setDragState(null);
    if (!current || current.to === current.from) return;
    const changes = moveWithin(open, current.from, current.to);
    if (changes.length) onReorder(changes);
  }, [open, onReorder]);

  const row = (task, index) => (
    <TaskItem
      key={task.id}
      task={task}
      onToggle={onToggle}
      onDelete={onDelete}
      onPress={onPress}
      onLongPress={onLongPress}
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
              onLongPress={onLongPress}
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
  } = useTasks();
  const { width } = useWindowDimensions();

  const [viewMode, setViewMode] = useState(VIEW_MODES.DAY);
  const [addingTo, setAddingTo] = useState(null); // 'todo' | 'done_for_me' | null
  const [selectedDate] = useState(new Date());
  const [detailTask, setDetailTask] = useState(null);
  const [showBriefing, setShowBriefing] = useState(false);
  const [quickTask, setQuickTask] = useState(null);
  const [banner, setBanner] = useState(null);
  const [showCompleted, setShowCompleted] = useState({ todo: false, done_for_me: false });
  const [celebrating, setCelebrating] = useState(false);
  const [showAccount, setShowAccount] = useState(false);

  const inView = useMemo(() => tasks.filter(t => t.viewScope === viewMode), [tasks, viewMode]);
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

  // Deleting asks nothing and offers a way back instead. A confirmation on
  // every row would cost more, more often, than the occasional undo.
  const removeTask = useCallback(id => {
    const task = tasks.find(t => t.id === id);
    deleteTask(id);
    if (task) {
      setBanner({
        text: `Deleted “${task.title}”`,
        action: 'UNDO',
        label: `Undo deleting ${task.title}`,
        run: () => restoreTask(task),
      });
    }
  }, [tasks, deleteTask, restoreTask]);

  // Moving a task to another scope takes it off the page you are looking at.
  // Saying where it went, with a way to follow it, beats it just disappearing.
  const moveScope = useCallback((id, scope) => {
    updateTask(id, { viewScope: scope });
    const name = SCOPE_NAMES[scope] || scope;
    setBanner({
      text: `Moved to ${name}`,
      action: 'VIEW',
      label: `Switch to ${name}`,
      run: () => setViewMode(scope),
    });
  }, [updateTask]);

  useEffect(() => {
    if (!banner) return undefined;
    const handle = setTimeout(() => setBanner(null), UNDO_WINDOW_MS);
    return () => clearTimeout(handle);
  }, [banner]);

  const shared = {
    onToggle: toggleTask,
    onDelete: removeTask,
    onPress: setDetailTask,
    onLongPress: setQuickTask,
    onReorder: reorderTasks,
  };

  return (
    <SafeAreaView style={s.desk}>
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.sheet, { paddingHorizontal: gutter }]}>
          {/* Masthead */}
          <View style={s.mastheadRow}>
            <Text style={s.wordmark}>DayFlow</Text>
            <View style={s.mastheadActions}>
              <TouchableOpacity
                onPress={() => setShowBriefing(true)}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Open the daily briefing"
              >
                <Text style={s.briefing}>Briefing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowAccount(true)}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Account settings"
              >
                <Text style={s.lock}>Account</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={s.date} accessibilityRole="header">{dateLabel}</Text>
          <Text style={s.tally}>
            {inView.length === 0 ? 'Nothing on the page yet' : `${doneCount} of ${inView.length} done`}
            {SYNC_LABEL[syncState] ? `  ·  ${SYNC_LABEL[syncState]}` : ''}
          </Text>

          <ViewToggle activeView={viewMode} onChangeView={setViewMode} />
          <AIInput onAddTask={addTask} viewMode={viewMode} activeTab="todo" />

          {/* Column headings, side by side */}
          <View style={[s.headings, { marginTop: narrow ? 18 : 26 }]}>
            <View style={[s.headCell, { paddingRight: columnGap / 2 }]}>
              <Text style={s.headText} accessibilityRole="header">To Do</Text>
              <TouchableOpacity
                onPress={() => setAddingTo('todo')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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
                onClearAll={() => todo.filter(t => t.completed).forEach(t => deleteTask(t.id))}
                {...shared}
              />
            </View>

            <View style={s.columnRule} />

            <View style={[s.columnWrap, { paddingLeft: columnGap / 2 }]}>
              <Column
                tasks={oweMe}
                total={oweSummary}
                emptyText="Not waiting on anyone."
                showCompleted={showCompleted.done_for_me}
                onToggleCompleted={() =>
                  setShowCompleted(p => ({ ...p, done_for_me: !p.done_for_me }))
                }
                onReopenAll={() => oweMe.filter(t => t.completed).forEach(t => toggleTask(t.id))}
                onClearAll={() => oweMe.filter(t => t.completed).forEach(t => deleteTask(t.id))}
                {...shared}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      <AddTaskModal
        visible={!!addingTo}
        onClose={() => setAddingTo(null)}
        onAdd={addTask}
        section="todo"
        defaultTaskType={addingTo || 'todo'}
        viewMode={viewMode}
        selectedDate={selectedDate}
      />

      <TaskDetail
        task={detailTask}
        visible={!!detailTask}
        onClose={() => setDetailTask(null)}
        onSave={updateTask}
      />

      {banner ? (
        <View style={s.undoBar} accessibilityRole="alert">
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

      <DailyBriefing visible={showBriefing} onClose={() => setShowBriefing(false)} tasks={tasks} />
      <ConfettiOverlay visible={celebrating} onDone={() => setCelebrating(false)} />

      <AccountSheet
        visible={showAccount}
        email={account}
        dataKey={dataKey}
        onClose={() => setShowAccount(false)}
        onLock={onLock}
        onDeleted={onDeleted}
      />

      <QuickActions
        visible={!!quickTask}
        task={quickTask}
        onClose={() => setQuickTask(null)}
        onComplete={toggleTask}
        onEdit={setDetailTask}
        onDelete={removeTask}
        onPriority={(id, p) => updateTask(id, { priority: p })}
        onScope={moveScope}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
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
  mastheadActions: { flexDirection: 'row', gap: 16 },
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
