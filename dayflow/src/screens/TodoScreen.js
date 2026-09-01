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
import { VIEW_MODES } from '../utils/constants';
import { COLORS, SERIF, SANS, SECTION_LABEL, SHEET_MAX_WIDTH, currencySymbol } from '../utils/theme';
import { format, startOfWeek } from 'date-fns';

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function sortByPriority(list) {
  return [...list].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

// One list on the sheet. Both sections are always on the page — the point of
// the layout is seeing what you owe yourself and what you are owed at once,
// without switching between them.
function Section({
  label, tasks, showCompleted, onToggleCompleted, onAdd, emptyText, note,
  onToggle, onDelete, onPress, onLongPress, onReopenAll, onClearAll,
}) {
  const open = useMemo(() => sortByPriority(tasks.filter(t => !t.completed)), [tasks]);
  const completed = useMemo(() => tasks.filter(t => t.completed), [tasks]);

  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionLabel}>{label}</Text>
        <View style={s.sectionMeta}>
          {note ? <Text style={s.sectionNote}>{note}</Text> : null}
          <TouchableOpacity onPress={onAdd} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.addGlyph}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {open.length === 0 && completed.length === 0 ? (
        <Text style={s.empty}>{emptyText}</Text>
      ) : null}

      {open.map(task => (
        <TaskItem
          key={task.id}
          task={task}
          onToggle={onToggle}
          onDelete={onDelete}
          onPress={onPress}
          onLongPress={onLongPress}
        />
      ))}

      {open.length === 0 && completed.length > 0 ? (
        <Text style={s.empty}>All settled.</Text>
      ) : null}

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
        <View style={s.sectionFoot}>
          <TouchableOpacity onPress={onToggleCompleted}>
            <Text style={s.footLink}>
              {showCompleted ? 'Hide' : 'Show'} {completed.length} completed
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
    </View>
  );
}

