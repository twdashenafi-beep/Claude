import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { groupByDay } from '../services/archive';
import { projectName } from '../services/projects';
import { COLORS, SANS, SERIF } from '../utils/theme';

// What you got done, kept.
//
// Read backwards and grouped by the day it was filed, because the question an
// archive answers is "what did I finish, and when" — not "what is outstanding",
// which is what every other sheet is for. So no columns, no scopes, no
// reordering: a record rather than a workspace.
function dayLabel(day) {
  try {
    const date = parseISO(`${day}T00:00:00`);
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'EEEE d MMMM yyyy');
  } catch {
    return day;
  }
}

export default function ArchiveSheet({ tasks, projects, onRestore, onDelete, onEmpty }) {
  const groups = useMemo(() => groupByDay(tasks, dayLabel), [tasks]);

  if (tasks.length === 0) {
    return (
      <View style={s.wrap}>
        <Text style={s.empty}>
          Nothing archived yet. Finish a task, then remove it from the page —
          it will be kept here rather than lost.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.headRow}>
        <Text style={s.count}>
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} kept
        </Text>
        <TouchableOpacity
          onPress={onEmpty}
          accessibilityRole="button"
          accessibilityLabel="Empty the archive permanently"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.emptyAction}>EMPTY</Text>
        </TouchableOpacity>
      </View>
      <View style={s.rule} />

      {groups.map(group => (
        <View key={group.day} style={s.group}>
          <Text style={s.day} accessibilityRole="header">{group.label}</Text>

          {group.tasks.map(task => (
            <View key={task.id} style={s.row}>
              <View style={s.body}>
                <Text style={s.title} numberOfLines={2}>{task.title}</Text>
                <Text style={s.meta}>
                  {[
                    task.taskType === 'done_for_me' ? 'Owe Me' : 'To Do',
                    task.projectId ? projectName(projects, task.projectId) : null,
                    task.owePerson || null,
                  ].filter(Boolean).join('  ·  ')}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => onRestore(task.id)}
                accessibilityRole="button"
                accessibilityLabel={`Put ${task.title} back on the page`}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              >
                <Text style={s.action}>RESTORE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onDelete(task.id)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${task.title} permanently`}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              >
                <Text style={[s.action, s.danger]}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 20 },
  headRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  count: {
    fontFamily: SANS, fontSize: 11, letterSpacing: 1.4,
    textTransform: 'uppercase', color: COLORS.inkSoft,
  },
  emptyAction: {
    fontFamily: SANS, fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    color: COLORS.accent,
  },
  rule: { height: 1, backgroundColor: COLORS.pencil, marginTop: 10 },

  group: { marginTop: 22 },
  day: {
    fontFamily: SERIF, fontSize: 14, fontStyle: 'italic', color: COLORS.inkSoft,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  body: { flex: 1 },
  title: { fontFamily: SANS, fontSize: 14.5, lineHeight: 19, color: COLORS.done },
  meta: {
    fontFamily: SERIF, fontSize: 12, fontStyle: 'italic',
    color: COLORS.inkFaint, marginTop: 2,
  },
  action: {
    fontFamily: SANS, fontSize: 10.5, fontWeight: '700', letterSpacing: 1,
    color: COLORS.inkSoft, marginTop: 3,
  },
  danger: { color: COLORS.accent, fontSize: 13, letterSpacing: 0 },
  empty: {
    fontFamily: SERIF, fontSize: 13.5, fontStyle: 'italic', lineHeight: 20,
    color: COLORS.inkFaint,
  },
});
