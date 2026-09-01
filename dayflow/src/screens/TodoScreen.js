import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, SectionList, TouchableOpacity, StyleSheet, SafeAreaView,
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
import { format, startOfWeek } from 'date-fns';

export default function TodoScreen() {
  const { tasks, addTask, toggleTask, deleteTask, updateTask } = useTasks();
  const [viewMode, setViewMode] = useState(VIEW_MODES.DAY);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState('todo');
  const [detailTask, setDetailTask] = useState(null);
  const [search, setSearch] = useState('');
  const [showBriefing, setShowBriefing] = useState(false);
  const [quickTask, setQuickTask] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const filteredTasks = useMemo(() => {
    let result = tasks.filter(t => t.taskType === activeTab && t.viewScope === viewMode);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(q));
    }
    return result;
  }, [tasks, viewMode, activeTab, search]);

  const prio = { high: 0, medium: 1, low: 2 };
  const openTasks = filteredTasks.filter(t => !t.completed).sort((a, b) => prio[a.priority] - prio[b.priority]);
  const completedTasks = filteredTasks.filter(t => t.completed);

  // Celebrate the moment the last open task in this view is cleared — but not
  // on an empty list, and not again until something re-opens.
  const openCount = openTasks.length;
  const prevOpenCount = useRef(openCount);
  useEffect(() => {
    if (prevOpenCount.current > 0 && openCount === 0 && completedTasks.length > 0) {
      setCelebrating(true);
    }
    prevOpenCount.current = openCount;
  }, [openCount, completedTasks.length]);

  const sections = [];
  if (openTasks.length > 0) {
    sections.push({ key: 'open', data: openTasks });
  }
  if (completedTasks.length > 0 && showCompleted) {
    sections.push({ key: 'completed', data: completedTasks });
  }

  const dateLabel = viewMode === VIEW_MODES.DAY
    ? format(selectedDate, 'EEEE, MMM d')
    : viewMode === VIEW_MODES.WEEK
    ? `Week of ${format(startOfWeek(selectedDate, { weekStartsOn: 1 }), 'MMM d')}`
    : format(selectedDate, 'MMMM yyyy');

  const progressPct = filteredTasks.length > 0
    ? Math.round((completedTasks.length / filteredTasks.length) * 100) : 0;

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.title}>{activeTab === 'todo' ? 'To Do' : 'Owe Me'}</Text>
            <Text style={s.subtitle}>{dateLabel}</Text>
          </View>
          <TouchableOpacity style={s.briefBtn} onPress={() => setShowBriefing(true)}>
            <Text style={s.briefIcon}>✦</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* AI Input — subtle */}
      <AIInput onAddTask={addTask} viewMode={viewMode} activeTab={activeTab} />

      {/* Tabs */}
      <View style={s.tabs}>
        {['todo', 'done_for_me'].map(tab => (
          <TouchableOpacity
            key={tab}
            style={[s.tab, activeTab === tab && s.tabOn]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[s.tabText, activeTab === tab && s.tabTextOn]}>
              {tab === 'todo' ? 'To Do' : 'Owe Me'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* View toggle */}
      <ViewToggle activeView={viewMode} onChangeView={setViewMode} />

      {/* Progress */}
      {filteredTasks.length > 0 && (
        <View style={s.progressWrap}>
          <View style={s.progressBg}>
            <View style={[s.progressFill, { width: `${progressPct}%` }]} />
          </View>
        </View>
      )}

      {/* Task list */}
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <TaskItem
            task={item}
            onToggle={toggleTask}
            onDelete={deleteTask}
            onPress={setDetailTask}
            onLongPress={setQuickTask}
          />
        )}
        renderSectionHeader={() => null}
        contentContainerStyle={s.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          openTasks.length === 0 && completedTasks.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>
                {viewMode === 'day' ? 'Your day is clear.' : viewMode === 'week' ? 'Nothing this week.' : 'A fresh month ahead.'}
              </Text>
              <Text style={s.emptyHint}>Tap + or type above to add a task</Text>
            </View>
          ) : openTasks.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>All done.</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          <>
            {/* Completed toggle */}
            {completedTasks.length > 0 && (
              <TouchableOpacity
                style={s.completedToggle}
                onPress={() => setShowCompleted(!showCompleted)}
              >
                <Text style={s.completedText}>
                  {showCompleted ? 'Hide' : 'Show'} {completedTasks.length} completed
                </Text>
              </TouchableOpacity>
            )}
            {/* Bulk actions when expanded */}
            {showCompleted && completedTasks.length > 0 && (
              <View style={s.bulkRow}>
                <TouchableOpacity onPress={() => completedTasks.forEach(t => toggleTask(t.id))}>
                  <Text style={s.bulkLink}>Reopen all</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => completedTasks.forEach(t => deleteTask(t.id))}>
                  <Text style={[s.bulkLink, { color: '#C7C7CC' }]}>Clear all</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={{ height: 100 }} />
          </>
        }
      />

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => setShowAdd(true)} activeOpacity={0.8}>
        <Text style={s.fabIcon}>+</Text>
      </TouchableOpacity>

      <AddTaskModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={addTask}
        section="todo"
        defaultTaskType={activeTab}
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
  safe: { flex: 1, backgroundColor: '#FFF' },

  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 32, fontWeight: '700', color: '#000', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#8E8E93', marginTop: 1 },
  briefBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#F5F5F7',
    justifyContent: 'center', alignItems: 'center', marginTop: 6,
  },
  briefIcon: { fontSize: 16, color: '#007AFF' },

  tabs: {
    flexDirection: 'row', marginHorizontal: 20, marginTop: 8,
    backgroundColor: '#F5F5F7', borderRadius: 9, padding: 2,
  },
  tab: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 7 },
  tabOn: {
    backgroundColor: '#FFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2,
  },
  tabText: { fontSize: 13, fontWeight: '500', color: '#8E8E93' },
  tabTextOn: { color: '#000', fontWeight: '600' },

  progressWrap: { paddingHorizontal: 20, paddingTop: 10 },
  progressBg: { height: 3, backgroundColor: '#F2F2F7', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: '#007AFF', borderRadius: 2 },

  list: { paddingTop: 4 },

  empty: { alignItems: 'center', paddingTop: 60, paddingBottom: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '500', color: '#C7C7CC' },
  emptyHint: { fontSize: 14, color: '#D1D1D6', marginTop: 4 },

  completedToggle: { paddingHorizontal: 20, paddingVertical: 14 },
  completedText: { fontSize: 14, color: '#007AFF' },

  bulkRow: {
    flexDirection: 'row', paddingHorizontal: 20, gap: 20, paddingBottom: 8,
  },
  bulkLink: { fontSize: 13, color: '#007AFF' },

  fab: {
    position: 'absolute', bottom: 30, right: 24,
    width: 50, height: 50, borderRadius: 25, backgroundColor: '#007AFF',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#007AFF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8,
  },
  fabIcon: { fontSize: 28, color: '#FFF', lineHeight: 30 },
});
