import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, useWindowDimensions,
} from 'react-native';
import { useTasks } from '../context/TaskContext';
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
  onToggle, onDelete, onPress, onLongPress, onReopenAll, onClearAll,
}) {
  const open = useMemo(
    () => tasks.filter(t => !t.completed)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]),
    [tasks]
  );
  const completed = useMemo(() => tasks.filter(t => t.completed), [tasks]);

  const row = task => (
    <TaskItem
      key={task.id}
      task={task}
      onToggle={onToggle}
      onDelete={onDelete}
      onPress={onPress}
      onLongPress={onLongPress}
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

      {showCompleted ? completed.map(row) : null}

      {completed.length > 0 ? (
        <View style={s.columnFoot}>
          <TouchableOpacity onPress={onToggleCompleted}>
            <Text style={s.footLink}>
              {showCompleted ? 'Hide' : 'Show'} {completed.length} done
            </Text>
          </TouchableOpacity>
          {showCompleted ? (
            <View style={s.footActions}>
              <TouchableOpacity onPress={onReopenAll}>
                <Text style={s.footLink}>Reopen all</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClearAll}>
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
  const { tasks, addTask, toggleTask, deleteTask, updateTask, syncState } = useTasks();
  const { width } = useWindowDimensions();

  const [viewMode, setViewMode] = useState(VIEW_MODES.DAY);
  const [addingTo, setAddingTo] = useState(null); // 'todo' | 'done_for_me' | null
  const [selectedDate] = useState(new Date());
  const [detailTask, setDetailTask] = useState(null);
  const [showBriefing, setShowBriefing] = useState(false);
  const [quickTask, setQuickTask] = useState(null);
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

  const shared = {
    onToggle: toggleTask,
    onDelete: deleteTask,
    onPress: setDetailTask,
    onLongPress: setQuickTask,
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
              >
                <Text style={s.briefing}>Briefing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowAccount(true)}
                hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              >
                <Text style={s.lock}>Account</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={s.date}>{dateLabel}</Text>
          <Text style={s.tally}>
            {inView.length === 0 ? 'Nothing on the page yet' : `${doneCount} of ${inView.length} done`}
            {SYNC_LABEL[syncState] ? `  ·  ${SYNC_LABEL[syncState]}` : ''}
          </Text>

          <ViewToggle activeView={viewMode} onChangeView={setViewMode} />
          <AIInput onAddTask={addTask} viewMode={viewMode} activeTab="todo" />

          {/* Column headings, side by side */}
          <View style={[s.headings, { marginTop: narrow ? 18 : 26 }]}>
            <View style={[s.headCell, { paddingRight: columnGap / 2 }]}>
              <Text style={s.headText}>To Do</Text>
              <TouchableOpacity
                onPress={() => setAddingTo('todo')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={s.addGlyph}>+</Text>
              </TouchableOpacity>
            </View>

            <View style={s.headTick} />

            <View style={[s.headCell, { paddingLeft: columnGap / 2 }]}>
              <Text style={s.headText}>Owe Me</Text>
              <TouchableOpacity
                onPress={() => setAddingTo('done_for_me')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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
        onDelete={deleteTask}
        onPriority={(id, p) => updateTask(id, { priority: p })}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
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
