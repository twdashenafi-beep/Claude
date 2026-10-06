import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { VoicePlayButton } from './VoiceRecorder';
import { latestNote } from '../services/voiceNotes';
import { groupByDay, byAge, foldedLine } from '../services/archive';
import { projectName } from '../services/projects';
import { COLORS, SANS, SERIF, typeSize } from '../utils/theme';

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
  // Anything over a year old folds behind one line until asked for.
  //
  // Not hidden: kept, searched, backed up, one tap away. Just not what the page
  // opens with. This place had one way out and it was a cliff — EMPTY, all of
  // it, for ever — so on the day three thousand records filled the storage the
  // only tool was the one nobody wants to use.
  const [showOld, setShowOld] = useState(false);
  const { recent, older } = useMemo(() => byAge(tasks), [tasks]);
  const groups = useMemo(
    () => groupByDay(showOld ? tasks : recent, dayLabel),
    [showOld, tasks, recent],
  );
  const folded = foldedLine(older);
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
          Nothing finished yet. Finish a task, then remove it from the page —
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
          accessibilityLabel="Delete everything finished, permanently"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={s.emptyAction}>EMPTY</Text>
        </TouchableOpacity>
      </View>
      <View style={s.rule} />

      {folded ? (
        <TouchableOpacity
          style={s.fold}
          onPress={() => setShowOld(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={showOld ? `Fold away ${folded}` : `Show ${folded}`}
          dataSet={{ archivefold: 'true' }}
        >
          <Text style={s.foldText}>{folded}</Text>
          <Text style={s.foldAct}>{showOld ? 'Fold away' : 'Show'}</Text>
        </TouchableOpacity>
      ) : null}

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

                {latestNote(task) ? (
                  <View style={s.voice}>
                    <VoicePlayButton uri={latestNote(task)} />
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
    fontFamily: SANS, fontSize: typeSize(11), fontWeight: '700', letterSpacing: 1.2,
    color: COLORS.accent,
  },
  rule: { height: 1, backgroundColor: COLORS.pencil, marginTop: 10 },

  group: { marginTop: 22 },
  day: {
    fontFamily: SERIF, fontSize: typeSize(14), fontStyle: 'italic', color: COLORS.inkSoft,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  body: { flex: 1 },
  title: { fontFamily: SANS, fontSize: typeSize(14.5), lineHeight: typeSize(19), color: COLORS.done },
  meta: {
    fontFamily: SERIF, fontSize: typeSize(12), fontStyle: 'italic',
    color: COLORS.inkFaint, marginTop: 2,
  },
  notes: {
    fontFamily: SERIF, fontSize: typeSize(13), lineHeight: typeSize(19),
    color: COLORS.inkSoft, marginTop: 6,
  },
  more: {
    fontFamily: SANS, fontSize: typeSize(10.5), fontWeight: '700', letterSpacing: 1,
    color: COLORS.inkFaint, marginTop: 4,
  },
  voice: { marginTop: 8, alignSelf: 'flex-start' },
  action: {
    fontFamily: SANS, fontSize: typeSize(10.5), fontWeight: '700', letterSpacing: 1,
    color: COLORS.inkSoft, marginTop: 3,
  },
  danger: { color: COLORS.accent, fontSize: typeSize(13), letterSpacing: 0 },
  // A line, not a section: the point is that it takes up almost nothing until
  // somebody wants it.
  fold: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  foldText: { fontFamily: SERIF, fontStyle: 'italic', fontSize: typeSize(12.5), color: COLORS.inkFaint },
  foldAct: { fontFamily: SANS, fontSize: typeSize(12.5), color: COLORS.accent, marginLeft: 12 },
  empty: {
    fontFamily: SERIF, fontSize: typeSize(13.5), fontStyle: 'italic', lineHeight: typeSize(20),
    color: COLORS.inkFaint,
  },
});
