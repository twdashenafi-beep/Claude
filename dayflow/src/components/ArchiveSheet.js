import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { VoicePlayButton } from './VoiceRecorder';
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

// Long enough that clamping it would hide something. Measuring the rendered
// height would be exact, but text layout is not reliably reported on the web,
// and a note this long is worth a tap either way.
const LONG_NOTE = 140;

export default function ArchiveSheet({ tasks, projects, onRestore, onDelete, onEmpty }) {
  const groups = useMemo(() => groupByDay(tasks, dayLabel), [tasks]);
  const [opened, setOpened] = useState(() => new Set());

  const toggleNote = id => setOpened(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

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

                {/* What you wrote against the task. The point of keeping a
                    record is the detail, so a long note clamps rather than
                    truncates and opens on a tap. */}
                {task.notes ? (
                  <>
                    <Text
                      style={s.notes}
                      numberOfLines={opened.has(task.id) ? undefined : 4}
                    >
                      {task.notes}
                    </Text>
                    {task.notes.length > LONG_NOTE ? (
                      <TouchableOpacity
                        onPress={() => toggleNote(task.id)}
                        accessibilityRole="button"
                        accessibilityLabel={
                          opened.has(task.id)
                            ? `Collapse the note on ${task.title}`
                            : `Read the whole note on ${task.title}`
                        }
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={s.more}>
                          {opened.has(task.id) ? 'Less' : 'More'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                ) : null}

                {task.voiceNoteUri ? (
                  <View style={s.voice}>
                    <VoicePlayButton uri={task.voiceNoteUri} />
                  </View>
                ) : null}
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
  headRow: { flexDirection: 'row', justifyContent: 'flex-end' },
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
  notes: {
    fontFamily: SERIF, fontSize: 13, lineHeight: 19,
    color: COLORS.inkSoft, marginTop: 6,
  },
  more: {
    fontFamily: SANS, fontSize: 10.5, fontWeight: '700', letterSpacing: 1,
    color: COLORS.inkFaint, marginTop: 4,
  },
  voice: { marginTop: 8, alignSelf: 'flex-start' },
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