export default function TodoScreen() {
  const { tasks, addTask, toggleTask, deleteTask, updateTask } = useTasks();
  const { width } = useWindowDimensions();

  const [viewMode, setViewMode] = useState(VIEW_MODES.DAY);
  const [addingTo, setAddingTo] = useState(null); // 'todo' | 'done_for_me' | null
  const [selectedDate] = useState(new Date());
  const [detailTask, setDetailTask] = useState(null);
  const [showBriefing, setShowBriefing] = useState(false);
  const [quickTask, setQuickTask] = useState(null);
  const [showCompleted, setShowCompleted] = useState({ todo: false, done_for_me: false });
  const [celebrating, setCelebrating] = useState(false);

  const inView = useMemo(
    () => tasks.filter(t => t.viewScope === viewMode),
    [tasks, viewMode]
  );
  const todo = useMemo(() => inView.filter(t => t.taskType === 'todo'), [inView]);
  const oweMe = useMemo(() => inView.filter(t => t.taskType === 'done_for_me'), [inView]);

  const openCount = useMemo(() => inView.filter(t => !t.completed).length, [inView]);
  const doneCount = inView.length - openCount;

  // Total outstanding across the Owe Me list. Mixed currencies are summed per
  // currency rather than silently added together.
  const oweNote = useMemo(() => {
    const totals = {};
    for (const t of oweMe) {
      if (t.completed) continue;
      const amount = parseFloat(t.oweAmount);
      if (!amount) continue;
      const code = t.oweCurrency || 'USD';
      totals[code] = (totals[code] || 0) + amount;
    }
    const parts = Object.entries(totals).map(
      ([code, sum]) => `${currencySymbol(code)}${sum.toFixed(2)}`
    );
    return parts.length ? `${parts.join(' · ')} outstanding` : null;
  }, [oweMe]);

  // Celebrate clearing the page, not just one list.
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

  // The sheet keeps page margins on a wide screen and tightens on a phone,
  // where edge-to-edge padding would waste the little width there is.
  const gutter = width < 480 ? 20 : 44;

  const sectionProps = {
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
          <View style={s.masthead}>
            <View style={s.mastheadRow}>
              <Text style={s.wordmark}>DayFlow</Text>
              <TouchableOpacity
                onPress={() => setShowBriefing(true)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={s.briefing}>Briefing</Text>
              </TouchableOpacity>
            </View>
            <Text style={s.date}>{dateLabel}</Text>
            <Text style={s.tally}>
              {openCount === 0 && doneCount === 0
                ? 'Nothing on the page yet'
                : `${doneCount} of ${inView.length} done`}
            </Text>
          </View>

          <View style={s.mastheadRule} />

          <ViewToggle activeView={viewMode} onChangeView={setViewMode} />

          <AIInput onAddTask={addTask} viewMode={viewMode} activeTab="todo" />

          <Section
            label="To Do"
            tasks={todo}
            emptyText={
              viewMode === VIEW_MODES.DAY
                ? 'Nothing due today.'
                : viewMode === VIEW_MODES.WEEK
                ? 'Nothing this week.'
                : 'A clear month.'
            }
            showCompleted={showCompleted.todo}
            onToggleCompleted={() =>
              setShowCompleted(p => ({ ...p, todo: !p.todo }))
            }
            onAdd={() => setAddingTo('todo')}
            onReopenAll={() => todo.filter(t => t.completed).forEach(t => toggleTask(t.id))}
            onClearAll={() => todo.filter(t => t.completed).forEach(t => deleteTask(t.id))}
            {...sectionProps}
          />

          {/* The fold: the one heavy rule on the page */}
          <View style={s.divider} />

          <Section
            label="Owe Me"
            tasks={oweMe}
            note={oweNote}
            emptyText="Nobody owes you anything."
            showCompleted={showCompleted.done_for_me}
            onToggleCompleted={() =>
              setShowCompleted(p => ({ ...p, done_for_me: !p.done_for_me }))
            }
            onAdd={() => setAddingTo('done_for_me')}
            onReopenAll={() => oweMe.filter(t => t.completed).forEach(t => toggleTask(t.id))}
            onClearAll={() => oweMe.filter(t => t.completed).forEach(t => deleteTask(t.id))}
            {...sectionProps}
          />

          <View style={s.footer}>
            <Text style={s.footerNote}>Encrypted on this device</Text>
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
    paddingBottom: 60,
    shadowColor: '#3B3628',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 3,
  },

  masthead: { paddingBottom: 14 },
  mastheadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  wordmark: {
    fontFamily: SERIF, fontSize: 13, letterSpacing: 3,
    textTransform: 'uppercase', color: COLORS.inkSoft,
  },
  briefing: {
    fontFamily: SANS, fontSize: 12, letterSpacing: 0.6,
    textTransform: 'uppercase', color: COLORS.accent, fontWeight: '600',
  },
  date: {
    fontFamily: SERIF, fontSize: 27, color: COLORS.ink,
    marginTop: 12, letterSpacing: -0.3,
  },
  tally: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkFaint, marginTop: 5 },

  mastheadRule: { height: 1, backgroundColor: COLORS.ruleStrong, marginBottom: 4 },

  section: { paddingTop: 18 },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 8,
  },
  sectionLabel: SECTION_LABEL,
  sectionMeta: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sectionNote: {
    fontFamily: SERIF, fontSize: 13, color: COLORS.accent,
    fontVariant: ['tabular-nums'],
  },
  addGlyph: { fontFamily: SANS, fontSize: 21, color: COLORS.inkSoft, lineHeight: 24 },

  empty: {
    fontFamily: SERIF, fontSize: 15, fontStyle: 'italic',
    color: COLORS.inkFaint, paddingVertical: 16,
  },

  sectionFoot: { paddingTop: 12, gap: 8 },
  footActions: { flexDirection: 'row', gap: 20 },
  footLink: { fontFamily: SANS, fontSize: 12.5, color: COLORS.inkSoft },

  // The line the whole layout is built around.
  divider: { height: 1.5, backgroundColor: COLORS.ruleStrong, marginTop: 30 },

  footer: { marginTop: 'auto', paddingTop: 40, alignItems: 'center' },
  footerNote: {
    fontFamily: SANS, fontSize: 10.5, letterSpacing: 1.1,
    textTransform: 'uppercase', color: '#C4BEB0',
  },
});
