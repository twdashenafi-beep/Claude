import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder,
} from 'react-native';
import { VoicePlayButton } from './VoiceRecorder';
import { COLORS, SANS, SERIF } from '../utils/theme';

// An entry in one of the two columns. The column is narrow, so the title takes
// the full width and everything else — who owes, how much, when — sits on a
// second line beneath it rather than competing for the same row.
export default function TaskItem({ task, onToggle, onDelete, onPress, onLongPress }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);

  useEffect(() => {
    Animated.timing(opacityAnim, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 24 && Math.abs(gs.dx) > Math.abs(gs.dy) * 2,
      onPanResponderMove: (_, gs) => { if (gs.dx < 0) translateX.setValue(gs.dx); },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -90) {
          Animated.timing(translateX, { toValue: -400, duration: 160, useNativeDriver: true })
            .start(() => onDelete(task.id));
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const handleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      onToggle(task.id);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
      setTimeout(() => {
        if (lastTap.current === now) onPress && onPress(task);
      }, 300);
    }
  };

  const done = task.completed;
  // Who it is with, and when it is due — what you need in order to chase it.
  const meta = [
    task.owePerson || null,
    !done && task.dueTime ? task.dueTime : null,
  ].filter(Boolean);

  return (
    <Animated.View style={{ opacity: opacityAnim }}>
      <Animated.View style={[st.row, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <TouchableOpacity
          style={[st.check, done && st.checkDone]}
          onPress={() => onToggle(task.id)}
          activeOpacity={0.6}
          hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
          accessibilityRole="checkbox"
          aria-checked={done}
          accessibilityLabel={done ? `Mark ${task.title} as not done` : `Mark ${task.title} as done`}
        >
          {done && <Text style={st.checkMark}>✓</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={st.body}
          onPress={handleTap}
          onLongPress={() => onLongPress && onLongPress(task)}
          delayLongPress={400}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={[
            task.title,
            task.owePerson ? `waiting on ${task.owePerson}` : null,
            task.dueTime ? `due at ${task.dueTime}` : null,
            task.priority === 'high' ? 'high priority' : null,
            done ? 'completed' : null,
          ].filter(Boolean).join(', ')}
          accessibilityHint="Opens the task. Double tap to mark it done."
        >
          <Text style={[st.title, done && st.titleDone]} numberOfLines={2}>
            {!done && task.priority === 'high' ? (
              <Text style={st.priority}>! </Text>
            ) : null}
            {task.title}
          </Text>

          {meta.length > 0 ? (
            <Text style={[st.meta, done && st.metaDone]} numberOfLines={1}>
              {meta.join('  ·  ')}
            </Text>
          ) : null}
        </TouchableOpacity>

        {task.voiceNoteUri ? <VoicePlayButton uri={task.voiceNoteUri} /> : null}

        {/* Removing something you are no longer going to do is not the same as
            finishing it, and it was only reachable by swiping or holding —
            neither of which a mouse discovers. */}
        <TouchableOpacity
          style={st.remove}
          onPress={() => onDelete(task.id)}
          hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${task.title}`}
          accessibilityHint="Removes the task without marking it done. Can be undone."
        >
          <Text style={st.removeMark}>×</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 9,
    backgroundColor: COLORS.sheet,
  },
  check: {
    width: 15, height: 15, borderRadius: 2,
    borderWidth: 1, borderColor: '#B5AFA1',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10, marginTop: 3,
  },
  checkDone: { backgroundColor: COLORS.check, borderColor: COLORS.check },
  checkMark: { fontSize: 10, color: COLORS.sheet, fontWeight: '700', marginTop: -1 },

  body: { flex: 1 },
  priority: { fontFamily: SERIF, fontWeight: '700', color: COLORS.accent },
  title: { fontFamily: SANS, fontSize: 14.5, lineHeight: 19, color: COLORS.ink },
  titleDone: { color: COLORS.done, textDecorationLine: 'line-through' },
  meta: {
    fontFamily: SERIF, fontSize: 12, fontStyle: 'italic', color: COLORS.inkSoft,
    marginTop: 2, fontVariant: ['tabular-nums'],
  },
  metaDone: { color: COLORS.done },

  // Faint until reached for: present on every row, but the checkbox is what
  // the eye should land on.
  remove: {
    width: 20, alignItems: 'center', justifyContent: 'center',
    marginLeft: 4, marginTop: 1, alignSelf: 'flex-start', paddingTop: 1,
  },
  removeMark: { fontFamily: SANS, fontSize: 17, lineHeight: 19, color: '#C4BEB0' },
});
